import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
    projectId: "pansil-breaker-1",
    appId: "1:982144814430:web:7616f63fb53dd67d3e93cf",
    storageBucket: "pansil-breaker-1.firebasestorage.app",
    apiKey: "AIzaSyAdPNrYOd9caQo6Su6pg9kzhP3Y7z-9IKA",
    authDomain: "pansil-breaker-1.firebaseapp.com",
    messagingSenderId: "982144814430",
    databaseURL: "https://pansil-breaker-1-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);


// We do not auto-sign-in anymore. The user will log in or choose to play as a guest explicitly via LoginScreen.

import { getFirestore } from 'firebase/firestore';
export const firestore = getFirestore(app);

// We export a getter for the RTDB so it doesn't crash if the URL is missing temporarily
export const getRTDB = () => {
    try {
        return getDatabase(app);
    } catch (e) {
        console.warn("RTDB not fully initialized yet.");
        return null;
    }
};
