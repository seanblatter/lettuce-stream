const { google } = require('googleapis');
const admin = require('./firebase-admin');

function getYoutubeEnv() {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error('YouTube API credentials are not configured. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI.');
    }

    return { clientId, clientSecret, redirectUri };
}

async function getYoutubeClientForUser(uid) {
    if (!uid) {
        const error = new Error('Missing user id.');
        error.statusCode = 401;
        throw error;
    }

    const secretDoc = await admin.firestore().collection('channelSecrets').doc(`${uid}_youtube`).get();
    if (!secretDoc.exists) {
        const error = new Error('YouTube is not connected for this user.');
        error.statusCode = 404;
        throw error;
    }

    const secretData = secretDoc.data() || {};
    if (!secretData.refreshToken) {
        const error = new Error('YouTube OAuth refresh token is missing. Ask the user to reconnect.');
        error.statusCode = 400;
        throw error;
    }

    const { clientId, clientSecret, redirectUri } = getYoutubeEnv();
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({ refresh_token: secretData.refreshToken });

    return {
        oauth2Client,
        youtube: google.youtube('v3'),
        secretData
    };
}

module.exports = {
    getYoutubeClientForUser
};
