const crypto = require('crypto');

/**
 * Encryption Utility for Sensitive User Data
 *
 * Uses AES-256-GCM (Authenticated Encryption)
 * Format: {iv}:{authTag}:{encrypted}
 *
 * Security Features:
 * - AES-256-GCM: Authenticated encryption (confidentiality + integrity)
 * - Random IV: 96-bit (NIST recommended for GCM)
 * - Auth Tag: 128-bit (prevents tampering)
 * - Self-contained: IV and authTag embedded in encrypted string
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // 96 bits for GCM (NIST recommended)
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_HEX = process.env.ENCRYPTION_KEY; // 64 hex chars (32 bytes)

// Validate encryption key on module load
if (!KEY_HEX || KEY_HEX.length !== 64) {
  console.warn('⚠️  ENCRYPTION_KEY not configured or invalid length. Encryption disabled.');
  console.warn('Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

const KEY = KEY_HEX ? Buffer.from(KEY_HEX, 'hex') : null;

/**
 * Encrypt text - returns single string with format: {iv}:{authTag}:{encrypted}
 * @param {string} text - Plain text to encrypt
 * @returns {string|null} - Encrypted string or null if input is null/empty
 */
function encrypt(text) {
  if (!text || text === '') return null;

  if (!KEY) {
    console.warn('Encryption key not configured. Returning plain text.');
    return text;
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');
    const ivHex = iv.toString('hex');

    // Format: iv:authTag:encrypted
    return `${ivHex}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt text from format: {iv}:{authTag}:{encrypted}
 * @param {string} encryptedString - Encrypted string with embedded IV and authTag
 * @returns {string|null} - Decrypted text or null if input is null/invalid
 */
function decrypt(encryptedString) {
  if (!encryptedString || encryptedString === '') return null;

  // If not in encrypted format (backward compatibility), return as-is
  if (!encryptedString.includes(':')) {
    return encryptedString;
  }

  if (!KEY) {
    console.warn('Encryption key not configured. Returning encrypted string as-is.');
    return encryptedString;
  }

  try {
    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
      // Not in expected format, might be plain text
      return encryptedString;
    }

    const [ivHex, authTagHex, encrypted] = parts;

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      KEY,
      Buffer.from(ivHex, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    // Return original if decryption fails (might be plain text)
    return encryptedString;
  }
}

/**
 * Encrypt user data object - encrypts sensitive fields in place
 * @param {Object} userData - User data object
 * @returns {Object} - Same object with encrypted fields
 */
function encryptUserData(userData) {
  const fieldsToEncrypt = [
    'user_email_id',
    'actual_user_name',
    'user_phone_number',
    'secondary_email_id',
    'user_location'
  ];

  for (const field of fieldsToEncrypt) {
    if (userData[field]) {
      userData[field] = encrypt(userData[field]);
    }
  }

  userData.is_masked = true;
  return userData;
}

/**
 * Decrypt user data object - decrypts sensitive fields in place
 * @param {Object} userData - User data object (can be Mongoose document or plain object)
 * @returns {Object} - Same object with decrypted fields
 */
function decryptUserData(userData) {
  if (!userData) return null;

  // Convert Mongoose document to plain object if needed
  const user = userData.toObject ? userData.toObject() : userData;

  if (!user.is_masked) {
    return user; // Not encrypted, return as-is
  }

  const fieldsToDecrypt = [
    'user_email_id',
    'actual_user_name',
    'user_phone_number',
    'secondary_email_id',
    'user_location'
  ];

  for (const field of fieldsToDecrypt) {
    if (user[field]) {
      user[field] = decrypt(user[field]);
    }
  }

  return user;
}

module.exports = {
  encrypt,
  decrypt,
  encryptUserData,
  decryptUserData
};
