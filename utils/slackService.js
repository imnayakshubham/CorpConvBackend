const axios = require('axios');
const slackConfig = require('../config/slackConfig');
const eventBus = require('./eventBus');

// --- Rate limiter ---

const perUserMap = new Map();
const globalTimestamps = [];

function getUserKey(eventType, user) {
  const id = user._id || user.id || user.user_email_id || 'unknown';
  return `${eventType}:${id}`;
}

function isPerUserLimited(eventType, user) {
  const key = getUserKey(eventType, user);
  const now = Date.now();
  const windowMs = slackConfig.rateLimit.perUserWindowMs;
  const lastSent = perUserMap.get(key);
  if (lastSent && now - lastSent < windowMs) return true;
  perUserMap.set(key, now);
  return false;
}

function isGlobalLimited() {
  const now = Date.now();
  const windowStart = now - 60_000;
  while (globalTimestamps.length && globalTimestamps[0] < windowStart) {
    globalTimestamps.shift();
  }
  if (globalTimestamps.length >= slackConfig.rateLimit.globalMaxPerMinute) return true;
  globalTimestamps.push(now);
  return false;
}

function cleanupStaleLimitEntries() {
  const now = Date.now();
  const windowMs = slackConfig.rateLimit.perUserWindowMs;
  for (const [key, ts] of perUserMap) {
    if (now - ts > windowMs) perUserMap.delete(key);
  }
}

setInterval(cleanupStaleLimitEntries, 10 * 60 * 1000).unref();

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
  if (isPerUserLimited('login', user) || isGlobalLimited()) return;
  await send(buildPayload(':bust_in_silhouette:  User Logged In', user));
}

async function onSignUp(user) {
  if (!slackConfig.notifications.onSignUp) return;
  if (isPerUserLimited('signup', user) || isGlobalLimited()) return;
  await send(buildPayload(':wave:  New User Signed Up', user));
}

async function onFeedback(user, feedback) {
  if (isGlobalLimited()) return;
  await send({
    blocks: [
      buildHeader(':speech_balloon:  New Feedback Submitted'),
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Type:*\n${feedback.type || 'N/A'}` },
          { type: 'mrkdwn', text: `*Title:*\n${feedback.title || 'N/A'}` },
          { type: 'mrkdwn', text: `*Email:*\n${user.user_email_id || user.email || 'N/A'}` },
          { type: 'mrkdwn', text: `*Handle:*\n${user.username || user.actual_user_name || 'N/A'}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Description:*\n${feedback.description || 'N/A'}` },
      },
      { type: 'divider' },
      buildContext(new Date()),
    ],
  });
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

module.exports = { init, onLogin, onSignUp, onFeedback };
