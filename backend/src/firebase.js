const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
// In production, use GOOGLE_APPLICATION_CREDENTIALS or service account path
// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccountPath = '../serviceAccountKey.json'; // Relative to src/
    
    // Try to require the service account
    try {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin initialized with serviceAccountKey.json');
    } catch (e) {
        // Fallback to default
        console.log('serviceAccountKey.json not found, using applicationDefault()');
        admin.initializeApp({
            credential: admin.credential.applicationDefault(), 
        });
        console.log('Firebase Admin initialized with applicationDefault');
    }
  } catch (error) {
    console.error('Firebase Admin initialization failed:', error);
  }
}

const db = admin.firestore();
const auth = admin.auth();
const FieldValue = admin.firestore.FieldValue;

module.exports = { admin, db, auth, FieldValue };
