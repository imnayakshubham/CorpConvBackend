// workers/embeddingsWorker.js
require('dotenv').config();
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const User = require('../models/userModel');
const { generateEmbeddings } = require('../controllers/aiController');
const getRedisInstance = require('../redisClient/redisClient');

async function start() {
    mongoose.connect(process.env.MONGO_URI).then(() => {
        console.log("Worker connected to MongoDB");
    });

    const worker = new Worker('embeddings',
        async job => {
            const { user_id } = job.data;
            const user = await User.findById(user_id);
            if (!user) return;

            // Compose text per requirement:
            const textToEmbed = `Public Name: ${user.public_user_name || ''}           Profession: ${user.profession || ''}           Hobbies: ${(user.hobbies ?? []).join(', ')}           Bio: ${user.user_bio || ''}           Academic level: ${user.academic_level || ''}           Field of study: ${user.field_of_study || ''}`;

            const embedding = await generateEmbeddings(textToEmbed);

            user.embedding = embedding;
            user.embedding_updated_at = new Date();
            await user.save();
            return { success: true };
        },
        {
            connection: getRedisInstance(),
            concurrency: 2,
        }
    );

    worker.on('stalled', jobId => {
        console.warn(`Job ${jobId} has stalled`);
    });

    worker.on('completed', job => console.log('emb job completed', job._id));
    worker.on('failed', (job, err) => console.error('emb job failed', job._id, err));
}

start().catch(err => {
    console.error(err);
    process.exit(1);
});
