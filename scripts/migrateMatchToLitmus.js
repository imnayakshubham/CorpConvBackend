/**
 * Migration Script: Rename the "Match" feature to "Litmus"
 *
 * The feature was renamed from `match` → `litmus` across the codebase. The Mongoose
 * models now map to explicit collections `litmus` / `litmussubmissions` (see
 * models/litmusModel.js). This script migrates any pre-existing data:
 *
 * 1. Renames collection `matches`         → `litmus`
 * 2. Renames collection `matchsubmissions` → `litmussubmissions`
 * 3. On the submissions collection, renames fields:
 *      match_id         → litmus_id
 *      match_created_by → litmus_created_by
 *
 * Idempotent & safe: each step is skipped when there is nothing to do (target already
 * exists, or the source collection is absent — e.g. a fresh/pre-launch database).
 *
 * Run with: node scripts/migrateMatchToLitmus.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGO_URI
        if (!mongoURI) {
            throw new Error('MongoDB URI not found in environment variables');
        }
        await mongoose.connect(mongoURI);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

const collectionExists = async (db, name) => {
    const found = await db.listCollections({ name }).toArray();
    return found.length > 0;
};

const renameCollection = async (db, from, to) => {
    const hasFrom = await collectionExists(db, from);
    const hasTo = await collectionExists(db, to);

    if (!hasFrom) {
        console.log(`  • '${from}' not found — nothing to rename (fresh DB or already migrated).`);
        return;
    }
    if (hasTo) {
        console.log(`  • target '${to}' already exists — skipping rename of '${from}' to avoid clobbering.`);
        return;
    }
    await db.renameCollection(from, to);
    console.log(`  ✓ renamed '${from}' → '${to}'`);
};

const renameSubmissionFields = async (db) => {
    if (!(await collectionExists(db, 'litmussubmissions'))) {
        console.log(`  • 'litmussubmissions' not found — skipping field rename.`);
        return;
    }
    const col = db.collection('litmussubmissions');
    const res = await col.updateMany(
        { $or: [{ match_id: { $exists: true } }, { match_created_by: { $exists: true } }] },
        { $rename: { match_id: 'litmus_id', match_created_by: 'litmus_created_by' } }
    );
    console.log(`  ✓ renamed fields on ${res.modifiedCount} submission document(s)`);
};

const run = async () => {
    await connectDB();
    const db = mongoose.connection.db;

    console.log('Starting match → litmus migration...');
    console.log('Step 1/3: rename collections');
    await renameCollection(db, 'matches', 'litmus');
    console.log('Step 2/3: rename submissions collection');
    await renameCollection(db, 'matchsubmissions', 'litmussubmissions');
    console.log('Step 3/3: rename submission fields');
    await renameSubmissionFields(db);

    console.log('Migration complete.');
    await mongoose.disconnect();
    process.exit(0);
};

run().catch(async (err) => {
    console.error('Migration failed:', err);
    await mongoose.disconnect();
    process.exit(1);
});
