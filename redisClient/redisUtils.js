const getRedisInstance = require("./redisClient")

const deleteCachedDataInRedis = async (...keys) => {
    const redis = getRedisInstance()
    if (redis) {
        try {
            await redis.del(...keys);
        } catch (error) {
            console.error("Redis delete error:", error.message);
        }
    }
}

const addOrupdateCachedDataInRedis = async (key, updatedData, time = 21600) => {
    const redis = getRedisInstance()
    if (redis) {
        try {
            await redis.set(key, JSON.stringify(updatedData), 'EX', time);
        } catch (error) {
            console.error("Redis set error:", error.message);
        }
    }
}

module.exports = { deleteCachedDataInRedis, addOrupdateCachedDataInRedis }