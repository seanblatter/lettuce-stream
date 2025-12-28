// Firebase configuration is injected at deploy time via window.__FIREBASE_CONFIG__
// so nothing sensitive lives in the repository. Vercel should set this global in
// a script tag before loading any app bundles.
const firebaseConfig = (() => {
  if (typeof window === 'undefined') {
    throw new Error('Firebase config is unavailable during server-side rendering.');
  }

  if (!window.__FIREBASE_CONFIG__) {
    throw new Error('Missing window.__FIREBASE_CONFIG__. Make sure Vercel injects the Firebase config.');
  }

  return window.__FIREBASE_CONFIG__;
})();

// Initialize Firebase (guard in case scripts re-run)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Initialize Firebase Authentication
const auth = firebase.auth();

// Initialize Firestore
const db = firebase.firestore();

// Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
