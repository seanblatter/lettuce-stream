const admin = require('firebase-admin');

let initialized = false;

function initFirebaseAdmin() {
    if (initialized) {
        return admin;
    }

    if (admin.apps.length) {
        initialized = true;
        return admin;
    }

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccountJson) {
        let credentials;
        try {
            credentials = JSON.parse(serviceAccountJson);
        } catch (error) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must be valid JSON.');
        }
        admin.initializeApp({
            credential: admin.credential.cert(credentials),
            projectId: credentials.project_id || process.env.FIREBASE_PROJECT_ID
        });
        initialized = true;
        return admin;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_PROJECT_ID) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: process.env.FIREBASE_PROJECT_ID
        });
        initialized = true;
        return admin;
    }

    throw new Error('Firebase Admin SDK is not configured. Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.');
}

module.exports = initFirebaseAdmin();
