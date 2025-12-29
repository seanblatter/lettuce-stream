const admin = require('../_lib/firebase-admin');

const ALLOWED_PROVIDERS = new Set(['youtube', 'twitch']);

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const payload = typeof req.body === 'string' ? safeJsonParse(req.body) : (req.body || {});
    const idToken = typeof payload.idToken === 'string' ? payload.idToken : '';
    const providerKey = typeof payload.provider === 'string' ? payload.provider.toLowerCase() : '';

    if (!idToken || !providerKey) {
        res.status(400).json({ error: 'Missing authentication token or provider.' });
        return;
    }

    if (!ALLOWED_PROVIDERS.has(providerKey)) {
        res.status(400).json({ error: 'Unsupported provider.' });
        return;
    }

    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
        console.error('Unable to verify Firebase ID token for disconnect:', error);
        res.status(401).json({ error: 'Invalid authentication token.' });
        return;
    }

    const firestore = admin.firestore();
    const docRef = firestore.collection('users').doc(decodedToken.uid);

    try {
        await docRef.set({
            channelConnections: {
                [providerKey]: admin.firestore.FieldValue.delete()
            }
        }, { merge: true });
    } catch (error) {
        console.warn('Unable to remove provider metadata during disconnect:', error);
    }

    try {
        await firestore.collection('channelSecrets').doc(`${decodedToken.uid}_${providerKey}`).delete();
    } catch (error) {
        if (error.code !== 5) {
            console.warn('Unable to remove provider secrets during disconnect:', error);
        }
    }

    res.status(200).json({ disconnected: true, provider: providerKey });
};

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}
