const crypto = require('crypto');
const admin = require('../_lib/firebase-admin');
const { createStateToken } = require('../_lib/oauth-state');

const DEFAULT_SCOPES = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload'
];

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        res.status(500).json({ error: 'YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_REDIRECT_URI.' });
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
        console.error('Unable to verify Firebase ID token for YouTube OAuth start:', error);
        res.status(401).json({ error: 'Invalid authentication token.' });
        return;
    }

    const scopeList = (process.env.YOUTUBE_SCOPES || '').trim();
    const scopes = scopeList ? scopeList.split(/[\s,]+/).filter(Boolean) : DEFAULT_SCOPES;

    const state = createStateToken({
        uid: decodedToken.uid,
        provider: 'youtube',
        nonce: crypto.randomBytes(16).toString('hex'),
        ts: Date.now()
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        scope: scopes.join(' '),
        state
    });

    const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.status(200).json({ authorizationUrl });
};

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}
