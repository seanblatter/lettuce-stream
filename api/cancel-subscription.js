const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeClient = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' }) : null;

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (!stripeClient) {
        res.status(500).json({ error: 'Stripe secret key is not configured.' });
        return;
    }

    const payload = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
    const subscriptionId = typeof payload?.subscriptionId === 'string' ? payload.subscriptionId.trim() : '';

    if (!subscriptionId) {
        res.status(400).json({ error: 'A Stripe subscription id is required.' });
        return;
    }

    try {
        const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
        if (subscription.status === 'canceled') {
            res.status(200).json({ cancelled: true, subscriptionId, status: 'canceled' });
            return;
        }

        const cancellation = await stripeClient.subscriptions.cancel(subscriptionId);
        res.status(200).json({
            cancelled: true,
            subscriptionId: cancellation.id,
            status: cancellation.status
        });
    } catch (error) {
        console.error('Stripe subscription cancellation failed:', error);
        const statusCode = error?.statusCode || 500;
        res.status(statusCode).json({ error: 'Unable to cancel Stripe subscription. Please try again.' });
    }
};

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}
