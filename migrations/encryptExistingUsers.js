/**
 * Migration Script: Encrypt Existing User Data
 *
 * This script encrypts sensitive user data for all existing users in the database.
 *
 * Usage:
 *   node migrations/encryptExistingUsers.js
 *
 * IMPORTANT:
 *   - Backup your database before running this migration
 *   - Run in test environment first
 *   - Ensure ENCRYPTION_KEY is set in .env
 *   - This is a one-time migration
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const { encrypt } = require('../utils/encryption');

// Check if encryption key is configured
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
  console.error('❌ ENCRYPTION_KEY not configured or invalid length');
  console.error('Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

async function migrateUsers() {
  try {
    // Connect to MongoDB
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI not configured in .env');
    }

    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all users not yet encrypted
    const users = await User.find({ is_masked: { $ne: true } });

    console.log(`📊 Found ${users.length} users to encrypt\n`);

    if (users.length === 0) {
      console.log('✨ No users to encrypt. All done!');
      await mongoose.disconnect();
      return;
    }

    // Ask for confirmation (commented out for automated scripts)
    // console.log('⚠️  WARNING: This will encrypt sensitive data for all users.');
    // console.log('Make sure you have a database backup!');
    // console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...');
    // await new Promise(resolve => setTimeout(resolve, 5000));

    let encryptedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Fields to encrypt
    const fieldsToEncrypt = [
      'user_email_id',
      'actual_user_name',
      'user_phone_number',
      'secondary_email_id',
      'user_location'
    ];

    // Encrypt each user
    for (const user of users) {
      try {
        const updates = {};
        let hasUpdates = false;

        // Encrypt each sensitive field
        for (const field of fieldsToEncrypt) {
          if (user[field]) {
            const value = String(user[field]);

            // Check if already encrypted (skip if so)
            const parts = value.split(':');
            if (parts.length === 3 && /^[0-9a-f]+$/.test(parts[0])) {
              continue; // Already encrypted
            }

            // Encrypt the field
            updates[field] = encrypt(value);
            hasUpdates = true;
          }
        }

        // Mark as masked
        updates.is_masked = true;

        if (hasUpdates || !user.is_masked) {
          // Update without triggering middleware (direct update)
          await User.updateOne({ _id: user._id }, { $set: updates });

          encryptedCount++;
          if (encryptedCount % 100 === 0) {
            console.log(`✅ Encrypted ${encryptedCount}/${users.length} users...`);
          }
        }
      } catch (error) {
        errorCount++;
        errors.push({
          userId: user._id,
          email: user.user_email_id,
          error: error.message
        });
        console.error(`❌ Error encrypting user ${user._id}: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Complete!');
    console.log('='.repeat(60));
    console.log(`✅ Successfully encrypted: ${encryptedCount} users`);
    console.log(`❌ Errors: ${errorCount} users`);

    if (errors.length > 0) {
      console.log('\n❌ Failed Users:');
      errors.forEach(err => {
        console.log(`  - User ID: ${err.userId} (${err.email})`);
        console.log(`    Error: ${err.error}`);
      });
    }

    // Verify a sample of encrypted users
    console.log('\n🔍 Verifying encryption...');
    const sampleUser = await User.findOne({ is_masked: true });

    if (sampleUser) {
      console.log('Sample encrypted user:');
      console.log(`  - Email (encrypted): ${sampleUser.user_email_id?.substring(0, 50)}...`);
      console.log(`  - is_masked: ${sampleUser.is_masked}`);

      // Test decryption
      const { decryptUserData } = require('../utils/encryption');
      const decrypted = decryptUserData(sampleUser.toObject());
      console.log(`  - Email (decrypted): ${decrypted.user_email_id}`);
      console.log('✅ Encryption/Decryption working correctly!');
    }

    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
console.log('🔐 User Data Encryption Migration');
console.log('='.repeat(60) + '\n');

migrateUsers()
  .then(() => {
    console.log('\n✨ Migration completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
