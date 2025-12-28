const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const { BroadcastOrchestrator } = require('./broadcast-worker');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_REDIRECT_URI,
  TOKEN_ENCRYPTION_KEY
} = process.env;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();
const app = express();
app.use(bodyParser.json());

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const oauthState = new Map();

const encryptionKey = crypto
  .createHash('sha256')
  .update(String(TOKEN_ENCRYPTION_KEY || 'local-dev-key'))
  .digest();

function encrypt(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(serialized) {
  try {
    const buffer = Buffer.from(serialized, 'base64');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const payload = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (error) {
    return null;
  }
}

function buildState(userId, platform) {
  const nonce = crypto.randomBytes(16).toString('hex');
  oauthState.set(nonce, { userId, platform, createdAt: Date.now() });
  return nonce;
}

function validateState(nonce, platform) {
  const record = oauthState.get(nonce);
  if (!record) return null;
  const expired = record.createdAt + OAUTH_STATE_TTL_MS < Date.now();
  if (expired || record.platform !== platform) {
    oauthState.delete(nonce);
    return null;
  }
  oauthState.delete(nonce);
  return record.userId;
}

function getFirestoreDoc(userId, platform) {
  return db.collection('users').doc(userId).collection('destinations').doc(platform);
}

function getGoogleClient(redirectUri = GOOGLE_REDIRECT_URI) {
  return new google.auth.OAuth2({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri
  });
}

app.post('/api/oauth/google/url', (req, res) => {
  const { userId, redirectUri = GOOGLE_REDIRECT_URI } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const oauth2Client = getGoogleClient(redirectUri);
  const state = buildState(userId, 'youtube');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ],
    state
  });
  res.json({ url });
});

app.post('/api/oauth/google/callback', async (req, res) => {
  const { code, state, redirectUri = GOOGLE_REDIRECT_URI } = req.body;
  const userId = validateState(state, 'youtube');
  if (!code || !userId) return res.status(400).json({ error: 'invalid state or code' });

  try {
    const oauth2Client = getGoogleClient(redirectUri);
    const { tokens } = await oauth2Client.getToken({ code });
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const channelRes = await youtube.channels.list({ mine: true, part: ['snippet'] });
    const channel = channelRes.data.items?.[0];
    const channelMeta = {
      id: channel?.id || null,
      title: channel?.snippet?.title || 'YouTube channel',
      avatar: channel?.snippet?.thumbnails?.default?.url || '',
      scopes: tokens.scope?.split(' '),
      expiresAt: tokens.expiry_date || null
    };

    const docRef = getFirestoreDoc(userId, 'youtube');
    await docRef.set({
      provider: 'youtube',
      tokens: encrypt({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
        expiry: tokens.expiry_date
      }),
      channel: channelMeta,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ channel: channelMeta });
  } catch (error) {
    console.error('Google OAuth error', error);
    res.status(500).json({ error: 'Unable to complete Google OAuth flow' });
  }
});

app.post('/api/oauth/twitch/url', (req, res) => {
  const { userId, redirectUri = TWITCH_REDIRECT_URI } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const state = buildState(userId, 'twitch');
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'user:read:email channel:read:stream_key channel:manage:broadcast',
    state
  });
  res.json({ url: `https://id.twitch.tv/oauth2/authorize?${params.toString()}` });
});

app.post('/api/oauth/twitch/callback', async (req, res) => {
  const { code, state, redirectUri = TWITCH_REDIRECT_URI } = req.body;
  const userId = validateState(state, 'twitch');
  if (!code || !userId) return res.status(400).json({ error: 'invalid state or code' });

  try {
    const tokenParams = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams
    });
    const tokens = await tokenRes.json();

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-Id': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${tokens.access_token}`
      }
    });
    const userData = await userRes.json();
    const channel = userData.data?.[0];

    let streamKey = null;
    if (channel?.id) {
      const keyRes = await fetch(`https://api.twitch.tv/helix/streams/key?broadcaster_id=${channel.id}`, {
        headers: {
          'Client-Id': TWITCH_CLIENT_ID,
          Authorization: `Bearer ${tokens.access_token}`
        }
      });
      const keyData = await keyRes.json();
      streamKey = keyData.data?.[0]?.stream_key || null;
    }

    const docRef = getFirestoreDoc(userId, 'twitch');
    await docRef.set({
      provider: 'twitch',
      tokens: encrypt({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
        expiresIn: tokens.expires_in
      }),
      channel: {
        id: channel?.id,
        title: channel?.display_name || 'Twitch Channel',
        avatar: channel?.profile_image_url || '',
        streamKey
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ channel: docRef.id, streamKey });
  } catch (error) {
    console.error('Twitch OAuth error', error);
    res.status(500).json({ error: 'Unable to complete Twitch OAuth flow' });
  }
});

app.post('/api/oauth/disconnect', async (req, res) => {
  const { userId, platform } = req.body;
  if (!userId || !platform) return res.status(400).json({ error: 'userId and platform required' });
  await getFirestoreDoc(userId, platform.toLowerCase()).delete();
  res.json({ status: 'disconnected' });
});

app.get('/api/oauth/status', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const snapshot = await db.collection('users').doc(userId).collection('destinations').get();
  const results = {};
  snapshot.forEach((doc) => {
    const data = doc.data();
    results[doc.id] = {
      channel: data.channel,
      scopes: decrypt(data.tokens)?.scope,
      updatedAt: data.updatedAt?.toDate?.() || null
    };
  });
  res.json({ destinations: results });
});

app.post('/api/go-live', async (req, res) => {
  const { userId, title, destinations = [], manualTargets = [] } = req.body;
  if (!userId || !title) return res.status(400).json({ error: 'userId and title required' });
  try {
    const orchestrator = new BroadcastOrchestrator({ db, decrypt, userId });
    const result = await orchestrator.goLive({ title, destinations, manualTargets });
    res.json(result);
  } catch (error) {
    console.error('Go live orchestration failed', error);
    res.status(500).json({ error: 'Unable to start broadcast' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`OAuth broker listening on ${port}`);
  });
}
