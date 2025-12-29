// Mobile Menu Toggle
document.addEventListener('DOMContentLoaded', function() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileMenu = document.getElementById('mobileMenu');

    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.addEventListener('click', function() {
            mobileMenu.classList.toggle('active');
        });

        // Close mobile menu when clicking on a link
        const menuLinks = mobileMenu.querySelectorAll('a');
        menuLinks.forEach(link => {
            link.addEventListener('click', function() {
                mobileMenu.classList.remove('active');
            });
        });
    }

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href !== '#' && href.length > 1) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    const offset = 80; // Account for fixed navbar
                    const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - offset;
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });

    // Add scroll effect to navbar
    let lastScroll = 0;
    const navbar = document.querySelector('.navbar');

    window.addEventListener('scroll', function() {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 100) {
            navbar.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        } else {
            navbar.style.boxShadow = 'none';
        }

        lastScroll = currentScroll;
    });

    // Get plan from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const plan = urlParams.get('plan');
    if (plan) {
        sessionStorage.setItem('selectedPlan', plan);
    }

    const pricingCards = document.querySelectorAll('[data-plan-card]');
    const billingToggleButtons = document.querySelectorAll('[data-billing-option]');
    if (pricingCards.length && billingToggleButtons.length) {
        const PRICING_CONFIG = {
            starter: {
                monthly: { amount: 9, period: '/month', note: 'Billed monthly, cancel anytime.', slug: 'starter-monthly' },
                yearly: { amount: 108, period: '/year', note: 'Billed annually ($9/mo equivalent).', slug: 'starter-yearly' }
            },
            pro: {
                monthly: { amount: 25, period: '/month', note: 'Billed monthly, cancel anytime.', slug: 'pro-monthly' },
                yearly: { amount: 300, period: '/year', note: 'Billed annually ($25/mo equivalent).', slug: 'pro-yearly' }
            },
            enterprise: {
                monthly: { amount: 85, period: '/month', note: 'Billed monthly, cancel anytime.', slug: 'enterprise-monthly' },
                yearly: { amount: 1020, period: '/year', note: 'Billed annually ($85/mo equivalent).', slug: 'enterprise-yearly' }
            }
        };
        let activeBillingMode = '';

        billingToggleButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const nextMode = button.dataset.billingOption;
                if (nextMode) {
                    setBillingMode(nextMode);
                }
            });
        });

        setBillingMode('monthly');

        function setBillingMode(mode) {
            if (!['monthly', 'yearly'].includes(mode) || mode === activeBillingMode) {
                return;
            }
            activeBillingMode = mode;
            billingToggleButtons.forEach((button) => {
                const isActive = button.dataset.billingOption === mode;
                button.classList.toggle('active', isActive);
            });
            pricingCards.forEach((card) => {
                const planKey = card.dataset.planCard;
                const planConfig = PRICING_CONFIG[planKey];
                if (!planConfig) {
                    return;
                }
                const modeConfig = planConfig[mode];
                if (!modeConfig) {
                    return;
                }
                const priceAmountEl = card.querySelector('[data-price-amount]');
                const pricePeriodEl = card.querySelector('[data-price-period]');
                const noteEl = card.querySelector('[data-billing-note]');
                const ctaEl = card.querySelector('[data-plan-cta]');
                if (priceAmountEl) {
                    priceAmountEl.textContent = formatCurrency(modeConfig.amount);
                }
                if (pricePeriodEl) {
                    pricePeriodEl.textContent = modeConfig.period;
                }
                if (noteEl) {
                    noteEl.textContent = modeConfig.note;
                }
                if (ctaEl && modeConfig.slug) {
                    ctaEl.href = `signup.html?plan=${modeConfig.slug}`;
                }
            });
        }

        function formatCurrency(value) {
            const amount = Number(value || 0);
            return `$${amount.toLocaleString('en-US')}`;
        }
    }
});
