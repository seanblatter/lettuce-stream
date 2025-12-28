// Firebase configuration is injected at deploy time via window.__FIREBASE_CONFIG__
// A baked-in fallback is provided so local development (or misconfigured deploys)
// keep working, but the deploy should always override it.
const FALLBACK_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBhzWdFbh0uiwLv_gUAqfsPFgDF3g0ehkY',
  authDomain: 'lettuce-stream.firebaseapp.com',
  projectId: 'lettuce-stream',
  storageBucket: 'lettuce-stream.firebasestorage.app',
  messagingSenderId: '123320097160',
  appId: '1:123320097160:web:3fcc5438b795926915823d',
  measurementId: 'G-4Z6SGR0T1T'
};

const firebaseConfig = (() => {
  if (typeof window === 'undefined') {
    return FALLBACK_FIREBASE_CONFIG;
  }

  if (window.__FIREBASE_CONFIG__) {
    return window.__FIREBASE_CONFIG__;
  }

  console.warn('window.__FIREBASE_CONFIG__ is missing; using baked-in fallback config.');
  return FALLBACK_FIREBASE_CONFIG;
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
