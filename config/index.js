


const config = {
    cloudflare: {
        accountId: process.env.CLOUDFARE_ACCOUNT_ID,
        apiToken: process.env.CLOUDFARE_API_TOKEN,
        baseUrl: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFARE_ACCOUNT_ID}/ai`
    },
    rateLimits: {
        retryDelay: 1000, // ms
        maxRetries: 3
    }
};

if (!config.cloudflare.accountId || !config.cloudflare.apiToken) {
    throw new Error('Missing required Cloudflare credentials');
}

module.exports = config;
