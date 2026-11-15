const cache = require("../redisClient/cacheHelper");

const IDLE_THRESHOLD_MS = 13 * 60 * 1000;
const REDIS_WRITE_INTERVAL_MS = 60 * 1000;
const KEEPALIVE_HEADER = "x-hushwork-keepalive";
const REDIS_HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_KEY = cache.generateKey("service", "last_active");
const HEARTBEAT_KEY = cache.generateKey("service", "heartbeat");

let lastActiveAt = Date.now();
let lastRedisWriteAt = 0;
let lastRedisHeartbeatAt = 0;

const recordRedisWrite = (ok) => {
    if (ok) lastRedisHeartbeatAt = Date.now();
};

const trackServiceActivity = (req, res, next) => {
    if (req.get(KEEPALIVE_HEADER)) return next();

    const now = Date.now();
    lastActiveAt = now;
    if (now - lastRedisWriteAt >= REDIS_WRITE_INTERVAL_MS) {
        lastRedisWriteAt = now;
        cache.set(ACTIVE_KEY, now, IDLE_THRESHOLD_MS / 1000).then(recordRedisWrite);
    }
    next();
};

const getLastActiveAt = () => lastActiveAt;

const getRedisLastActiveAt = async () => {
    const value = await cache.get(ACTIVE_KEY);
    return typeof value === "number" ? value : null;
};

const ensureRedisHeartbeat = async () => {
    if (Date.now() - lastRedisHeartbeatAt < REDIS_HEARTBEAT_INTERVAL_MS) return;
    recordRedisWrite(await cache.set(HEARTBEAT_KEY, Date.now(), 2 * REDIS_HEARTBEAT_INTERVAL_MS / 1000));
};

const markActive = (at = Date.now()) => {
    lastActiveAt = Math.max(lastActiveAt, Math.min(at, Date.now()));
};

module.exports = {
    IDLE_THRESHOLD_MS,
    KEEPALIVE_HEADER,
    trackServiceActivity,
    getLastActiveAt,
    getRedisLastActiveAt,
    ensureRedisHeartbeat,
    markActive,
};
