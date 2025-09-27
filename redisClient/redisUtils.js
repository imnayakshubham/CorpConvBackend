const getRedisInstance = require("./redisClient")
const User = require("../models/userModel");
const logger = require("../utils/logger");

const redis = getRedisInstance()

const deleteCachedDataInRedis = async (...keys) => {
    await redis.del(...keys);
}

const addOrUpdateCachedDataInRedis = async (key, updatedData, time = 21600) => {
    await redis.set(key, JSON.stringify(updatedData), 'EX', time);
}

const getDataInRedis = async (key) => {
    const data = await redis.get(key);
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch (err) {
        console.error(`Failed to parse JSON from Redis for key ${key}:`, err);
        return null;
    }
};


function enqueueEmbeddingJob(key, user_id) {
    const job = {
        status: 'pending',
        users: user_id,
        last_updated_at: null
    };
    return redis.set(`${key}__embed_jobs`, JSON.stringify(job));
}

async function popEmbeddingJob() {
    const msg = await redis.brpop(`${key}__embed_jobs`, 0);
    return JSON.parse(msg[1]);
}

async function markUserCompletedInJob(key, job, completedUserId) {
    const updatedJob = {
        ...job,
        users: completedUserId,
        last_updated_at: Date.now()
    };
    // Requeue the updated job
    await redis.set(`${key}__embed_jobs`, JSON.stringify(updatedJob));
}


const markOnline = async (userId) => {
    if (!userId) return;
    // Set Redis key with TTL (e.g., 60 seconds)
    await redis.set(`online:${userId}`, '1', 'EX', 60);
};

const markOffline = async (userId) => {
    if (!userId) return;
    logger.info("login===> ", userId)
    // Remove Redis key immediately
    await redis.del(`online:${userId}`);
    // Update MongoDB on explicit offline only
    await User.findByIdAndUpdate(userId, { online: false, last_active_at: new Date() });
};

const syncOnlineStatusToDB = async () => {
    try {
        // Example: get all userIds with online keys from Redis (using SCAN or Redis sets if maintained)
        const keys = await redis.keys('online:*');
        const onlineUserIds = keys.map(key => key.split(':')[1]);

        // Mark these users online & update last_active_at
        await User.updateMany(
            { _id: { $in: onlineUserIds } },
            { $set: { online: true, last_active_at: new Date() } }
        );

        // Optionally mark users offline in DB who don't have Redis online keys
        // if this fits the use case
    } catch (err) {
        console.error('Error syncing online status to DB:', err);
    }
};

module.exports = { deleteCachedDataInRedis, addOrUpdateCachedDataInRedis, getDataInRedis, enqueueEmbeddingJob, popEmbeddingJob, markUserCompletedInJob, markOffline, markOnline, syncOnlineStatusToDB }