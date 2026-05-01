/**
 * One-time migration: add current_plan and ai_calls_this_month to existing users.
 *
 * Safe to run multiple times — the $exists: false filter ensures only documents
 * that are actually missing the field are touched. Existing values are never overwritten.
 *
 * Run: node scripts/migrateUserQuotaFields.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

async function migrate() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const collection = mongoose.connection.collection("users");

    // Preview how many documents need updating
    const count = await collection.countDocuments({ current_plan: { $exists: false } });
    console.log(`Users missing quota fields: ${count}`);

    if (count === 0) {
        console.log("Nothing to migrate. Exiting.");
        await mongoose.disconnect();
        return;
    }

    const result = await collection.updateMany(
        { current_plan: { $exists: false } },
        { $set: { current_plan: "free", ai_calls_this_month: 0 } }
    );

    console.log(`Migrated ${result.modifiedCount} users.`);
    await mongoose.disconnect();
    console.log("Done.");
}

migrate().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});
