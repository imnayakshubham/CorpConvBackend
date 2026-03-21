const cron = require("cron")
const https = require("https")
const getRedisInstance = require("./redisClient/redisClient")

const job = new cron.CronJob('*/14 * * * *', async () => {
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

    try {
        const redis = getRedisInstance()
        if (redis) {
            await redis.ping()
            console.log("Redis pinged successfully.")
        }
    } catch (error) {
        console.error(`Error while pinging Redis: ${error.message}`)
    }
})


module.exports = {
    job
}