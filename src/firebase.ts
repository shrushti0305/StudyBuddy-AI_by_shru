import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer, enableIndexedDbPersistence } from 'firebase/firestore';
import { getAnalytics } from "firebase/analytics";
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Use initializeFirestore with long polling to bypass potential WebSocket blocks on slow/protected networks
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

// Enable Offline Persistence for a seamless experience on slow connections
if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn("Firestore: Multiple tabs open, persistence enabled in only one.");
    } else if (err.code === 'unimplemented') {
      console.warn("Firestore: The current browser does not support persistence.");
    }
  });
}

export const auth = getAuth(app);

// Initialize analytics only if in browser environment
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

// Validation check as per guidelines
async function testConnection() {
  try {
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY_HERE") {
      // Use getDocFromServer to verify server-side connectivity
      // We wrap this in a timeout so it doesn't hang indefinitely on slow networks
      const pingPromise = getDocFromServer(doc(db, '_connection_test_', 'ping'));
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
      
      await Promise.race([pingPromise, timeoutPromise]);
      console.log("Firebase: Cloud connection established.");
    }
  } catch (error: any) {
    if (error.message === 'timeout' || error.message?.includes('the client is offline') || error.message?.includes('Backend didn\'t respond')) {
      console.info("Firebase: Operating in optimized Offline Mode. Data will sync once shared network improves.");
      console.info("Note: Ensure 'Cloud Firestore' is created in your Firebase Console (not just Realtime Database).");
    } else if (error.message?.includes('permission-denied')) {
      console.log("Firebase: Server reached successfully (Read restricted by security rules).");
    } else {
      console.warn("Firebase: Connection check result:", error.message || error);
    }
  }
}

testConnection();
