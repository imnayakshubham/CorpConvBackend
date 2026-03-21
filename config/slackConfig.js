module.exports = {
  enabled: process.env.SLACK_WEBHOOK_URL ? process.env.SLACK_NOTIFICATIONS_ENABLED ?? true : false,
  webhookUrl: process.env.SLACK_WEBHOOK_URL || null,
  notifications: {
    onLogin: process.env.SLACK_NOTIFY_LOGIN ?? true,
    onSignUp: process.env.SLACK_NOTIFY_SIGNUP ?? true,
  },
};
