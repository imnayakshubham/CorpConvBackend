const mongoose = require("mongoose");
const colors = require("colors");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000
    });
    // Ensure the connection is fully ready (Mongoose 8.x can resolve connect()
    // before connection.db is populated)
    await mongoose.connection.asPromise();

    console.log(`MongoDB Connected: ${mongoose.connection.host}`.cyan.underline);
  } catch (error) {
    console.error(`Error: ${error.message}`.red.bold);
    process.exit(1);
  }
};

module.exports = connectDB;

