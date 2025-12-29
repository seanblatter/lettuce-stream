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
        redirectWithStatus(req, res, { provider: 'twitch', success: false, reason: oauthError });
        return;
    }

    if (!code || !state) {
        redirectWithStatus(req, res, { provider: 'twitch', success: false, reason: 'missing_code' });
        return;
    }

    let statePayload;
    try {
        statePayload = verifyStateToken(state);
    } catch (error) {
        console.error('Invalid Twitch OAuth state:', error);
        redirectWithStatus(req, res, { provider: 'twitch', success: false, reason: 'invalid_state' });
        return;
    }

    if (statePayload.provider !== 'twitch' || !statePayload.uid) {
        redirectWithStatus(req, res, { provider: 'twitch', success: false, reason: 'state_provider_mismatch' });
        return;
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    const redirectUri = process.env.TWITCH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        console.error('Twitch OAuth callback missing environment configuration.');
        res.status(500).json({ error: 'Twitch OAuth is not configured.' });
        return;
    }

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        })
    });

    if (!tokenResponse.ok) {
        console.error('Twitch token exchange failed:', await safeJson(tokenResponse));
        redirectWithStatus(req, res, { provider: 'twitch', success: false, reason: 'token_exchange_failed' });
        return;
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    if (!accessToken || !refreshToken) {
        console.error('Twitch token payload missing access or refresh token.');
        redirectWithStatus(req, res, { provider: 'twitch', success: false, reason: 'token_payload_missing' });
        return;
    }

    let channelMeta = {};
    try {
        const profileResponse = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Client-ID': clientId
            }
        });
        if (profileResponse.ok) {
            const payload = await profileResponse.json();
            const profile = Array.isArray(payload.data) ? payload.data[0] : null;
            channelMeta = {
                channelId: profile?.id || null,
                title: profile?.display_name || 'Twitch channel',
                avatar: profile?.profile_image_url || ''
            };
        }
    } catch (error) {
        console.warn('Unable to fetch Twitch channel metadata:', error);
    }

    const firestore = admin.firestore();
    const docRef = firestore.collection('users').doc(statePayload.uid);

    try {
        await docRef.set({
            channelConnections: {
                twitch: {
                    channelId: channelMeta.channelId || null,
                    title: channelMeta.title || 'Twitch channel',
                    avatar: channelMeta.avatar || '',
                    linkedAt: admin.firestore.FieldValue.serverTimestamp()
                }
            }
        }, { merge: true });

        await firestore.collection('channelSecrets').doc(`${statePayload.uid}_twitch`).set({
            provider: 'twitch',
            refreshToken,
            accessToken,
            scope: Array.isArray(tokens.scope) ? tokens.scope.join(' ') : '',
            expiresAt: tokens.expires_in
                ? admin.firestore.Timestamp.fromMillis(Date.now() + (tokens.expires_in * 1000))
                : null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error('Unable to persist Twitch connection:', error);
        redirectWithStatus(req, res, { provider: 'twitch', success: false, reason: 'persistence_failed' });
        return;
    }

    redirectWithStatus(req, res, { provider: 'twitch', success: true });
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
