/**
 * Migration Script: Add field_id to existing survey fields
 *
 * This script migrates existing surveys to the new schema by:
 * 1. Adding unique field_id to each field in survey_form
 * 2. Adding default page_index (0) to fields without it
 * 3. Ensuring backwards compatibility with existing data
 *
 * Run with: node scripts/migrateSurveys.js
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

// Generate unique ID (compatible with older Node.js versions)
const generateId = () => {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older Node.js versions
    return new mongoose.Types.ObjectId().toString();
};

// Connect to MongoDB
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
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

// Simple survey model for migration (using raw collection)
const migrateSurveys = async () => {
    const db = mongoose.connection.db;
    const surveysCollection = db.collection('surveys');

    console.log('Starting survey migration...');

    // Find all surveys
    const surveys = await surveysCollection.find({}).toArray();
    console.log(`Found ${surveys.length} surveys to migrate`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const survey of surveys) {
        let needsUpdate = false;
        const updatedFields = [];

        if (survey.survey_form && Array.isArray(survey.survey_form)) {
            for (const field of survey.survey_form) {
                const updatedField = { ...field };

                // Add field_id if missing
                if (!field.field_id) {
                    // Use existing _id if available, otherwise generate new UUID
                    updatedField.field_id = field._id
                        ? field._id.toString()
                        : `field_${generateId()}`;
                    needsUpdate = true;
                }

                // Add page_index if missing
                if (field.page_index === undefined) {
                    updatedField.page_index = 0;
                    needsUpdate = true;
                }

                // Migrate user_select_options to new format with is_correct and score
                if (field.user_select_options && Array.isArray(field.user_select_options)) {
                    updatedField.user_select_options = field.user_select_options.map(opt => ({
                        label: opt.label,
                        value: opt.value,
                        is_correct: opt.is_correct ?? false,
                        score: opt.score ?? 0
                    }));
                }

                updatedFields.push(updatedField);
            }
        }

        if (needsUpdate) {
            // Prepare default settings for new fields
            const updateData = {
                survey_form: updatedFields
            };

            // Add default pages if not present
            if (!survey.pages || survey.pages.length === 0) {
                updateData.pages = [{
                    page_id: `page_${generateId()}`,
                    title: 'Page 1',
                    description: '',
                    order: 0
                }];
            }

            // Add default quiz_settings if not present
            if (!survey.quiz_settings) {
                updateData.quiz_settings = {
                    enabled: false,
                    show_correct_answers: true,
                    show_score_immediately: true,
                    passing_score: 0,
                    randomize_questions: false,
                    randomize_options: false
                };
            }

            // Add default sharing settings if not present
            if (!survey.sharing) {
                updateData.sharing = {
                    is_public: true,
                    password_protected: false,
                    allow_anonymous: false,
                    embed_enabled: true,
                    close_message: 'Thank you for your submission!'
                };
            }

            // Add default response_settings if not present
            if (!survey.response_settings) {
                updateData.response_settings = {
                    one_response_per_user: false,
                    allow_edit_response: false,
                    show_progress_bar: true
                };
            }

            // Add default theme if not present
            if (!survey.theme) {
                updateData.theme = {
                    primary_color: '#000000',
                    background_color: '#ffffff',
                    font_family: 'Inter',
                    button_style: 'rounded'
                };
            }

            // Add default notifications if not present
            if (!survey.notifications) {
                updateData.notifications = {
                    email_on_submission: false,
                    notification_emails: [],
                    webhook_enabled: false
                };
            }

            await surveysCollection.updateOne(
                { _id: survey._id },
                { $set: updateData }
            );

            migratedCount++;
            console.log(`Migrated survey: ${survey.survey_title} (${survey._id})`);
        } else {
            skippedCount++;
        }
    }

    console.log(`\nMigration complete!`);
    console.log(`- Migrated: ${migratedCount} surveys`);
    console.log(`- Skipped (already up to date): ${skippedCount} surveys`);
};

// Migrate submissions to new format
const migrateSubmissions = async () => {
    const db = mongoose.connection.db;
    const submissionsCollection = db.collection('submissions');

    console.log('\nStarting submission migration...');

    const submissions = await submissionsCollection.find({
        responses: { $exists: false }
    }).toArray();

    console.log(`Found ${submissions.length} submissions to migrate`);

    let migratedCount = 0;

    for (const submission of submissions) {
        if (submission.submissions && Array.isArray(submission.submissions)) {
            // Convert old format to new responses format
            const responses = submission.submissions.map((item, index) => ({
                field_id: item.field_id || item._id?.toString() || item.question_id || `legacy_field_${index}`,
                label: item.label || '',
                input_type: item.input_type || '',
                value: item.value,
                is_correct: item.is_correct ?? null,
                score_earned: item.score_earned ?? 0
            }));

            await submissionsCollection.updateOne(
                { _id: submission._id },
                {
                    $set: {
                        responses,
                        total_score: 0,
                        max_possible_score: 0,
                        percentage_score: 0,
                        is_partial: false,
                        current_page: 0
                    }
                }
            );

            migratedCount++;
        }
    }

    console.log(`Migrated ${migratedCount} submissions`);
};

// Main execution
const main = async () => {
    try {
        await connectDB();
        await migrateSurveys();
        await migrateSubmissions();
        console.log('\nAll migrations completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
        process.exit(0);
    }
};

main();
