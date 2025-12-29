const crypto = require('crypto');

function getStateSecret() {
    const secret = process.env.OAUTH_STATE_SECRET;
    if (!secret) {
        throw new Error('OAUTH_STATE_SECRET environment variable is required for OAuth state management.');
    }
    return secret;
}

function base64UrlEncode(buffer) {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
    const padLength = (4 - (value.length % 4)) % 4;
    const padded = `${value}${'='.repeat(padLength)}`;
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function createStateToken(payload = {}) {
    const serialized = JSON.stringify(payload);
    const encodedPayload = base64UrlEncode(Buffer.from(serialized, 'utf8'));
    const signature = crypto
        .createHmac('sha256', getStateSecret())
        .update(encodedPayload)
        .digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${encodedPayload}.${signature}`;
}

function verifyStateToken(token) {
    if (!token || typeof token !== 'string') {
        throw new Error('Missing state token.');
    }
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
        throw new Error('Invalid state token.');
    }
    const expectedSignature = crypto
        .createHmac('sha256', getStateSecret())
        .update(encodedPayload)
        .digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
        throw new Error('State token validation failed.');
    }

    try {
        const decoded = base64UrlDecode(encodedPayload).toString('utf8');
        return JSON.parse(decoded);
    } catch (error) {
        throw new Error('Unable to parse state token.');
    }
}

module.exports = {
    createStateToken,
    verifyStateToken
};
