const mongoose = require("mongoose");
const colors = require("colors");

const connectDB = async () => {
  try {
    const db = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000
    });

    console.log(`MongoDB Connected: ${db.connection.host}`.cyan.underline);
  } catch (error) {
    console.error(`Error: ${error.message}`.red.bold);
    process.exit(1);
  }
};

module.exports = connectDB;

