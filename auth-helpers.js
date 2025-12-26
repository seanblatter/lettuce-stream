(function attachAuthHelpers(globalScope) {
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

    function getErrorMessage(errorCode) {
        return errorMessages[errorCode] || 'An error occurred. Please try again.';
    }

    const helpers = { getErrorMessage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = helpers;
    } else {
        globalScope.authHelpers = helpers;
    }
}(typeof window !== 'undefined' ? window : globalThis));
