module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
        relayUrl: process.env.STREAM_RELAY_URL || '',
        appBaseUrl: process.env.APP_BASE_URL || ''
    });
};
