const axios = require('axios');
const slackConfig = require('../config/slackConfig');
const eventBus = require('./eventBus');

// --- Block Kit builders ---

function buildHeader(text) {
  return {
    type: 'header',
    text: { type: 'plain_text', text, emoji: true },
  };
}

function buildFields(user) {
  return {
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Email:*\n${user.user_email_id || user.email || 'N/A'}` },
      { type: 'mrkdwn', text: `*Handle:*\n${user.username || user.actual_user_name || 'N/A'}` },
      { type: 'mrkdwn', text: `*Company:*\n${user.user_current_company_name || 'N/A'}` },
      { type: 'mrkdwn', text: `*Role:*\n${user.user_job_role || 'N/A'}` },
    ],
  };
}

function buildContext(timestamp) {
  const ts = timestamp ? new Date(timestamp) : new Date();
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `<!date^${Math.floor(ts.getTime() / 1000)}^{date_short_pretty} at {time}|${ts.toISOString()}>`,
      },
    ],
  };
}

function buildPayload(title, user) {
  return {
    blocks: [
      buildHeader(title),
      buildFields(user),
      { type: 'divider' },
      buildContext(user.createdAt || user.updatedAt),
    ],
  };
}

// --- Core send ---

async function send(payload) {
  if (!slackConfig.enabled || !slackConfig.webhookUrl) return;
  axios.post(slackConfig.webhookUrl, payload).catch((err) => {
    console.error('[slackService] Webhook POST failed:', err.message);
  });
}

// --- Notification handlers ---

async function onLogin(user) {
  if (!slackConfig.notifications.onLogin) return;
  await send(buildPayload(':bust_in_silhouette:  User Logged In', user));
}

async function onSignUp(user) {
  if (!slackConfig.notifications.onSignUp) return;
  await send(buildPayload(':wave:  New User Signed Up', user));
}

// --- Init: register event listeners ---

function init() {
  eventBus.on('user:login', (user) => {
    onLogin(user).catch((err) => console.error('[slackService] onLogin error:', err.message));
  });

  eventBus.on('user:signup', (user) => {
    onSignUp(user).catch((err) => console.error('[slackService] onSignUp error:', err.message));
  });

  console.log('[slackService] Slack notification listeners registered.');
}

module.exports = { init, onLogin, onSignUp };
