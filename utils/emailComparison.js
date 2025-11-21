const { decrypt, isEncrypted, smartDecrypt } = require('./encryption');
const { User } = require('../models/userModel');

/**
 * Find user by email with encryption-aware comparison
 * Handles both encrypted (is_masked=true) and plain text (is_masked=false) emails
 *
 * @param {string} plainEmail - Plain text email to search for
 * @param {Object} options - Additional query options
 * @param {Object|null} options.projection - MongoDB projection object
 * @param {boolean} options.includeSecondary - Whether to check secondary_email_id (default: true)
 * @returns {Promise<Object|null>} - Found user document or null
 */
async function findUserByEmail(plainEmail, options = {}) {
  if (!plainEmail) {
    return null;
  }

  const { projection = null, includeSecondary = true } = options;

  try {
    // Normalize search email for comparison
    const searchEmail = plainEmail.toLowerCase().trim();

    // Step 1: Try to find unencrypted users (is_masked = false) with direct query
    const queryConditions = includeSecondary
      ? { $or: [{ user_email_id: searchEmail }, { secondary_email_id: searchEmail }], is_masked: false }
      : { user_email_id: searchEmail, is_masked: false };

    const plainTextQuery = projection
      ? User.findOne(queryConditions, projection)
      : User.findOne(queryConditions);

    const plainUser = await plainTextQuery.exec();

    if (plainUser) {
      return plainUser;
    }

    // Step 2: Fetch encrypted users (is_masked = true) and decrypt to compare
    const encryptedQuery = projection
      ? User.find({ is_masked: true }, projection)
      : User.find({ is_masked: true });

    const encryptedUsers = await encryptedQuery.exec();

    // Decrypt and compare each encrypted user's email
    const foundUser = encryptedUsers.find(user => {
      // Check primary email
      if (user.user_email_id) {
        const decryptedPrimary = smartDecrypt(user.user_email_id);
        if (decryptedPrimary && decryptedPrimary.toLowerCase().trim() === searchEmail) {
          return true;
        }
      }

      // Check secondary email if requested and exists
      if (includeSecondary && user.secondary_email_id) {
        const decryptedSecondary = smartDecrypt(user.secondary_email_id);
        if (decryptedSecondary && decryptedSecondary.toLowerCase().trim() === searchEmail) {
          return true;
        }
      }

      return false;
    });

    return foundUser || null;
  } catch (error) {
    console.error('Error in findUserByEmail:', error);
    throw error;
  }
}

/**
 * Check if an email already exists in the database
 * Performs encryption-aware comparison
 *
 * @param {string} plainEmail - Plain text email to check
 * @param {boolean} includeSecondary - Whether to check secondary_email_id (default: true)
 * @returns {Promise<boolean>} - True if email exists, false otherwise
 */
async function emailExists(plainEmail, includeSecondary = true) {
  try {
    const user = await findUserByEmail(plainEmail, { includeSecondary });
    return !!user;
  } catch (error) {
    console.error('Error in emailExists:', error);
    throw error;
  }
}

/**
 * Find user by email or phone with encryption-aware comparison
 * Handles both encrypted (is_masked=true) and plain text (is_masked=false) data
 *
 * @param {string} identifier - Email or phone number to search for
 * @param {Object} options - Additional query options
 * @returns {Promise<Object|null>} - Found user document or null
 */
async function findUserByEmailOrPhone(identifier, options = {}) {
  if (!identifier) {
    return null;
  }

  const { projection = null } = options;

  try {
    // Normalize identifier for comparison
    const searchIdentifier = identifier.toLowerCase().trim();

    // Check if identifier looks like an email (contains @)
    const isEmail = searchIdentifier.includes('@');

    // Step 1: Try to find unencrypted users (is_masked = false) with direct query
    let queryConditions;
    if (isEmail) {
      queryConditions = {
        $or: [{ user_email_id: searchIdentifier }, { secondary_email_id: searchIdentifier }],
        is_masked: false
      };
    } else {
      queryConditions = { user_phone_number: searchIdentifier, is_masked: false };
    }

    const plainTextQuery = projection
      ? User.findOne(queryConditions, projection)
      : User.findOne(queryConditions);

    const plainUser = await plainTextQuery.exec();

    if (plainUser) {
      return plainUser;
    }

    // Step 2: Fetch encrypted users (is_masked = true) and decrypt to compare
    const encryptedQuery = projection
      ? User.find({ is_masked: true }, projection)
      : User.find({ is_masked: true });

    const encryptedUsers = await encryptedQuery.exec();

    // Decrypt and compare
    const foundUser = encryptedUsers.find(user => {
      // Check email fields if identifier is email-like
      if (isEmail) {
        if (user.user_email_id) {
          const decryptedEmail = smartDecrypt(user.user_email_id);
          if (decryptedEmail && decryptedEmail.toLowerCase().trim() === searchIdentifier) {
            return true;
          }
        }

        if (user.secondary_email_id) {
          const decryptedSecondary = smartDecrypt(user.secondary_email_id);
          if (decryptedSecondary && decryptedSecondary.toLowerCase().trim() === searchIdentifier) {
            return true;
          }
        }
      }

      // Check phone field
      if (user.user_phone_number) {
        const decryptedPhone = smartDecrypt(user.user_phone_number);
        if (decryptedPhone && decryptedPhone.trim() === searchIdentifier) {
          return true;
        }
      }

      return false;
    });

    return foundUser || null;
  } catch (error) {
    console.error('Error in findUserByEmailOrPhone:', error);
    throw error;
  }
}

module.exports = {
  findUserByEmail,
  emailExists,
  findUserByEmailOrPhone
};
