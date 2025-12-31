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
                const response = await applyTransitionWithRetry({
                    youtube,
                    oauth2Client,
                    broadcastId,
                    status,
                    allowRetries: requestedStatus === 'live'
                });
                finalStatus = response?.data?.status?.lifeCycleStatus || status;
            } catch (error) {
                const snapshot = await fetchBroadcastStatus({ youtube, oauth2Client, broadcastId });
                const snapshotStatus = snapshot?.status?.lifeCycleStatus;
                if (snapshotStatus === status) {
                    finalStatus = snapshotStatus;
                    console.warn(`Broadcast already in ${status} state, skipping explicit transition.`);
                    continue;
                }
                const canIgnore = requestedStatus === 'live' && status === 'testing';
                if (!canIgnore) {
                    error.snapshotStatus = snapshotStatus || null;
                    throw error;
                }
                console.warn('Testing transition skipped, continuing to live:', formatTransitionError(error));
            }
        }

        res.status(200).json({
            broadcastId,
            status: finalStatus
        });
    } catch (error) {
        const statusCode = error?.statusCode || error?.code || 500;
        console.error('Unable to transition YouTube broadcast:', formatTransitionError(error));
        res.status(Number.isInteger(statusCode) ? statusCode : 500).json({
            error: error?.message || 'Unable to update broadcast state.',
            reason: extractErrorReason(error),
            snapshotStatus: error?.snapshotStatus || null
        });
    }
};

async function applyTransitionWithRetry({ youtube, oauth2Client, broadcastId, status, allowRetries }) {
    const attempts = allowRetries ? 4 : 1;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await youtube.liveBroadcasts.transition({
                auth: oauth2Client,
                id: broadcastId,
                part: 'status',
                broadcastStatus: status
            });
        } catch (error) {
            lastError = error;
            if (!shouldRetryTransition(error, attempt, attempts)) {
                throw error;
            }
            const backoffMs = 1500 * attempt;
            console.warn(`Transition to ${status} not ready, retrying in ${backoffMs}ms…`, formatTransitionError(error));
            await wait(backoffMs);
        }
    }

    throw lastError;
}

function shouldRetryTransition(error, attempt, attempts) {
    if (attempt >= attempts) {
        return false;
    }
    const reason = extractErrorReason(error);
    const message = extractErrorMessage(error);
    if (!reason) {
        return false;
    }
    if (reason !== 'forbidden' && reason !== 'invalidTransition') {
        return false;
    }
    return /cannot transition|not in the .* state|forbidden/i.test(message || '');
}

function extractErrorReason(error) {
    const detail = extractErrorDetail(error);
    return detail?.reason || error?.reason || null;
}

function extractErrorMessage(error) {
    const detail = extractErrorDetail(error);
    return detail?.message || error?.message || '';
}

function extractErrorDetail(error) {
    if (error?.errors && Array.isArray(error.errors) && error.errors.length) {
        return error.errors[0];
    }
    const responseErrors = error?.response?.data?.error?.errors;
    if (Array.isArray(responseErrors) && responseErrors.length) {
        return responseErrors[0];
    }
    return null;
}

function formatTransitionError(error) {
    const reason = extractErrorReason(error);
    const message = extractErrorMessage(error);
    return reason ? `${message || 'Transition failed'} (reason: ${reason})` : message || 'Transition failed';
}

async function fetchBroadcastStatus({ youtube, oauth2Client, broadcastId }) {
    try {
        const response = await youtube.liveBroadcasts.list({
            auth: oauth2Client,
            id: broadcastId,
            part: 'status'
        });
        const item = Array.isArray(response?.data?.items) ? response.data.items[0] : null;
        return item?.status ? { status: item.status } : null;
    } catch (error) {
        console.warn('Unable to fetch broadcast status snapshot:', formatTransitionError(error));
        return null;
    }
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}
