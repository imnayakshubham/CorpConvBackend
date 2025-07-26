const mongoose = require('mongoose');
require('dotenv').config();

// Configuration - Update these with your MongoDB URIs
const SOURCE_URI = process.env.PROD_MONGO_URI
const DESTINATION_URI = process.env.MONGO_URI

console.log(SOURCE_URI, DESTINATION_URI)
// List of databases to sync
const DATABASES_TO_SYNC = ['test'];

class SimpleDBSyncer {
    async syncDatabases() {
        let sourceConn, destConn;

        try {
            // Create connections
            console.log('🔌 Connecting to databases...');
            sourceConn = mongoose.createConnection(SOURCE_URI);
            destConn = mongoose.createConnection(DESTINATION_URI);

            // Wait for connections
            await sourceConn.asPromise();
            await destConn.asPromise();
            console.log('✅ Connected successfully!');

            // Sync each database
            for (const dbName of DATABASES_TO_SYNC) {
                await this.syncSingleDatabase(sourceConn, destConn, dbName);
            }

            console.log('🎉 All databases synced successfully!');

        } catch (error) {
            console.error('❌ Error:', error.message);
        } finally {
            // Close connections
            if (sourceConn) await sourceConn.close();
            if (destConn) await destConn.close();
            console.log('🔌 Connections closed');
        }
    }

    async syncSingleDatabase(sourceConn, destConn, dbName) {
        console.log(`\n📁 Syncing database: ${dbName}`);

        const sourceDb = sourceConn.useDb(dbName);
        const destDb = destConn.useDb(dbName);

        // Get all collections in the database
        const collections = await sourceDb.db.listCollections().toArray();
        console.log(`Found ${collections.length} collections`);

        // Sync each collection
        for (const collection of collections) {
            await this.syncCollection(sourceDb, destDb, collection.name);
        }
    }

    async syncCollection(sourceDb, destDb, collectionName) {
        try {
            console.log(`  🔄 Syncing: ${collectionName}`);

            // Create models (flexible schema)
            const flexibleSchema = new mongoose.Schema({}, { strict: false });
            const SourceModel = sourceDb.model(collectionName, flexibleSchema, collectionName);
            const DestModel = destDb.model(collectionName, flexibleSchema, collectionName);

            // Get all data from source
            const documents = await SourceModel.find({});

            if (documents.length === 0) {
                console.log(`    ⚠️ No data in ${collectionName}`);
                return;
            }

            // Clear destination and insert new data
            await DestModel.deleteMany({});
            await DestModel.insertMany(documents);

            console.log(`    ✅ Synced ${documents.length} documents`);

        } catch (error) {
            console.error(`    ❌ Error in ${collectionName}:`, error.message);
        }
    }
}

// Run the sync
async function main() {
    const syncer = new SimpleDBSyncer();
    await syncer.syncDatabases();
}

// Execute if run directly
if (require.main === module) {
    main();
}

module.exports = SimpleDBSyncer;
