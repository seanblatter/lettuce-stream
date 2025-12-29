const crypto = require('crypto');
const admin = require('../_lib/firebase-admin');
const { createStateToken } = require('../_lib/oauth-state');

const DEFAULT_SCOPES = [
    'channel:manage:broadcast',
    'channel:read:stream_key',
    'user:read:broadcast'
];

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const redirectUri = process.env.TWITCH_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        res.status(500).json({ error: 'Twitch OAuth is not configured. Set TWITCH_CLIENT_ID and TWITCH_REDIRECT_URI.' });
        return;
    }

    const payload = typeof req.body === 'string' ? safeJsonParse(req.body) : (req.body || {});
    const idToken = typeof payload.idToken === 'string' ? payload.idToken : '';

    if (!idToken) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
    }

    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
        console.error('Unable to verify Firebase ID token for Twitch OAuth start:', error);
        res.status(401).json({ error: 'Invalid authentication token.' });
        return;
    }

    const scopeList = (process.env.TWITCH_SCOPES || '').trim();
    const scopes = scopeList ? scopeList.split(/[\s,]+/).filter(Boolean) : DEFAULT_SCOPES;

    const state = createStateToken({
        uid: decodedToken.uid,
        provider: 'twitch',
        nonce: crypto.randomBytes(16).toString('hex'),
        ts: Date.now()
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state,
        force_verify: 'true'
    });

    const authorizationUrl = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
    res.status(200).json({ authorizationUrl });
};

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}
