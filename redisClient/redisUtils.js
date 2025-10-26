const getRedisInstance = require("./redisClient")
const { User } = require("../models/userModel");
const logger = require("../utils/logger");

const redis = getRedisInstance()

const deleteCachedDataInRedis = async (...keys) => {
    await redis.del(...keys);
}

const addOrUpdateCachedDataInRedis = async (key, updatedData, time = 21600) => {
    await redis.set(key, JSON.stringify(updatedData), 'EX', time);
}

const getOrAddDataInRedis = async (key, value = null, time = 21600) => {
    const data = await redis.get(key);
    if (!data && !!value) {
        await redis.set(key, JSON.stringify(value), 'EX', time);
        return value;
    }

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


const markOnline = async (user_id) => {
    if (!user_id) return;
    // Set Redis key with TTL (e.g., 60 seconds)
    await redis.set(`online:${user_id}`, '1', 'EX', 60);
};

const markOffline = async (user_id) => {
    if (!user_id) return;
    logger.info("login===> ", user_id)
    // Remove Redis key immediately
    await redis.del(`online:${user_id}`);
    // Update MongoDB on explicit offline only
    await User.findByIdAndUpdate(user_id, { online: false, last_active_at: new Date() });
};

const syncOnlineStatusToDB = async () => {
    try {
        // Get all userIds with online keys from Redis
        const keys = await redis.keys('online:*');
        const onlineUserIds = keys.map(key => key.split(':')[1]);

        if (onlineUserIds.length === 0) {
            console.log("herrerl")
            return; // No users to sync
        }

        // Better Auth uses string UUIDs as user IDs, not ObjectIds
        // We need to query by the string _id field, not cast to ObjectId
        // Use $toString to convert ObjectId to string for comparison if needed
        // Or ensure the _id field matches the type being stored (string vs ObjectId)

        // Update using string comparison since Better Auth IDs are strings
        console.log({ onlineUserIds })
        await User.updateMany(
            { _id: { $in: onlineUserIds } },
            { $set: { online: true, last_active_at: new Date() } }
        );

        logger.info(`Synced online status for ${onlineUserIds.length} users`);
    } catch (err) {
        // User IDs from Better Auth are UUID strings, not ObjectIds
        // This error occurs when mixing Better Auth (UUIDs) with Mongoose (ObjectIds)
        logger.error('Error syncing online status to DB:', err.message);

        // Log the specific issue for debugging
        if (err.name === 'CastError') {
            logger.warn('User ID type mismatch: Better Auth uses UUID strings, ensure User model _id type matches');
            // Silently skip this sync - Better Auth manages its own user sessions
        }
    }
};

module.exports = { deleteCachedDataInRedis, addOrUpdateCachedDataInRedis, getOrAddDataInRedis, enqueueEmbeddingJob, popEmbeddingJob, markUserCompletedInJob, markOffline, markOnline, syncOnlineStatusToDB }