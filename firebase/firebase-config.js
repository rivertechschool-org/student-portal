// firebase/firebase-config.js
// Firebase configuration for the Student Portal Arcade system
//
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (or use existing)
// 3. Enable Realtime Database (not Firestore)
// 4. Authentication: nothing to enable. The portal signs students in with a
//    CUSTOM TOKEN minted by the firebase-token edge function, so auth.uid is
//    the Supabase user id and the security rules can identify who is writing.
//    Do NOT turn on Anonymous auth as a fallback - an anonymous session has a
//    uid unrelated to the student, every identity rule silently stops matching,
//    and the failure looks like a permissions bug rather than a login one.
// 5. Copy your config values below
// 6. Set up security rules (see firebase-rules.json in this folder)

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCvxpPE05zpBkcADLMs4W2EIqmgYFpVWNY",
    authDomain: "my-arcade-e33b4.firebaseapp.com",
    databaseURL: "https://my-arcade-e33b4-default-rtdb.firebaseio.com", // ADD THIS AFTER ENABLING REALTIME DATABASE
    projectId: "my-arcade-e33b4",
    storageBucket: "my-arcade-e33b4.firebasestorage.app",
    messagingSenderId: "517239105316",
    appId: "1:517239105316:web:0edae220734c960f64b5b1"
};

// Make available on window for arcade system
window.FIREBASE_CONFIG = FIREBASE_CONFIG;

// Firebase SDK URLs (use these in HTML files)
const FIREBASE_SDK_URLS = {
    app: 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
    database: 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js',
    auth: 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js'
};

// Check if Firebase config is set up
function isFirebaseConfigured() {
    return FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY_HERE" &&
           FIREBASE_CONFIG.apiKey !== "";
}

// Export for ES6 modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FIREBASE_CONFIG, FIREBASE_SDK_URLS, isFirebaseConfigured };
}
