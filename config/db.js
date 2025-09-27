const mongoose = require("mongoose");
const logger = require("../utils/logger");
const colors = require("colors");

const connectDB = async () => {
  try {
    const db = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000
    });

    logger.info(`Connected`);
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

