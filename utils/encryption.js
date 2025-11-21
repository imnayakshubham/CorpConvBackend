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
 * @param {Object} options - Encryption options
 * @param {boolean} options.strict - If true, throws error when key is missing (default: false)
 * @returns {string|null} - Encrypted string or null if input is null/empty
 */
function encrypt(text, options = { strict: false }) {
  if (!text || text === '') return null;

  if (!KEY) {
    const errorMsg = 'Encryption key not configured. Cannot encrypt data.';
    if (options.strict) {
      throw new Error(errorMsg);
    }
    console.warn(errorMsg + ' Returning plain text.');
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
    const result = `${ivHex}:${authTag}:${encrypted}`;

    // Validate encryption result
    if (!result.includes(':') || result === text) {
      throw new Error('Encryption produced invalid output');
    }

    return result;
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
 * Handles backward compatibility for mixed encrypted/unencrypted data
 * @param {Object} userData - User data object (can be Mongoose document or plain object)
 * @param {Object} options - Decryption options
 * @param {boolean} options.forceDecrypt - Attempt decryption even if is_masked is false (default: false)
 * @returns {Object} - Same object with decrypted fields
 */
function decryptUserData(userData, options = { forceDecrypt: false }) {
  if (!userData) return null;

  // Convert Mongoose document to plain object if needed
  const user = userData.toObject ? userData.toObject() : userData;

  // Backward compatibility: If is_masked is false, check if any fields are actually encrypted
  // This handles cases where is_masked flag is incorrect
  const shouldAttemptDecryption = user.is_masked || options.forceDecrypt;

  if (!shouldAttemptDecryption) {
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
      // Check if field is actually encrypted before attempting decryption
      if (isEncrypted(user[field])) {
        user[field] = decrypt(user[field]);
      }
      // If not encrypted (plain text), leave as-is for backward compatibility
    }
  }

  return user;
}

/**
 * Check if a string is encrypted (format: iv:authTag:encrypted)
 * @param {string} value - String to check
 * @returns {boolean} - True if encrypted, false otherwise
 */
function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;

  const parts = value.split(':');
  if (parts.length !== 3) return false;

  // Check if all parts are hexadecimal
  const hexRegex = /^[0-9a-f]+$/i;
  return parts.every(part => hexRegex.test(part));
}

/**
 * Verify if encryption is properly configured
 * @returns {boolean} - True if encryption key is configured
 */
function isEncryptionConfigured() {
  return !!KEY && KEY_HEX && KEY_HEX.length === 64;
}

/**
 * Smart decrypt - attempts to decrypt but returns original if not encrypted
 * Perfect for backward compatibility where data might be mixed
 * @param {string} value - Value to decrypt (might be encrypted or plain text)
 * @returns {string|null} - Decrypted value or original if not encrypted
 */
function smartDecrypt(value) {
  if (!value) return value;

  // Check if actually encrypted before attempting decryption
  if (isEncrypted(value)) {
    try {
      return decrypt(value);
    } catch (error) {
      console.warn('Smart decrypt failed, returning original value:', error.message);
      return value;
    }
  }

  // Not encrypted, return as-is
  return value;
}

/**
 * Get safe user data for API responses - automatically decrypts if needed
 * This is the recommended function to use when returning user data to clients
 * @param {Object} userData - User data object
 * @returns {Object} - User data with decrypted sensitive fields
 */
function getSafeUserData(userData) {
  if (!userData) return null;

  const user = userData.toObject ? userData.toObject() : { ...userData };

  const fieldsToProcess = [
    'user_email_id',
    'actual_user_name',
    'user_phone_number',
    'secondary_email_id',
    'user_location'
  ];

  // Smart decrypt all sensitive fields (handles both encrypted and plain text)
  for (const field of fieldsToProcess) {
    if (user[field]) {
      user[field] = smartDecrypt(user[field]);
    }
  }

  return user;
}

module.exports = {
  encrypt,
  decrypt,
  encryptUserData,
  decryptUserData,
  isEncrypted,
  isEncryptionConfigured,
  smartDecrypt,
  getSafeUserData
};
