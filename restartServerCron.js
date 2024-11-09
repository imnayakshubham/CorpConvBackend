const cron = require("cron")

const https = require("https")

const job = new cron.CronJob('*/10 * * * * *', () => {
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


module.exports = {
    job
}