const mongoose = require("mongoose");
const logger = require("../utils/logger");
const colors = require("colors");
const aiService = require("../services/aiService");

const connectDB = async () => {
  try {
    const db = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000
    });

    await aiService.getEmbeddingModelStatus()

    logger.info(`Connected`);

    // Validate encryption configuration
    const { isEncryptionConfigured } = require("../utils/encryption");
    if (!isEncryptionConfigured()) {
      logger.warn('⚠️  ENCRYPTION_KEY not configured or invalid!'.yellow);
      logger.warn('User data will NOT be encrypted. Generate a key with:'.yellow);
      logger.warn('node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'.yellow);
    } else {
      logger.info('🔐 Encryption configured correctly'.green);
    }

    return db
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

