const getRedisInstance = require("./redisClient");

let redis = null;
let isAvailable = true;

/**
 * Get Redis instance with availability tracking
 * @returns {Object|null} Redis instance or null if unavailable
 */
const getRedis = () => {
    if (!redis) {
        redis = getRedisInstance();
        if (redis) {
            redis.on('error', () => { isAvailable = false; });
            redis.on('connect', () => { isAvailable = true; });
        }
    }
    return isAvailable ? redis : null;
};

/**
 * Generate a cache key with environment prefix
 * @param {string} prefix - Key prefix (e.g., 'questions', 'comments')
 * @param {...string} parts - Additional key parts to join
 * @returns {string} Generated cache key
 */
const generateKey = (prefix, ...parts) => {
    const env = process.env.APP_ENV || 'DEV';
    return `${env}:${prefix}:${parts.filter(Boolean).join(':')}`;
};

/**
 * Get cached data from Redis
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Parsed data or null if not found/error
 */
const get = async (key) => {
    const r = getRedis();
    if (!r) return null;
    try {
        const data = await r.get(key);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        console.error(`Redis GET error [${key}]:`, err.message);
        return null;
    }
};

/**
 * Set data in Redis cache
 * @param {string} key - Cache key
 * @param {any} data - Data to cache (will be JSON stringified)
 * @param {number} ttlSeconds - Time to live in seconds (default 6 hours)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const set = async (key, data, ttlSeconds = 21600) => {
    const r = getRedis();
    if (!r) return false;
    try {
        await r.set(key, JSON.stringify(data), 'EX', ttlSeconds);
        return true;
    } catch (err) {
        console.error(`Redis SET error [${key}]:`, err.message);
        return false;
    }
};

/**
 * Delete one or more keys from Redis cache
 * @param {...(string|string[])} keys - Keys to delete (can be strings or arrays)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const del = async (...keys) => {
    const r = getRedis();
    if (!r || keys.length === 0) return false;
    try {
        const flatKeys = keys.flat().filter(Boolean);
        if (flatKeys.length > 0) await r.del(...flatKeys);
        return true;
    } catch (err) {
        console.error(`Redis DEL error:`, err.message);
        return false;
    }
};

/**
 * Delete all keys matching a pattern
 * @param {string} pattern - Pattern to match (e.g., 'DEV:posts:*')
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const delByPattern = async (pattern) => {
    const r = getRedis();
    if (!r) return false;
    try {
        const keys = await r.keys(pattern);
        if (keys.length > 0) await r.del(...keys);
        return true;
    } catch (err) {
        console.error(`Redis DEL pattern error [${pattern}]:`, err.message);
        return false;
    }
};

module.exports = { get, set, del, delByPattern, generateKey, getRedis };
