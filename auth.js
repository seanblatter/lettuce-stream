// Stripe Configuration
// Replace with your actual Stripe publishable key
const stripe = Stripe('pk_test_YOUR_PUBLISHABLE_KEY');

// Check if user is already logged in
auth.onAuthStateChanged((user) => {
    if (user && window.location.pathname !== '/dashboard.html') {
        // User is signed in, redirect to dashboard if not already there
        console.log('User is signed in:', user.email);
    }
});

// Sign Up Form Handler
const signupForm = document.getElementById('signupForm');
if (signupForm) {
    // Pre-select plan from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const planParam = urlParams.get('plan');
    const planSelect = document.getElementById('plan');
    
    if (planParam && planSelect) {
        planSelect.value = planParam;
    }

    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const submitText = document.getElementById('submitText');
        const submitSpinner = document.getElementById('submitSpinner');
        const errorMessage = document.getElementById('errorMessage');
        const successMessage = document.getElementById('successMessage');
        
        // Get form values
        const fullName = document.getElementById('fullName').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const plan = document.getElementById('plan').value;
        const terms = document.getElementById('terms').checked;
        
        // Validate
        if (!terms) {
            showError(errorMessage, 'Please accept the Terms of Service');
            return;
        }
        
        if (!plan) {
            showError(errorMessage, 'Please select a plan');
            return;
        }
        
        // Show loading state
        submitBtn.disabled = true;
        submitText.style.display = 'none';
        submitSpinner.style.display = 'block';
        errorMessage.style.display = 'none';
        
        try {
            // Create user with Firebase Auth
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            // Update user profile
            await user.updateProfile({
                displayName: fullName
            });
            
            // Store user data in Firestore
            await db.collection('users').doc(user.uid).set({
                fullName: fullName,
                email: email,
                plan: plan,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
                status: 'trial'
            });
            
            // Show success message
            showSuccess(successMessage, 'Account created successfully! Redirecting to payment...');
            
            // Redirect to Stripe checkout
            setTimeout(() => {
                redirectToStripeCheckout(user.uid, plan);
            }, 1500);
            
        } catch (error) {
            console.error('Error signing up:', error);
            showError(errorMessage, getErrorMessage(error.code));
            
            // Reset button state
            submitBtn.disabled = false;
            submitText.style.display = 'block';
            submitSpinner.style.display = 'none';
        }
    });
}

// Sign In Form Handler
const signinForm = document.getElementById('signinForm');
if (signinForm) {
    signinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const submitText = document.getElementById('submitText');
        const submitSpinner = document.getElementById('submitSpinner');
        const errorMessage = document.getElementById('errorMessage');
        const successMessage = document.getElementById('successMessage');
        
        // Get form values
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        // Show loading state
        submitBtn.disabled = true;
        submitText.style.display = 'none';
        submitSpinner.style.display = 'block';
        errorMessage.style.display = 'none';
        
        try {
            // Sign in with Firebase Auth
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            // Show success message
            showSuccess(successMessage, 'Signed in successfully! Redirecting...');
            
            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1000);
            
        } catch (error) {
            console.error('Error signing in:', error);
            showError(errorMessage, getErrorMessage(error.code));
            
            // Reset button state
            submitBtn.disabled = false;
            submitText.style.display = 'block';
            submitSpinner.style.display = 'none';
        }
    });
}

// Google Sign In Handler
const googleSignInBtn = document.getElementById('googleSignIn');
if (googleSignInBtn) {
    googleSignInBtn.addEventListener('click', async () => {
        try {
            const result = await auth.signInWithPopup(googleProvider);
            const user = result.user;
            
            // Check if user exists in Firestore
            const userDoc = await db.collection('users').doc(user.uid).get();
            
            if (!userDoc.exists) {
                // New user - create profile and redirect to plan selection
                await db.collection('users').doc(user.uid).set({
                    fullName: user.displayName,
                    email: user.email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'new'
                });
                
                // Redirect to signup to select plan
                window.location.href = 'signup.html';
            } else {
                // Existing user - redirect to dashboard
                window.location.href = 'dashboard.html';
            }
            
        } catch (error) {
            console.error('Error with Google sign in:', error);
            const errorMessage = document.getElementById('errorMessage');
            showError(errorMessage, 'Failed to sign in with Google. Please try again.');
        }
    });
}

// Stripe Checkout Redirect
async function redirectToStripeCheckout(userId, plan) {
    try {
        // In a real implementation, you would call your backend to create a Stripe Checkout session
        // For now, we'll redirect to a placeholder dashboard
        
        // Example of how you would create a checkout session:
        // const response = await fetch('/api/create-checkout-session', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ userId, plan })
        // });
        // const session = await response.json();
        // const result = await stripe.redirectToCheckout({ sessionId: session.id });
        
        // For demonstration purposes, redirect to dashboard
        window.location.href = 'dashboard.html';
        
    } catch (error) {
        console.error('Error redirecting to Stripe:', error);
        alert('There was an error processing your payment. Please try again.');
    }
}

// Helper Functions
function showError(element, message) {
    element.textContent = message;
    element.style.display = 'block';
}

function showSuccess(element, message) {
    element.textContent = message;
    element.style.display = 'block';
}

function getErrorMessage(errorCode) {
    const errorMessages = {
        'auth/email-already-in-use': 'This email is already registered. Please sign in instead.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/operation-not-allowed': 'Email/password accounts are not enabled. Please contact support.',
        'auth/weak-password': 'Password should be at least 8 characters long.',
        'auth/user-disabled': 'This account has been disabled. Please contact support.',
        'auth/user-not-found': 'No account found with this email. Please sign up first.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
        'auth/popup-closed-by-user': 'Sign in cancelled.',
        'auth/cancelled-popup-request': 'Sign in cancelled.'
    };
    
    return errorMessages[errorCode] || 'An error occurred. Please try again.';
}
