// workers/recommendationWorker.js
require('dotenv').config();
const mongoose = require('mongoose');
const { Worker, QueueEvents } = require('bullmq');
const pLimit = require('p-limit').default;
const { connection } = require('../queues'); // removed embeddingQueue import
const Recommendation = require('../models/Recommendation');
const { cosine, score } = require('../services/similarity');
const logger = require('../utils/logger');
const { User } = require('../models/userModel');
const { generateEmbeddings } = require('../services/computeEmbedding');

const projection = {
    user_job_role: 1,
    user_bio: 1,
    user_current_company_name: 1,
    user_id: 1,
    user_job_experience: 1,
    public_user_name: 1,
    profession: 1,
    hobbies: 1,
    academic_level: 1,
    field_of_study: 1,
    embedding: 1,
    last_active_at: 1,
    online: 1,
};

const RECENT_DAYS = parseInt(process.env.RECENT_ACTIVE_DAYS || '14', 10);
const CONCURRENCY = 5; // Tune concurrency to avoid API overload

logger.info(RECENT_DAYS, CONCURRENCY)


const defaultLimit = 500
async function start() {

    // 2. Set up the worker to handle recommendation jobs
    const worker = new Worker(
        'recommendation',
        async (job) => {
            logger.info(`[Worker] Start processing job id=${job._id}, data=`, job.data);

            const { user_id, limit = defaultLimit } = job.data || {};

            // Fetch target user if user_id specified
            let target = null;
            if (user_id) {
                target = await User.findById(user_id, projection).lean();

                // If target user missing, nothing to recommend
                if (!target) {
                    logger.warn(`[Worker] User ${user_id} not found — no recommendations generated`);
                    return { items: [] };
                }

                // If missing embedding, generate and save embedding inline here
                if (!target.embedding || target.embedding.length === 0) {
                    logger.info(`[Worker] Missing embedding for target ${user_id}, generating embedding inline`);
                    const textToEmbed = `Public Name: ${target.public_user_name || ''}
                            Profession: ${target.profession || ''}
                            Hobbies: ${(target.hobbies ?? []).join(', ')}
                            Bio: ${target.user_bio || ''}
                            Academic level: ${target.academic_level || ''}
                            Field of study: ${target.field_of_study || ''}`;

                    try {
                        const embedding = await generateEmbeddings(textToEmbed);

                        console.log({ textToEmbed, embedding })
                        // Update target embedding in DB
                        await User.findByIdAndUpdate(user_id, {
                            embedding,
                            embedding_updated_at: new Date(),
                        });
                        // Refresh target after update for scoring
                        target = await User.findById(user_id, projection).lean();
                    } catch (err) {
                        logger.error(`Embedding generation failed for target user ${user_id}: ${err.message}`);
                        // Set empty recommendations and exit early to avoid faulty recommendations
                        await Recommendation.findOneAndUpdate(
                            { user_id },
                            { $set: { items: [], generatedAt: new Date() } },
                            { upsert: true }
                        );
                        return { status: 'target_embedding_failed' };
                    }
                }
            }

            // Prepare candidates filter: recently active and accessible
            const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * defaultLimit);
            const baseQuery = {
                // last_active_at: { $gte: cutoff },
                access: true,
            };

            if (user_id) {
                baseQuery._id = { $ne: user_id };
            }

            // Fetch candidates
            const candidates = await User.find(baseQuery, projection).lean();

            // Filter candidates who need embeddings
            const candidatesNeedingEmbedding = candidates.filter(
                (c) => !c.embedding || c.embedding.length === 0
            );

            // Limit concurrency for inline embedding generation
            const limitConcurrency = pLimit(CONCURRENCY);

            const embeddingUpdatePromises = candidatesNeedingEmbedding.map((candidate) =>
                limitConcurrency(async () => {
                    const textToEmbed = `Public Name: ${candidate.public_user_name || ''}
                        Profession: ${candidate.profession || ''}
                        Hobbies: ${(candidate.hobbies ?? []).join(', ')}
                        Bio: ${candidate.user_bio || ''}
                        Academic level: ${candidate.academic_level || ''}
                        Field of study: ${candidate.field_of_study || ''}`;
                    try {
                        const embedding = await generateEmbeddings(textToEmbed);
                        await User.findByIdAndUpdate(candidate._id, {
                            embedding,
                            embedding_updated_at: new Date(),
                        });
                    } catch (err) {
                        logger.error(`Embedding generation failed for user ${candidate._id}: ${err.message}`);
                    }
                })
            );

            await Promise.all(embeddingUpdatePromises);

            // Compute recommendation scores only for candidates with embeddings
            const eligible = candidates.filter((c) => c.embedding && c.embedding.length > 0);
            const results = eligible.map((c) => {
                const now = Date.now();
                const lastActive = c.last_active_at ? new Date(c.last_active_at) : null;

                let hours = RECENT_DAYS * 24 + 1; // default: very inactive
                if (lastActive && !isNaN(lastActive.getTime())) {
                    hours = (now - lastActive.getTime()) / (3600 * 1000);
                }

                const recencyScore = Math.max(0, 1 - hours / (RECENT_DAYS * 24));

                let finalScore;
                if (!target) {
                    // Ignore online status, just use recency score
                    finalScore = recencyScore;
                } else {
                    const sim = cosine(target.embedding, c.embedding);
                    finalScore = score(sim, recencyScore, false); // Pass false to ignore online boost
                }

                // Sanitize finalScore
                if (!Number.isFinite(finalScore) || Number.isNaN(finalScore)) {
                    finalScore = 0;
                }

                return { user: c, score: finalScore };
            });

            // Sort descending by score and limit results
            results.sort((a, b) => (b.score || 0) - (a.score || 0));
            const items = results.slice(0, limit).map((r) => ({
                user_id: r.user._id,
                recommendation_value: r.score,
            }));

            // Save recommendations to DB
            await Recommendation.findOneAndUpdate(
                { user_id },
                { $set: { items, created_at: new Date() } },
                { upsert: true }
            );


            logger.info(`[Worker] Job ${job._id} completed — ${items.length} recommendations stored`);
            return { itemsCount: items.length };
        },
        {
            connection,
            lockDuration: 60000, // 60 seconds
        }
    );

    // 3. Log worker-level events
    worker.on('completed', (job) => logger.info(`[Worker Event] Job ${job._id} completed`));
    worker.on('failed', (job, err) =>
        logger.error(`[Worker Event] Job ${job?._id} failed:`, err)
    );
    worker.on('error', (err) => logger.error('[Worker Error]', err));

    // 4. Listen to global queue events
    const queueEvents = new QueueEvents('recommendation', { connection });
    queueEvents.on('active', ({ jobId }) => logger.info(`[QueueEvents] Job ${jobId} is active`));
    queueEvents.on('completed', ({ jobId, returnvalue }) =>
        logger.info(`[QueueEvents] Job ${jobId} completed with return:`, returnvalue)
    );
    queueEvents.on('failed', ({ jobId, failedReason }) =>
        logger.error(`[QueueEvents] Job ${jobId} failed:`, failedReason)
    );

    logger.info('Recommendation worker is up and running');
}

start().catch((err) => {
    console.error('Error starting recommendation worker:', err);
    process.exit(1);
});
