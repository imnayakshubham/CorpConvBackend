const cron = require("cron")

const https = require("https")

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

const restartHf = new cron.CronJob('0 0 * * *', () => {
    const url = `${process.env.HF_API_END_POINT}health`
    console.log("Cron Running....")
    https.get(url, (res) => {
        if (res.statusCode === 200) {
            console.log("HF Restarted.....")
        } else {
            console.error(`failed to restart HF with status code: ${res.statusCode}`)
        }
    }).on("error", (error) => {
        console.error(`Error while Restarting HF : ${error.message}`)
    })
})



module.exports = {
    job,
    restartHf
}