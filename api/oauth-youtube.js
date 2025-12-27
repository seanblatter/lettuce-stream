const initFirebase = require('./_firebase-admin');
const fetch = (...args) => (typeof global.fetch === 'function' ? global.fetch(...args) : import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args)));

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const payload = parsePayload(req.body);
    const action = (payload.action || '').toLowerCase();

    try {
        switch (action) {
            case 'start':
                return await handleStart(payload, res);
            case 'exchange':
                return await handleExchange(req, res, payload);
            case 'refresh':
                return await handleRefresh(req, res, payload);
            case 'disconnect':
                return await handleDisconnect(req, res);
            default:
                res.status(400).json({ error: 'Unsupported action' });
        }
    } catch (error) {
        console.error('YouTube OAuth error:', error);
        const status = error.status || 500;
        res.status(status).json({ error: error.message || 'Unexpected error handling YouTube OAuth' });
    }
};

async function handleStart(payload, res) {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    if (!clientId) {
        res.status(500).json({ error: 'YouTube client ID is not configured.' });
        return;
    }

    const redirectUri = payload.redirectUri;
    if (!redirectUri) {
        res.status(400).json({ error: 'redirectUri is required' });
        return;
    }

    const state = payload.state || '';
    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', YOUTUBE_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);

    res.status(200).json({ authorizationUrl: url.toString() });
}

async function handleExchange(req, res, payload) {
    const { uid, firestore } = await requireUser(req);

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const { code, redirectUri } = payload;

    if (!clientId || !clientSecret) {
        res.status(500).json({ error: 'YouTube credentials are not configured.' });
        return;
    }

    if (!code || !redirectUri) {
        res.status(400).json({ error: 'Authorization code and redirectUri are required.' });
        return;
    }

    const tokenResponse = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        }).toString()
    });

    if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();
        console.error('YouTube token exchange failed', errorBody);
        res.status(502).json({ error: 'Unable to exchange authorization code.' });
        return;
    }

    const tokenPayload = await tokenResponse.json();
    const existingDoc = await firestore.doc(`users/${uid}/integrations/youtube`).get();
    const previous = existingDoc.exists ? existingDoc.data() : {};

    const expiresAt = calculateExpiry(tokenPayload.expires_in);
    const integrationRecord = {
        provider: 'youtube',
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token || previous.refreshToken,
        scope: tokenPayload.scope || YOUTUBE_SCOPE,
        tokenType: tokenPayload.token_type || 'Bearer',
        expiresAt,
        updatedAt: getAdmin().firestore.FieldValue.serverTimestamp()
    };

    await firestore.doc(`users/${uid}/integrations/youtube`).set(integrationRecord, { merge: true });

    res.status(200).json({
        status: 'connected',
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        scope: integrationRecord.scope
    });
}

async function handleRefresh(req, res) {
    const { uid, firestore } = await requireUser(req);
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        res.status(500).json({ error: 'YouTube credentials are not configured.' });
        return;
    }

    const docRef = firestore.doc(`users/${uid}/integrations/youtube`);
    const existingDoc = await docRef.get();
    const integration = existingDoc.exists ? existingDoc.data() : null;

    if (!integration?.refreshToken) {
        res.status(400).json({ error: 'No refresh token available for YouTube.' });
        return;
    }

    const refreshResponse = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: integration.refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        }).toString()
    });

    if (!refreshResponse.ok) {
        const errorBody = await refreshResponse.text();
        console.error('YouTube token refresh failed', errorBody);
        res.status(502).json({ error: 'Unable to refresh YouTube token.' });
        return;
    }

    const refreshed = await refreshResponse.json();
    const expiresAt = calculateExpiry(refreshed.expires_in);

    await docRef.set({
        accessToken: refreshed.access_token,
        expiresAt,
        scope: refreshed.scope || integration.scope || YOUTUBE_SCOPE,
        tokenType: refreshed.token_type || integration.tokenType || 'Bearer',
        updatedAt: getAdmin().firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({ status: 'refreshed', expiresAt: expiresAt ? expiresAt.toISOString() : null });
}

async function handleDisconnect(req, res) {
    const { uid, firestore } = await requireUser(req);
    const clientId = process.env.YOUTUBE_CLIENT_ID;

    const docRef = firestore.doc(`users/${uid}/integrations/youtube`);
    const existingDoc = await docRef.get();
    const integration = existingDoc.exists ? existingDoc.data() : null;

    if (integration?.accessToken || integration?.refreshToken) {
        await fetch(`${REVOKE_URL}?token=${encodeURIComponent(integration.refreshToken || integration.accessToken)}&client_id=${encodeURIComponent(clientId || '')}`, {
            method: 'POST'
        }).catch((error) => console.warn('YouTube revoke failed', error));
    }

    await docRef.delete();
    res.status(200).json({ status: 'disconnected' });
}

async function requireUser(req) {
    const admin = getAdmin();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : null;

    if (!token) {
        const error = new Error('Missing authentication');
        error.status = 401;
        throw error;
    }

    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded?.uid) {
        const error = new Error('Invalid authentication');
        error.status = 401;
        throw error;
    }

    return { uid: decoded.uid, firestore: admin.firestore() };
}

function calculateExpiry(expiresInSeconds) {
    if (!expiresInSeconds) {
        return null;
    }
    const now = Date.now();
    return new Date(now + Number(expiresInSeconds) * 1000);
}

function parsePayload(body) {
    if (!body) return {};
    if (typeof body === 'string') {
        try {
            return JSON.parse(body);
        } catch (error) {
            return {};
        }
    }
    return body;
}

function getAdmin() {
    return initFirebase();
}
