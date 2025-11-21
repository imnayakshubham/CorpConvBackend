const { Queue, QueueEvents } = require('bullmq');
const getRedisInstance = require('../redisClient/redisClient');

// Create a dedicated Redis connection for QueueEvents
const eventsConnection = getRedisInstance();

// Create the main Redis connection for Queue and Worker
const connection = getRedisInstance();

// Create the embedding queue
const embeddingQueue = new Queue('embeddingQueue', {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
    },
});

// Create QueueEvents with a dedicated connection
const embeddingEvents = new QueueEvents('embeddingQueue', { connection: eventsConnection });

embeddingEvents.on('added', ({ jobId, failedReason }) => {
    console.log(`Job ${jobId}`);
});

embeddingEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`Job ${jobId} failed: ${failedReason}`);
});

module.exports = { embeddingQueue, embeddingEvents, connection };
