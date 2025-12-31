const admin = require('../_lib/firebase-admin');
const { getYoutubeClientForUser } = require('../_lib/youtube-client');

const ALLOWED_STATUSES = new Set(['testing', 'live', 'complete']);

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const payload = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
    const idToken = typeof payload?.idToken === 'string' ? payload.idToken : '';
    const broadcastId = typeof payload?.broadcastId === 'string' ? payload.broadcastId : '';
    const requestedStatus = typeof payload?.status === 'string' ? payload.status.toLowerCase() : '';

    if (!idToken || !broadcastId || !ALLOWED_STATUSES.has(requestedStatus)) {
        res.status(400).json({ error: 'Invalid request payload.' });
        return;
    }

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
    } catch (error) {
        console.error('Transition broadcast token verification failed:', error);
        res.status(401).json({ error: 'Invalid authentication token.' });
        return;
    }

    try {
        const { youtube, oauth2Client } = await getYoutubeClientForUser(uid);
        const statusesToApply = requestedStatus === 'live' ? ['testing', 'live'] : [requestedStatus];
        let finalStatus = requestedStatus;

        for (const status of statusesToApply) {
            try {
                const response = await youtube.liveBroadcasts.transition({
                    auth: oauth2Client,
                    id: broadcastId,
                    part: 'status',
                    broadcastStatus: status
                });
                finalStatus = response?.data?.status?.lifeCycleStatus || status;
            } catch (error) {
                const canIgnore = requestedStatus === 'live' && status === 'testing';
                if (!canIgnore) {
                    throw error;
                }
                console.warn('Testing transition skipped, continuing to live:', error?.message || error);
            }
        }

        res.status(200).json({
            broadcastId,
            status: finalStatus
        });
    } catch (error) {
        const statusCode = error?.statusCode || error?.code || 500;
        console.error('Unable to transition YouTube broadcast:', error);
        res.status(Number.isInteger(statusCode) ? statusCode : 500).json({
            error: error?.message || 'Unable to update broadcast state.'
        });
    }
};

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}
