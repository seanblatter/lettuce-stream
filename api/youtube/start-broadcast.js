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
        const now = new Date();
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

        const streamId = streamResponse?.data?.id;
        const ingestionInfo = streamResponse?.data?.cdn?.ingestionInfo || {};

        if (!streamId || !ingestionInfo.ingestionAddress || !ingestionInfo.streamName) {
            res.status(500).json({ error: 'YouTube did not return ingestion details.' });
            return;
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

        const broadcastId = broadcastResponse?.data?.id;
        if (!broadcastId) {
            res.status(500).json({ error: 'YouTube broadcast could not be created.' });
            return;
        }

        await youtube.liveBroadcasts.bind({
            auth: oauth2Client,
            part: 'id,contentDetails',
            id: broadcastId,
            requestBody: {
                streamId
            }
        });

        res.status(200).json({
            broadcastId,
            streamId,
            ingestionAddress: ingestionInfo.ingestionAddress,
            streamName: ingestionInfo.streamName,
            streamKey: ingestionInfo.streamName,
            rtmpUrl: `${ingestionInfo.ingestionAddress}/${ingestionInfo.streamName}`
        });
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
