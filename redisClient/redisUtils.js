const getRedisInstance = require("./redisClient")

const deleteCachedDataInRedis = async (...keys) => {
    const redis = getRedisInstance()
    await redis.del(...keys);
}

const addOrupdateCachedDataInRedis = async (key, updatedData, time = 21600) => {
    const redis = getRedisInstance()
    await redis.set(key, JSON.stringify(updatedData), 'EX', time);
}

module.exports = { deleteCachedDataInRedis, addOrupdateCachedDataInRedis }