const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (serviceAccountKey) {
    try {
      // Parse the service account key from environment variable
      const serviceAccount = JSON.parse(serviceAccountKey);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID
      });
    } catch (error) {
      console.error('Error parsing Firebase service account key:', error);
      // throw new Error('Invalid Firebase service account configuration');
    }
  } else {
    console.warn('Firebase service account key not found in environment variables - Firebase features disabled');
    // Don't throw error in development - just disable Firebase features
  }
}

/**
 * Verify Firebase ID token and extract ONLY uid for security
 * For security purposes, we only extract the uid from Firebase token
 * All other user information is fetched from our MongoDB database
 * @param {string} idToken - Firebase ID token from client
 * @returns {Promise<Object>} - Only contains uid from Firebase token
 */
async function verifyFirebaseToken(idToken) {
  try {
    if (!admin.apps.length) {
      return {
        success: false,
        error: 'Firebase not configured'
      };
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // SECURITY: Only extract uid, ignore all other claims (email, name, picture, etc.)
    // User data will be fetched from MongoDB database instead
    return {
      success: true,
      uid: decodedToken.uid  // Only return uid
    };
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get Firebase user by UID
 * @param {string} uid - Firebase user UID
 * @returns {Promise<Object>} - User record
 */
async function getFirebaseUser(uid) {
  try {
    const userRecord = await admin.auth().getUser(uid);
    return {
      success: true,
      user: userRecord
    };
  } catch (error) {
    console.error('Error getting Firebase user:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Revoke all refresh tokens for a user (force logout from all devices)
 * @param {string} uid - Firebase user UID
 * @returns {Promise<Object>} - Result of operation
 */
async function revokeUserTokens(uid) {
  try {
    await admin.auth().revokeRefreshTokens(uid);
    return {
      success: true,
      message: 'All refresh tokens revoked successfully'
    };
  } catch (error) {
    console.error('Error revoking user tokens:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  admin,
  verifyFirebaseToken,
  getFirebaseUser,
  revokeUserTokens
};