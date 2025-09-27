// queues/index.js
const { Queue } = require('bullmq');
const getRedisInstance = require('../redisClient/redisClient');
const redisClient = getRedisInstance(); // must be a connected ioredis instance



// You can either pass a single URL or ioredis options
const connection = { connection: redisClient };


const recommendationQueue = new Queue('recommendation', connection);
const embeddingQueue = new Queue('embeddings', connection);

module.exports = { recommendationQueue, embeddingQueue, connection: redisClient };
