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
            starter: { monthly: 9, yearly: 108, streams: 2 },
            pro: { monthly: 25, yearly: 300, streams: 4 },
            enterprise: { monthly: 85, yearly: 1020, streams: 5 }
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
                const priceAmountEl = card.querySelector('[data-price-amount]');
                const pricePeriodEl = card.querySelector('[data-price-period]');
                const noteEl = card.querySelector('[data-billing-note]');
                const impactEl = card.querySelector('[data-impact-copy]');
                if (priceAmountEl) {
                    priceAmountEl.textContent = formatCurrency(planConfig[mode]);
                }
                if (pricePeriodEl) {
                    pricePeriodEl.textContent = mode === 'monthly' ? '/month' : '/year';
                }
                if (noteEl) {
                    const monthlyRate = formatCurrency(planConfig.monthly);
                    noteEl.textContent = mode === 'monthly'
                        ? 'Billed monthly, cancel anytime.'
                        : `Billed annually (${monthlyRate}/mo equivalent).`;
                }
                if (impactEl) {
                    impactEl.textContent = buildImpactCopy(planConfig.streams, mode);
                }
            });
        }

        function formatCurrency(value) {
            const amount = Number(value || 0);
            return `$${amount.toLocaleString('en-US')}`;
        }

        function buildImpactCopy(streams, billingMode) {
            const noun = streams === 1 ? 'clean water stream' : 'clean water streams';
            const duration = billingMode === 'yearly' ? '12 months' : '1 month';
            return `Funds ${duration} of clean water for ${streams} ${noun} via TeamWater.org.`;
        }
    }
});
