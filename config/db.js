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
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

