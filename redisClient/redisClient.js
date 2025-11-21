const Redis = require("ioredis");
const { isProd } = require("../constants");

function getRedisInstance() {
    let redis;

    if (isProd) {
        // Production: use the remote Upstash (or whichever) URI
        const uri = `rediss://default:${process.env.UPSTASH_REDIS_REST_TOKEN}@${process.env.UPSTASH_REDIS_REST_URL}:6379?family=6`;
        redis = new Redis(uri, {
            tls: {
                rejectUnauthorized: true, // since it's prod
            },
            family: 6,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        });
    } else {
        const host = process.env.LOCAL_REDIS_HOST || "127.0.0.1";
        const port = process.env.LOCAL_REDIS_PORT || 6379;
        const password = process.env.LOCAL_REDIS_PASSWORD || undefined; // if you have one
        redis = new Redis({
            host,
            port,
            family: 4, // typical local dev uses IPv4
            password,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        });
    }



    redis.on("error", (err) => {
        // console.error("Redis error:", err);
        // Optionally you might not want to throw here in dev, but rather handle gracefully
        if (isProd) {
            throw err;
        }
    });

    return redis;
}

module.exports = getRedisInstance;
