const Stripe = require('stripe');

const PLAN_PRODUCT_MAP = {
    starter: {
        label: 'Starter',
        productId: 'prod_Tg6YgICMCMqzgO'
    },
    pro: {
        label: 'Pro',
        productId: 'prod_Tg6ZKTTmg46wZN'
    },
    enterprise: {
        label: 'Enterprise',
        productId: 'prod_Tg6ZHgUFji0S7d'
    }
};

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
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

    if (!publishableKey) {
        res.status(500).json({ error: 'Stripe publishable key is not configured.' });
        return;
    }

    const payload = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
    const requestedPlan = typeof payload?.plan === 'string' ? payload.plan.toLowerCase() : '';
    const customerEmail = typeof payload?.customerEmail === 'string' ? payload.customerEmail : undefined;
    const userId = typeof payload?.uid === 'string' ? payload.uid : undefined;

    const planConfig = PLAN_PRODUCT_MAP[requestedPlan];

    if (!planConfig) {
        res.status(400).json({ error: 'Invalid plan selection.' });
        return;
    }

    try {
        const product = await stripeClient.products.retrieve(planConfig.productId, {
            expand: ['default_price']
        });
        const price = product?.default_price;

        if (!price || !price.unit_amount || !price.currency) {
            res.status(500).json({ error: 'Plan is not configured with a default price.' });
            return;
        }

        const paymentIntent = await stripeClient.paymentIntents.create({
            amount: price.unit_amount,
            currency: price.currency,
            automatic_payment_methods: { enabled: true },
            receipt_email: customerEmail,
            description: `${planConfig.label} plan subscription`,
            metadata: {
                plan: requestedPlan,
                product_id: planConfig.productId,
                uid: userId || ''
            }
        });

        res.status(200).json({
            clientSecret: paymentIntent.client_secret,
            publishableKey,
            amount: price.unit_amount,
            currency: price.currency,
            plan: requestedPlan,
            label: planConfig.label
        });
    } catch (error) {
        console.error('Stripe checkout error:', error);
        res.status(500).json({ error: 'Unable to start checkout. Please try again later.' });
    }
};

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}
