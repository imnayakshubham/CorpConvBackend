/**
 * Data Migration Script: Fix Users with is_masked=true but Unencrypted Data
 *
 * This script finds users with is_masked: true but their sensitive fields
 * are not actually encrypted, and encrypts them properly.
 *
 * Usage:
 *   node scripts/migrateEncryption.js [--dry-run]
 *
 * Options:
 *   --dry-run: Only analyze data without making changes
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const { encrypt, isEncrypted, isEncryptionConfigured } = require('../utils/encryption');
const logger = require('../utils/logger');

// Sensitive fields to check and encrypt
const SENSITIVE_FIELDS = [
  'user_email_id',
  'actual_user_name',
  'user_phone_number',
  'secondary_email_id',
  'user_location'
];

class EncryptionMigration {
  constructor(dryRun = false) {
    this.dryRun = dryRun;
    this.stats = {
      total: 0,
      needsEncryption: 0,
      encrypted: 0,
      failed: 0,
      alreadyEncrypted: 0,
      skipped: 0
    };
  }

  /**
   * Check if a user needs encryption
   */
  needsEncryption(user) {
    if (!user.is_masked) return false;

    // Check if any sensitive field is not encrypted
    for (const field of SENSITIVE_FIELDS) {
      if (user[field] && !isEncrypted(user[field])) {
        return true;
      }
    }

    return false;
  }

  /**
   * Encrypt a single user's data
   */
  async encryptUser(user) {
    const userId = user._id;
    const email = user.user_email_id;

    try {
      logger.info(`Processing user: ${userId} (${email})`);

      let modified = false;

      // Encrypt each sensitive field if needed
      for (const field of SENSITIVE_FIELDS) {
        if (user[field] && !isEncrypted(user[field])) {
          const plainValue = user[field];

          try {
            const encrypted = encrypt(plainValue, { strict: true });

            // Verify encryption succeeded
            if (!encrypted || !isEncrypted(encrypted)) {
              throw new Error(`Encryption validation failed for field: ${field}`);
            }

            user[field] = encrypted;
            modified = true;

            logger.info(`  ✓ Encrypted field: ${field}`);
          } catch (error) {
            logger.error(`  ✗ Failed to encrypt field ${field}:`, error.message);
            throw error;
          }
        }
      }

      if (!modified) {
        this.stats.alreadyEncrypted++;
        return true;
      }

      // Save the user (bypasses pre-save hook since fields are already encrypted)
      if (!this.dryRun) {
        await user.save({ validateBeforeSave: true });
        logger.info(`  ✓ User ${userId} encrypted successfully`);
      } else {
        logger.info(`  [DRY RUN] Would encrypt user ${userId}`);
      }

      this.stats.encrypted++;
      return true;

    } catch (error) {
      logger.error(`  ✗ Failed to encrypt user ${userId}:`, error.message);
      this.stats.failed++;
      return false;
    }
  }

  /**
   * Run the migration
   */
  async run() {
    try {
      // Verify encryption is configured
      if (!isEncryptionConfigured()) {
        logger.error('❌ ENCRYPTION_KEY not configured or invalid!');
        logger.error('Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        process.exit(1);
      }

      logger.info('🔐 Encryption key configured correctly');

      if (this.dryRun) {
        logger.info('🔍 Running in DRY RUN mode - no changes will be made\n');
      } else {
        logger.info('⚠️  Running in LIVE mode - data will be modified\n');
      }

      // Find all users with is_masked: true
      logger.info('Fetching users with is_masked: true...');
      const users = await User.find({ is_masked: true }).lean();
      this.stats.total = users.length;

      logger.info(`Found ${users.length} users with is_masked: true\n`);

      if (users.length === 0) {
        logger.info('✓ No users need migration');
        return;
      }

      // Check which users need encryption
      const usersNeedingEncryption = [];
      for (const user of users) {
        if (this.needsEncryption(user)) {
          usersNeedingEncryption.push(user);
        } else {
          this.stats.alreadyEncrypted++;
        }
      }

      this.stats.needsEncryption = usersNeedingEncryption.length;

      logger.info(`📊 Analysis:`);
      logger.info(`  - Total users with is_masked=true: ${this.stats.total}`);
      logger.info(`  - Already properly encrypted: ${this.stats.alreadyEncrypted}`);
      logger.info(`  - Need encryption: ${this.stats.needsEncryption}\n`);

      if (usersNeedingEncryption.length === 0) {
        logger.info('✓ All users are properly encrypted!');
        return;
      }

      // Process each user
      logger.info('Processing users...\n');
      for (const userData of usersNeedingEncryption) {
        // Fetch fresh user document (not lean)
        const user = await User.findById(userData._id);
        if (!user) {
          logger.warn(`User ${userData._id} not found, skipping`);
          this.stats.skipped++;
          continue;
        }

        await this.encryptUser(user);
      }

      // Print final stats
      this.printStats();

    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Print migration statistics
   */
  printStats() {
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 Migration Summary:');
    logger.info('='.repeat(60));
    logger.info(`Total users with is_masked=true: ${this.stats.total}`);
    logger.info(`Already encrypted: ${this.stats.alreadyEncrypted}`);
    logger.info(`Needed encryption: ${this.stats.needsEncryption}`);
    logger.info(`Successfully encrypted: ${this.stats.encrypted}`);
    logger.info(`Failed: ${this.stats.failed}`);
    logger.info(`Skipped: ${this.stats.skipped}`);
    logger.info('='.repeat(60));

    if (this.stats.failed > 0) {
      logger.warn(`⚠️  ${this.stats.failed} users failed to encrypt`);
    }

    if (this.stats.encrypted > 0 && !this.dryRun) {
      logger.info(`✅ Successfully encrypted ${this.stats.encrypted} users`);
    }

    if (this.dryRun) {
      logger.info('\n💡 This was a dry run. Run without --dry-run to apply changes.');
    }
  }
}

// Main execution
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  try {
    // Connect to MongoDB
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });
    logger.info('✓ Connected to MongoDB\n');

    // Run migration
    const migration = new EncryptionMigration(dryRun);
    await migration.run();

    // Disconnect
    await mongoose.disconnect();
    logger.info('\n✓ Disconnected from MongoDB');

    process.exit(0);

  } catch (error) {
    logger.error('Fatal error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = EncryptionMigration;
