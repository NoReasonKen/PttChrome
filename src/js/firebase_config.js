// Firebase web app config for preference cloud sync (see pref_sync.js).
// Not a secret: web configs are public by design; access control is enforced
// by Firestore security rules (firestore.rules) and Auth authorized domains.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyByIMT4gaDbMzvJGhCPTebQhccXnPryHcU",
  authDomain: "pttchrome-7fae4.firebaseapp.com",
  projectId: "pttchrome-7fae4",
  storageBucket: "pttchrome-7fae4.firebasestorage.app",
  messagingSenderId: "1012243465943",
  appId: "1:1012243465943:web:e2a9996308186f24fed292"
};

// OAuth client of the Firebase Google sign-in provider (the auto-created *Web*
// client). The Android APK hands it to Credential Manager as serverClientId so
// the returned ID token is addressed to it — Firebase only accepts that
// audience (see google_sign_in.js). Public by design, like the config above.
export const GOOGLE_WEB_CLIENT_ID =
  "1012243465943-rvf80ma7k4golem1mk5vh123lhrhf3u5.apps.googleusercontent.com";

// reCAPTCHA Enterprise site key for App Check (also public by design — it
// only works on the domains allow-listed on the key, not on localhost; dev
// builds use a registered debug token instead, see pref_sync.js).
export const RECAPTCHA_SITE_KEY = "6Lf_lv4tAAAAAD8KlBkx0gUJlXJbqxd4XO4suz4d";
