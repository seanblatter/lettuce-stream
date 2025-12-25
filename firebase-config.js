// Firebase Configuration
// Replace these values with your actual Firebase project configuration
const firebaseConfig = {
    apiKey: "AIzaSyBhzWdFbh0uiwLv_gUAqfsPFgDF3g0ehkY",
  authDomain: "lettuce-stream.firebaseapp.com",
  projectId: "lettuce-stream",
  storageBucket: "lettuce-stream.firebasestorage.app",
  messagingSenderId: "123320097160",
  appId: "1:123320097160:web:3fcc5438b795926915823d",
  measurementId: "G-4Z6SGR0T1T"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firebase Authentication
const auth = firebase.auth();

// Initialize Firestore
const db = firebase.firestore();

// Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
