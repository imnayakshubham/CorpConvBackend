/**
 * Migration Script: Jobs to Links
 *
 * This script migrates the existing jobs collection to the new links format.
 *
 * Run this script with: node migration/jobs-to-links.js
 *
 * Make sure to set your MONGO_URI environment variable before running.
 */

require("dotenv").config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

const migrate = async () => {
    try {
        console.log('Starting migration: Jobs → Links');

        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;

        // Check if jobs collection exists
        const collections = await db.listCollections({ name: 'jobs' }).toArray();

        if (collections.length === 0) {
            console.log('No "jobs" collection found. Migration not needed or already completed.');
            await mongoose.disconnect();
            return;
        }

        // Check if links collection already exists
        const linksCollections = await db.listCollections({ name: 'links' }).toArray();
        if (linksCollections.length > 0) {
            console.log('Warning: "links" collection already exists. Proceeding will merge data.');
            console.log('Press Ctrl+C within 5 seconds to abort...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Step 1: Rename the collection (if links doesn't exist)
        if (linksCollections.length === 0) {
            console.log('Step 1: Renaming collection jobs → links');
            await db.collection('jobs').rename('links');
        } else {
            console.log('Step 1: Skipped - links collection already exists');
        }

        // Step 2: Rename fields in all documents
        console.log('Step 2: Renaming fields...');
        await db.collection('links').updateMany({}, {
            $rename: {
                'job_posted_by': 'posted_by',
                'is_job_verified': 'is_verified_source',
                'job_data': 'link_data',
                'job_posted_at': 'posted_at'
            }
        });

        // Step 3: Add default category 'jobs' to all migrated documents
        console.log('Step 3: Adding default category...');
        await db.collection('links').updateMany(
            { category: { $exists: false } },
            { $set: { category: 'jobs' } }
        );

        // Step 4: Rename link_data.job_post_link to link_data.url
        console.log('Step 4: Updating link_data structure...');
        const cursor = db.collection('links').find({ 'link_data.job_post_link': { $exists: true } });

        let updatedCount = 0;
        for await (const doc of cursor) {
            if (doc.link_data && doc.link_data.job_post_link) {
                const newLinkData = {
                    url: doc.link_data.job_post_link,
                    title: doc.link_data.title || '',
                    description: doc.link_data.description || '',
                    image: doc.link_data.image || null,
                    favicon: doc.link_data.favicon || null,
                    author: doc.link_data.author || ''
                };

                await db.collection('links').updateOne(
                    { _id: doc._id },
                    { $set: { link_data: newLinkData } }
                );
                updatedCount++;
            }
        }
        console.log(`Updated ${updatedCount} documents with new link_data structure`);

        // Step 5: Create indexes
        console.log('Step 5: Creating indexes...');
        await db.collection('links').createIndex({ category: 1 });
        await db.collection('links').createIndex({ posted_by: 1 });

        // Try to create unique index on link_data.url, handle duplicates if any
        try {
            await db.collection('links').createIndex({ 'link_data.url': 1 }, { unique: true });
        } catch (e) {
            console.log('Warning: Could not create unique index on link_data.url - there may be duplicates');
            console.log('Creating non-unique index instead...');
            await db.collection('links').createIndex({ 'link_data.url': 1 });
        }

        // Step 6: Verify migration
        console.log('Step 6: Verifying migration...');
        const totalLinks = await db.collection('links').countDocuments();
        const linksWithCategory = await db.collection('links').countDocuments({ category: { $exists: true } });
        const linksWithUrl = await db.collection('links').countDocuments({ 'link_data.url': { $exists: true } });

        console.log(`
Migration Summary:
------------------
Total documents: ${totalLinks}
Documents with category: ${linksWithCategory}
Documents with link_data.url: ${linksWithUrl}
        `);

        if (totalLinks === linksWithCategory && totalLinks === linksWithUrl) {
            console.log('✅ Migration completed successfully!');
        } else {
            console.log('⚠️ Migration completed with warnings. Please verify the data manually.');
        }

        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

// Run migration
migrate();
