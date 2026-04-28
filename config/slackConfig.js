module.exports = {
  enabled: process.env.NODE_ENV === 'production' && !!process.env.SLACK_WEBHOOK_URL && (process.env.SLACK_NOTIFICATIONS_ENABLED ?? true),
  webhookUrl: process.env.SLACK_WEBHOOK_URL || null,
  notifications: {
    onLogin: process.env.SLACK_NOTIFY_LOGIN ?? true,
    onSignUp: process.env.SLACK_NOTIFY_SIGNUP ?? true,
  },
  rateLimit: {
    perUserWindowMs: parseInt(process.env.SLACK_RATE_LIMIT_USER_WINDOW_MS ?? String(5 * 60 * 1000), 10),
    globalMaxPerMinute: parseInt(process.env.SLACK_RATE_LIMIT_GLOBAL_MAX ?? '30', 10),
  },
};
