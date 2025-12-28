const admin = require('firebase-admin');

let initialized = false;

function initFirebase() {
    if (initialized) {
        return admin;
    }

    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!admin.apps.length) {
        if (!rawServiceAccount) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is required to persist integration tokens.');
        }

        let credentials;
        try {
            credentials = typeof rawServiceAccount === 'string' ? JSON.parse(rawServiceAccount) : rawServiceAccount;
        } catch (error) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid JSON.');
        }

        admin.initializeApp({
            credential: admin.credential.cert(credentials)
        });
    }

    initialized = true;
    return admin;
}

module.exports = initFirebase;
