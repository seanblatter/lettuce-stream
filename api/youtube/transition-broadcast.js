const admin = require('../_lib/firebase-admin');
const { getYoutubeClientForUser } = require('../_lib/youtube-client');

const ALLOWED_STATUSES = new Set(['testing', 'live', 'complete']);
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 15000;

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
        const currentLifecycle = await fetchBroadcastStatus({ youtube, oauth2Client, broadcastId });
        let currentStatus = currentLifecycle?.status?.lifeCycleStatus || 'unknown';

        const statusesToApply = determineTransitions(currentStatus, requestedStatus);

        if (!statusesToApply.length) {
            res.status(200).json({
                broadcastId,
                status: currentStatus
            });
            return;
        }
        let finalStatus = currentStatus;
        const requiresLive = requestedStatus === 'live' && statusesToApply.includes('live');

        for (const status of statusesToApply) {
            const response = await applyTransitionWithRetry({
                youtube,
                oauth2Client,
                broadcastId,
                status,
                allowRetries: status !== 'complete'
            });
            finalStatus = response?.data?.status?.lifeCycleStatus || status;

            if (requiresLive && status === 'testing') {
                finalStatus = await waitForLifecycleState({
                    youtube,
                    oauth2Client,
                    broadcastId,
                    desiredStates: ['testing', 'live'],
                    timeoutMessage: 'Broadcast never stabilized in testing state before going live.',
                    initialStatus: finalStatus
                });
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
    const attempts = allowRetries ? 8 : 1;
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

function determineTransitions(currentStatus, requestedStatus) {
    if (currentStatus === requestedStatus) {
        return [];
    }

    if (requestedStatus === 'testing') {
        if (currentStatus === 'testing') {
            return [];
        }
        if (currentStatus === 'live') {
            return [];
        }
        return ['testing'];
    }

    if (requestedStatus === 'live') {
        if (currentStatus === 'live') {
            return [];
        }
        if (currentStatus === 'complete') {
            return [];
        }
        if (currentStatus === 'testing') {
            return ['live'];
        }
        return ['testing', 'live'];
    }

    if (requestedStatus === 'complete') {
        if (currentStatus === 'complete') {
            return [];
        }
        return ['complete'];
    }

    return [requestedStatus];
}

async function waitForLifecycleState({ youtube, oauth2Client, broadcastId, desiredStates, timeoutMessage, initialStatus }) {
    if (initialStatus && desiredStates.includes(initialStatus)) {
        return initialStatus;
    }

    let lastStatus = initialStatus || 'unknown';
    const startedAt = Date.now();

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await wait(POLL_INTERVAL_MS);
        const snapshot = await fetchBroadcastStatus({ youtube, oauth2Client, broadcastId });
        const status = snapshot?.status?.lifeCycleStatus;
        if (status && desiredStates.includes(status)) {
            return status;
        }
        if (status) {
            lastStatus = status;
        }
    }

    const error = new Error(timeoutMessage);
    error.snapshotStatus = lastStatus === 'unknown' ? null : lastStatus;
    error.statusCode = 504;
    throw error;
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
