/**
 * Encryption Usage Examples
 *
 * This file demonstrates how to use the encryption utilities
 * with full backward compatibility for mixed encrypted/unencrypted data
 */

const User = require('../models/userModel');
const {
  encrypt,
  decrypt,
  smartDecrypt,
  getSafeUserData,
  isEncrypted,
  isEncryptionConfigured
} = require('../utils/encryption');

// ============================================================================
// Example 1: API Route - Get User (Backward Compatible)
// ============================================================================

async function getUserRoute(req, res) {
  try {
    const user = await User.findById(req.params._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // ✅ RECOMMENDED: Use getSafeUserData for API responses
    // Automatically handles both encrypted and plain text data
    const safeUser = getSafeUserData(user);

    res.json({
      success: true,
      data: safeUser
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ============================================================================
// Example 2: API Route - Update User (Auto-encryption)
// ============================================================================

async function updateUserRoute(req, res) {
  try {
    const user = await User.findById(req.params._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user fields
    if (req.body.name) {
      user.actual_user_name = req.body.name;
    }

    if (req.body.location) {
      user.user_location = req.body.location;
    }

    // ✅ Pre-save hook will automatically encrypt if key is configured
    await user.save();

    // Return decrypted data for API response
    res.json({
      success: true,
      data: user.getDecryptedData()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ============================================================================
// Example 3: Search Users by Email (Backward Compatible)
// ============================================================================

async function searchUsersByEmail(email) {
  // Find users - might have encrypted or plain text emails
  const users = await User.find({});

  // Filter users whose email matches (handles both encrypted and plain)
  const matchingUsers = users.filter(user => {
    // Smart decrypt handles both encrypted and plain text
    const decryptedEmail = smartDecrypt(user.user_email_id);
    return decryptedEmail && decryptedEmail.toLowerCase() === email.toLowerCase();
  });

  // Return safe data (all decrypted)
  return matchingUsers.map(getSafeUserData);
}

// ============================================================================
// Example 4: Check User Encryption Status
// ============================================================================

async function checkUserEncryptionStatus(user_id) {
  const user = await User.findById(user_id);

  if (!user) {
    throw new Error('User not found');
  }

  // Check encryption status
  const status = user.isDataEncrypted();

  console.log('User Encryption Status:');
  console.log('  All encrypted:', status.allEncrypted);
  console.log('  Some encrypted:', status.someEncrypted);
  console.log('  Mixed state:', status.mixedState);
  console.log('  Details:', status.details);

  // If mixed state, fix by re-saving
  if (status.mixedState) {
    console.log('⚠️  Mixed encryption state detected, fixing...');
    await user.save(); // Pre-save hook will encrypt plain fields
    console.log('✅ User re-encrypted');
  }

  return status;
}

// ============================================================================
// Example 5: Batch Process Users (Efficient)
// ============================================================================

async function batchProcessUsers() {
  const batchSize = 100;
  let skip = 0;
  let processed = 0;

  while (true) {
    // Fetch batch
    const users = await User.find({ is_masked: true })
      .skip(skip)
      .limit(batchSize);

    if (users.length === 0) break;

    // Process each user
    for (const user of users) {
      // Get decrypted data
      const userData = user.getDecryptedData();

      // Do something with userData (e.g., send email)
      console.log(`Processing: ${userData.user_email_id}`);

      processed++;
    }

    skip += batchSize;
  }

  console.log(`Processed ${processed} users`);
}

// ============================================================================
// Example 6: Manual Field Encryption/Decryption
// ============================================================================

function manualFieldOperations() {
  // Encrypt a single field
  const email = 'user@example.com';
  const encryptedEmail = encrypt(email);
  console.log('Encrypted:', encryptedEmail);

  // Check if encrypted
  if (isEncrypted(encryptedEmail)) {
    console.log('✅ Email is encrypted');
  }

  // Decrypt
  const decryptedEmail = decrypt(encryptedEmail);
  console.log('Decrypted:', decryptedEmail);

  // Smart decrypt (handles both encrypted and plain)
  const plainEmail = 'plain@example.com';
  const result1 = smartDecrypt(encryptedEmail); // Returns decrypted
  const result2 = smartDecrypt(plainEmail);     // Returns unchanged

  console.log('Smart decrypt encrypted:', result1);
  console.log('Smart decrypt plain:', result2);
}

// ============================================================================
// Example 7: Startup Checks
// ============================================================================

function startupChecks() {
  console.log('\n🔐 Encryption Configuration Check');
  console.log('='.repeat(50));

  if (isEncryptionConfigured()) {
    console.log('✅ Encryption is properly configured');
    console.log('   User data will be encrypted automatically');
  } else {
    console.warn('⚠️  Encryption is NOT configured');
    console.warn('   User data will NOT be encrypted');
    console.warn('   Add ENCRYPTION_KEY to .env file');
  }

  console.log('='.repeat(50) + '\n');
}

// ============================================================================
// Example 8: Migration Period - Handle Mixed Data
// ============================================================================

async function handleMixedDataDuringMigration(req, res) {
  try {
    // Fetch user
    const user = await User.findById(req.params._id);

    // Check if data is encrypted
    const encryptionStatus = user.isDataEncrypted();

    if (encryptionStatus.mixedState) {
      console.warn(`⚠️  User ${user._id} has mixed encryption state`);

      // Option 1: Return data anyway (smart decrypt handles it)
      const safeUser = getSafeUserData(user);

      // Option 2: Fix encryption on-the-fly
      await user.save(); // Re-encrypts all fields

      return res.json({
        success: true,
        data: safeUser,
        warning: 'User data was re-encrypted'
      });
    }

    // Normal response
    res.json({
      success: true,
      data: getSafeUserData(user)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ============================================================================
// Example 9: Query with Encrypted Fields (Advanced)
// ============================================================================

async function findUserByEncryptedEmail(email) {
  // Note: Direct MongoDB queries on encrypted fields won't work
  // You need to either:

  // Option 1: Fetch all users and filter (works but inefficient for large datasets)
  const allUsers = await User.find({});
  const matchingUser = allUsers.find(user => {
    const decryptedEmail = smartDecrypt(user.user_email_id);
    return decryptedEmail === email;
  });

  // Option 2: Create a hash index for faster lookups (recommended for production)
  // Store a hash of the email for indexing while keeping encrypted for storage
  // This is covered in advanced encryption patterns

  return matchingUser ? getSafeUserData(matchingUser) : null;
}

// ============================================================================
// Example 10: Error Handling with Backward Compatibility
// ============================================================================

async function robustDataRetrieval(user_id) {
  try {
    const user = await User.findById(user_id);

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check encryption configuration
    if (!isEncryptionConfigured()) {
      console.warn('⚠️  Encryption not configured, returning data as-is');
      return {
        success: true,
        data: user.toObject(),
        warning: 'Data not encrypted'
      };
    }

    // Check user encryption status
    const status = user.isDataEncrypted();

    // Get safe data (handles all scenarios)
    const safeData = getSafeUserData(user);

    return {
      success: true,
      data: safeData,
      metadata: {
        encrypted: status.allEncrypted,
        mixedState: status.mixedState
      }
    };
  } catch (error) {
    console.error('Error retrieving user data:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// Export Examples
// ============================================================================

module.exports = {
  getUserRoute,
  updateUserRoute,
  searchUsersByEmail,
  checkUserEncryptionStatus,
  batchProcessUsers,
  manualFieldOperations,
  startupChecks,
  handleMixedDataDuringMigration,
  findUserByEncryptedEmail,
  robustDataRetrieval
};

// ============================================================================
// Quick Reference
// ============================================================================

/*

QUICK REFERENCE:

1. API Responses (Most Common):
   ✅ const safeUser = getSafeUserData(user);

2. Individual Fields:
   ✅ const email = smartDecrypt(user.user_email_id);

3. Check if Encrypted:
   ✅ if (isEncrypted(value)) { ... }

4. Check Configuration:
   ✅ if (isEncryptionConfigured()) { ... }

5. User Methods:
   ✅ user.getDecryptedData()
   ✅ user.isDataEncrypted()

6. Manual Operations:
   ✅ encrypt(value)
   ✅ decrypt(value)
   ✅ smartDecrypt(value) // Recommended

7. Migration:
   ✅ node scripts/migrateEncryption.js --dry-run
   ✅ node scripts/migrateEncryption.js

REMEMBER:
- Always use getSafeUserData() for API responses
- Always use smartDecrypt() for individual fields
- Let pre-save hook handle encryption automatically
- Run migration during low-traffic periods

*/
