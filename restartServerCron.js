const cron = require("cron")

const https = require("https")
const getRedisInstance = require("./redisClient/redisClient")

const job = new cron.CronJob('*/14 * * * *', () => {
    const backendUrl = process.env.BACKEND_URL
    console.log("Cron Running....")
    https.get(backendUrl, (res) => {
        if (res.statusCode === 200) {
            console.log("Server Restarted.....")
        } else {
            console.error(`failed to restart server with status code: ${res.statusCode}`)
        }
    }).on("error", (error) => {
        console.error(`Error while Restarting Server : ${error.message}`)
    })
})

// Start the cron job after 15 days

const pingRedis = new cron.CronJob("0 0 */20 * *", () => {
    const redis = getRedisInstance()
    redis.ping((err, result) => {
        if (err) {
            console.error("Error pinging Redis:", err);
        } else {
            console.log("Redis is alive:");
        }
    });
})

module.exports = {
    job,
    pingRedis
}