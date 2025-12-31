const admin = require('../_lib/firebase-admin');
const { getYoutubeClientForUser } = require('../_lib/youtube-client');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const payload = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
    const idToken = typeof payload?.idToken === 'string' ? payload.idToken : '';
    const title = typeof payload?.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Lettuce Stream Live';

    if (!idToken) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
    }

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
    } catch (error) {
        console.error('Invalid Firebase ID token for YouTube broadcast start:', error);
        res.status(401).json({ error: 'Invalid authentication token.' });
        return;
    }

    try {
        const { youtube, oauth2Client } = await getYoutubeClientForUser(uid);
        const payload = await startBroadcastWithRetries({ youtube, oauth2Client, title });

        res.status(200).json(payload);
    } catch (error) {
        const statusCode = error?.statusCode || error?.code || 500;
        console.error('Unable to start YouTube broadcast:', error);
        res.status(Number.isInteger(statusCode) ? statusCode : 500).json({
            error: error?.message || 'Unable to start YouTube broadcast. Try reconnecting YouTube and trying again.'
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

const MAX_START_ATTEMPTS = 3;
const START_RETRY_DELAY_MS = 2000;
const PUBLISH_POLL_INTERVAL_MS = 1500;
const PUBLISH_TIMEOUT_MS = 60000;

async function startBroadcastWithRetries({ youtube, oauth2Client, title }) {
    let attempt = 0;
    let lastError;

    while (attempt < MAX_START_ATTEMPTS) {
        attempt += 1;
        try {
            return await createBroadcastOnce({ youtube, oauth2Client, title });
        } catch (error) {
            lastError = error;
            console.warn(`YouTube broadcast start attempt ${attempt} failed:`, error?.message || error);
            const retryable = isRetryableStartError(error);
            if (!retryable || attempt === MAX_START_ATTEMPTS) {
                throw error;
            }
            await delay(START_RETRY_DELAY_MS * attempt);
        }
    }

    throw lastError;
}

async function createBroadcastOnce({ youtube, oauth2Client, title }) {
    const now = new Date();
    let streamId;
    let broadcastId;

    try {
        const streamResponse = await youtube.liveStreams.insert({
            auth: oauth2Client,
            part: 'snippet,cdn,contentDetails',
            requestBody: {
                snippet: {
                    title: `${title} • Stream`
                },
                cdn: {
                    ingestionType: 'rtmp',
                    frameRate: 'variable',
                    resolution: 'variable'
                },
                contentDetails: {
                    isReusable: false
                }
            }
        });

        streamId = streamResponse?.data?.id;
        const ingestionInfo = streamResponse?.data?.cdn?.ingestionInfo || {};

        if (!streamId || !ingestionInfo.ingestionAddress || !ingestionInfo.streamName) {
            const error = new Error('YouTube did not return ingestion details.');
            error.statusCode = 500;
            throw error;
        }

        const broadcastResponse = await youtube.liveBroadcasts.insert({
            auth: oauth2Client,
            part: 'snippet,contentDetails,status',
            requestBody: {
                snippet: {
                    title,
                    scheduledStartTime: now.toISOString(),
                    scheduledEndTime: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
                },
                contentDetails: {
                    enableAutoStart: true,
                    enableAutoStop: true
                },
                status: {
                    privacyStatus: 'unlisted'
                }
            }
        });

        broadcastId = broadcastResponse?.data?.id;
        if (!broadcastId) {
            const error = new Error('YouTube broadcast could not be created.');
            error.statusCode = 500;
            throw error;
        }

        await youtube.liveBroadcasts.bind({
            auth: oauth2Client,
            part: 'id,contentDetails',
            id: broadcastId,
            requestBody: {
                streamId
            }
        });

        const lifecycleStatus = await waitForBroadcastPublication({
            youtube,
            oauth2Client,
            broadcastId
        });

        return {
            broadcastId,
            streamId,
            ingestionAddress: ingestionInfo.ingestionAddress,
            streamName: ingestionInfo.streamName,
            streamKey: ingestionInfo.streamName,
            rtmpUrl: `${ingestionInfo.ingestionAddress}/${ingestionInfo.streamName}`,
            lifecycleStatus
        };
    } catch (error) {
        await cleanupBroadcastArtifacts({ youtube, oauth2Client, streamId, broadcastId });
        throw error;
    }
}

async function cleanupBroadcastArtifacts({ youtube, oauth2Client, streamId, broadcastId }) {
    if (broadcastId) {
        try {
            await youtube.liveBroadcasts.delete({ auth: oauth2Client, id: broadcastId });
        } catch (cleanupError) {
            console.warn('Unable to delete temporary YouTube broadcast:', cleanupError?.message || cleanupError);
        }
    }
    if (streamId) {
        try {
            await youtube.liveStreams.delete({ auth: oauth2Client, id: streamId });
        } catch (cleanupError) {
            console.warn('Unable to delete temporary YouTube stream:', cleanupError?.message || cleanupError);
        }
    }
}

function isRetryableStartError(error) {
    const code = Number(error?.statusCode || error?.code);
    const reason = extractYoutubeReason(error);

    if (Number.isInteger(code) && [429, 500, 502, 503, 504].includes(code)) {
        return true;
    }
    if (reason && ['backendError', 'quotaExceeded', 'rateLimitExceeded', 'internalError'].includes(reason)) {
        return true;
    }
    return !Number.isInteger(code);
}

function extractYoutubeReason(error) {
    const responseErrors = error?.response?.data?.error?.errors;
    if (Array.isArray(responseErrors) && responseErrors.length) {
        return responseErrors[0]?.reason || null;
    }
    if (error?.errors && Array.isArray(error.errors) && error.errors.length) {
        return error.errors[0]?.reason || null;
    }
    return error?.reason || null;
}

async function waitForBroadcastPublication({ youtube, oauth2Client, broadcastId }) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < PUBLISH_TIMEOUT_MS) {
        const response = await youtube.liveBroadcasts.list({
            auth: oauth2Client,
            id: broadcastId,
            part: 'status'
        });
        const item = response?.data?.items?.[0];
        if (item) {
            const status = item.status?.lifeCycleStatus || 'created';
            lastStatus = status;
            return status;
        }
        await delay(PUBLISH_POLL_INTERVAL_MS);
    }

    const error = new Error('YouTube did not acknowledge the broadcast in time.');
    error.statusCode = 504;
    error.snapshotStatus = lastStatus;
    throw error;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
