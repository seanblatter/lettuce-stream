const fetch = require('node-fetch');
const admin = require('../_lib/firebase-admin');
const { verifyStateToken } = require('../_lib/oauth-state');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const { code, state, error: oauthError } = parseQueryParams(req);

    if (oauthError) {
        redirectWithStatus(req, res, { provider: 'youtube', success: false, reason: oauthError });
        return;
    }

    if (!code || !state) {
        redirectWithStatus(req, res, { provider: 'youtube', success: false, reason: 'missing_code' });
        return;
    }

    let statePayload;
    try {
        statePayload = verifyStateToken(state);
    } catch (error) {
        console.error('Invalid YouTube OAuth state:', error);
        redirectWithStatus(req, res, { provider: 'youtube', success: false, reason: 'invalid_state' });
        return;
    }

    if (statePayload.provider !== 'youtube' || !statePayload.uid) {
        redirectWithStatus(req, res, { provider: 'youtube', success: false, reason: 'state_provider_mismatch' });
        return;
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        console.error('YouTube OAuth callback missing environment configuration.');
        res.status(500).json({ error: 'YouTube OAuth is not configured.' });
        return;
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        })
    });

    if (!tokenResponse.ok) {
        console.error('YouTube token exchange failed:', await safeJson(tokenResponse));
        redirectWithStatus(req, res, { provider: 'youtube', success: false, reason: 'token_exchange_failed' });
        return;
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    if (!accessToken || !refreshToken) {
        console.error('YouTube token payload missing access or refresh token.');
        redirectWithStatus(req, res, { provider: 'youtube', success: false, reason: 'token_payload_missing' });
        return;
    }

    let channelMeta = {};
    try {
        const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (channelResponse.ok) {
            const payload = await channelResponse.json();
            const channel = Array.isArray(payload.items) ? payload.items[0] : null;
            channelMeta = {
                channelId: channel?.id || null,
                title: channel?.snippet?.title || 'YouTube channel',
                avatar: channel?.snippet?.thumbnails?.default?.url || ''
            };
        }
    } catch (error) {
        console.warn('Unable to fetch YouTube channel metadata:', error);
    }

    const firestore = admin.firestore();
    const docRef = firestore.collection('users').doc(statePayload.uid);

    try {
        await docRef.set({
            channelConnections: {
                youtube: {
                    channelId: channelMeta.channelId || null,
                    title: channelMeta.title || 'YouTube channel',
                    avatar: channelMeta.avatar || '',
                    linkedAt: admin.firestore.FieldValue.serverTimestamp()
                }
            }
        }, { merge: true });

        await firestore.collection('channelSecrets').doc(`${statePayload.uid}_youtube`).set({
            provider: 'youtube',
            refreshToken,
            accessToken,
            scope: tokens.scope || '',
            expiresAt: tokens.expires_in
                ? admin.firestore.Timestamp.fromMillis(Date.now() + (tokens.expires_in * 1000))
                : null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error('Unable to persist YouTube connection:', error);
        redirectWithStatus(req, res, { provider: 'youtube', success: false, reason: 'persistence_failed' });
        return;
    }

    redirectWithStatus(req, res, { provider: 'youtube', success: true });
};

function parseQueryParams(req) {
    const origin = `${getProtocol(req)}://${req.headers.host || 'localhost'}`;
    const url = new URL(req.url, origin);
    return {
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        error: url.searchParams.get('error')
    };
}

function redirectWithStatus(req, res, { provider, success, reason }) {
    const location = buildRedirectUrl(req, success ? { connected: provider } : { connectError: provider, reason });
    res.writeHead(302, { Location: location });
    res.end();
}

function buildRedirectUrl(req, params = {}) {
    const basePath = process.env.OAUTH_REDIRECT_PATH || '/dashboard.html';
    const origin = process.env.APP_BASE_URL || `${getProtocol(req)}://${req.headers.host || 'localhost'}`;
    const url = new URL(basePath, origin);
    Object.entries(params).forEach(([key, value]) => {
        if (value) {
            url.searchParams.set(key, value);
        }
    });
    return url.toString();
}

function getProtocol(req) {
    return req.headers['x-forwarded-proto'] || 'https';
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch (error) {
        return await response.text();
    }
}
