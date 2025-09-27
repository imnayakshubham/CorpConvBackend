const User = require("../models/userModel");
const getRedisInstance = require("./redisClient")

const redis = getRedisInstance()


const deleteCachedDataInRedis = async (...keys) => {
    await redis.del(...keys);
}

const addOrUpdateCachedDataInRedis = async (key, updatedData, time = 21600) => {
    const redis = getRedisInstance()
    await redis.set(key, JSON.stringify(updatedData), 'EX', time);
}

const getDataInRedis = async (key) => {
    const redis = getRedisInstance();
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
    // set key with TTL so if server crashes it expires
    await redis.set(`online:${userId}`, '1', 'EX', 60);
    // update DB quick snapshot (optional)
    await User.findByIdAndUpdate(userId, { $set: { online: true, last_active_at: new Date() } }).catch(() => { });
    // broadcast presence change
    // we use a pub/sub key to let others know (socket.io adapter will propagate)
    // Note: you may want to publish a message via a dedicated channel so all servers can pick it up.
}

const markOffline = async (userId, redisClient) => {
    await redisClient.del(`online:${userId}`);
    await User.findByIdAndUpdate(userId, { $set: { online: false } }).catch(() => { });
}

module.exports = { deleteCachedDataInRedis, addOrUpdateCachedDataInRedis, getDataInRedis, enqueueEmbeddingJob, popEmbeddingJob, markUserCompletedInJob, markOffline, markOnline }