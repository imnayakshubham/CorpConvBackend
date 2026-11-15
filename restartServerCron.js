const https = require("https")
const {
    IDLE_THRESHOLD_MS,
    KEEPALIVE_HEADER,
    getLastActiveAt,
    getRedisLastActiveAt,
    ensureRedisHeartbeat,
    markActive,
} = require("./utils/serviceActivity")

let timer = null

const pingSelf = () => {
    const backendUrl = process.env.BACKEND_URL
    if (!backendUrl) {
        console.error("Keep-alive ping skipped: BACKEND_URL is not set.")
        return
    }

    https.get(backendUrl, { headers: { [KEEPALIVE_HEADER]: "1" }, timeout: 10000 }, (res) => {
        res.resume()
        if (res.statusCode < 400) {
            console.log("Keep-alive ping sent.")
        } else {
            console.error(`Keep-alive ping failed with status code: ${res.statusCode}`)
        }
    })
        .on("timeout", function () { this.destroy(new Error("timed out")) })
        .on("error", (error) => {
            console.error(`Keep-alive ping error: ${error.message}`)
        })
}

const scheduleNext = (delayMs) => {
    timer = setTimeout(tick, Math.max(delayMs, 1000))
    timer.unref()
}

const msUntilIdle = () => getLastActiveAt() + IDLE_THRESHOLD_MS - Date.now()

async function tick() {
    try {
        await ensureRedisHeartbeat()
        if (msUntilIdle() > 0) return

        const redisLastActiveAt = await getRedisLastActiveAt()
        if (redisLastActiveAt) markActive(redisLastActiveAt)
        if (msUntilIdle() > 0) return

        markActive()
        pingSelf()
    } catch (error) {
        console.error(`Keep-alive check error: ${error.message}`)
    } finally {
        scheduleNext(msUntilIdle() > 0 ? msUntilIdle() : IDLE_THRESHOLD_MS)
    }
}

const start = () => {
    if (timer) return
    scheduleNext(IDLE_THRESHOLD_MS)
}

module.exports = {
    start
}
