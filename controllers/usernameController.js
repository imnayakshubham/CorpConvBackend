const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const ReleasedUsername = require("../models/releasedUsernameModel");
const cache = require("../redisClient/cacheHelper");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RESERVED = new Set([
  'admin', 'support', 'help', 'hushwork', 'official', 'security',
  'abuse', 'legal', 'terms', 'privacy', 'root', 'system', 'bot',
  'api', 'www', 'mail', 'noreply', 'info', 'contact',
  'settings', 'profile', 'dashboard', 'explore', 'search',
  'notifications', 'messages', 'chats', 'post', 'posts',
  'user', 'users', 'login', 'logout', 'signup', 'register',
  'me', 'home', 'feed', 'jobs', 'surveys', 'answerlink', "qna", "polls",
  // Next.js route segments
  'analytics', 'affiliate-links', 'affiliatelinks', 'links',
  'changelog', 'report', 'r', 'answer', 'question', 'questions',
  'survey', 'builder', 'submissions',
  // Settings sub-routes
  'account', 'general',
  // Common reserved
  'onboarding', 'verify', '404', '500', "login", "signup", "sign-up", "sign-in", "signin", "poll", "polls", "hushwork",
  // System / Infra (VERY important)
  'administrator', 'superadmin', 'superuser', 'owner', 'host',
  'hostname', 'server', 'backend', 'frontend', 'client',
  'null', 'undefined', 'true', 'false', 'public', 'private',

  // Network / system accounts (from Unix-like systems)
  'daemon', 'bin', 'sys', 'sync', 'shutdown', 'halt',
  'operator', 'nobody', 'nogroup', 'tty', 'ftp', 'irc',
  'smtp', 'pop', 'imap', 'dns', 'dhcp', 'ssh', 'sshd',
  'mysql', 'postgres', 'mongodb', 'redis',

  // Email / communication
  'mailer', 'mailer-daemon', 'postmaster', 'webmaster',
  'hostmaster', 'usenet', 'news',

  // Auth / security sensitive
  'auth', 'authorize', 'authentication', 'oauth',
  'token', 'session', 'password', 'pass', 'passwd',
  'secure', 'accounting', 'billing',

  // Common routes / pages
  'about', 'about-us', 'team', 'careers', 'company',
  'press', 'blog', 'status', 'docs', 'documentation',
  'faq', 'support-center', 'helpdesk', 'contact-us',

  // App structure / dev
  'app', 'apps', 'dev', 'prod', 'staging', 'test',
  'debug', 'logs', 'errors', 'assets', 'static',
  'uploads', 'files', 'cdn', 'content',

  // API / integrations
  'graphql', 'rest', 'webhook', 'webhooks', 'callback',
  'integrations', 'plugins', 'extensions',

  // Generic nouns (avoid collisions)
  'all', 'everyone', 'someone', 'anyone',
  'admin1', 'admin123', 'user1', 'guest', 'default',

  // Short / high-value handles
  'a', 'i', 'me', 'you', 'we', 'us',

  // Commerce / business
  'store', 'shop', 'cart', 'checkout', 'orders',
  'payments', 'wallet', 'transactions', 'invoice',

  // Social features
  'like', 'likes', 'comment', 'comments',
  'share', 'shares', 'followers', 'following',

  // Moderation
  'moderator', 'mod', 'staff', 'team', 'officials',

  // Misc risky
  'owner', 'founder', 'ceo', 'adminteam'
]);

const USERNAME_REGEX = /^[a-z0-9._]{3,30}$/;
const CHANGE_COOLDOWN_DAYS = 30;
const TAKEN_CACHE_TTL = 86400; // 24 hours

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeUsername(raw) {
  return String(raw).trim().toLowerCase();
}

function validateUsername(username) {
  if (!USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      reason: 'invalid',
      message: 'Username must be 3–30 characters: lowercase letters, numbers, dots, and underscores only.',
    };
  }
  if (
    username.startsWith('.') || username.endsWith('.') ||
    username.startsWith('_') || username.endsWith('_') ||
    username.includes('..') || username.includes('__')
  ) {
    return {
      valid: false,
      reason: 'invalid',
      message: 'Username cannot start/end with or contain consecutive dots or underscores.',
    };
  }
  if (RESERVED.has(username)) {
    return { valid: false, reason: 'reserved', message: 'That username is reserved.' };
  }
  return { valid: true };
}

function takenCacheKey(username) {
  return cache.generateKey('username:taken', username);
}

// ---------------------------------------------------------------------------
// GET /api/username/check?username=<name>
// ---------------------------------------------------------------------------
const checkAvailability = asyncHandler(async (req, res) => {
  const raw = req.query.username;
  if (!raw) {
    return res.status(400).json({ available: false, reason: 'invalid', message: 'username parameter is required' });
  }

  const username = normalizeUsername(raw);
  const validation = validateUsername(username);
  if (!validation.valid) {
    return res.status(400).json({ available: false, reason: validation.reason, message: validation.message });
  }

  // Redis cache check  - value '1' means taken, absence means unknown
  const cached = await cache.get(takenCacheKey(username));
  if (cached !== null) {
    return res.json({ available: false, username, reason: 'taken' });
  }

  // Cooldown pool check (previously used username still in 30-day hold)
  const isInCooldown = await ReleasedUsername.exists({ username });
  if (isInCooldown) {
    return res.json({ available: false, username, reason: 'in_cooldown' });
  }

  // MongoDB  - authoritative source of truth
  const exists = await User.exists({ username });
  if (exists) {
    // Backfill Redis cache on confirmed hit
    await cache.set(takenCacheKey(username), '1', TAKEN_CACHE_TTL);
    return res.json({ available: false, username, reason: 'taken' });
  }

  return res.json({ available: true, username });
});

// ---------------------------------------------------------------------------
// PATCH /api/username  (requires authentication)
// ---------------------------------------------------------------------------
const setUsername = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const username = normalizeUsername(req.body.username ?? '');

  const validation = validateUsername(username);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.reason, message: validation.message });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ error: 'user_not_found', message: 'User not found.' });
  }

  // Enforce 30-day cooldown when changing an existing username
  if (user.username && user.usernameChangedAt) {
    const daysSinceChange = (Date.now() - user.usernameChangedAt.getTime()) / 86_400_000;
    if (daysSinceChange < CHANGE_COOLDOWN_DAYS) {
      const canChangeAt = new Date(
        user.usernameChangedAt.getTime() + CHANGE_COOLDOWN_DAYS * 86_400_000
      );
      return res.status(403).json({
        error: 'change_cooldown',
        message: `You can change your username again after ${canChangeAt.toDateString()}.`,
        canChangeAt,
      });
    }
  }

  // No-op if the user is setting the same username they already have
  if (user.username === username) {
    return res.json({ success: true, username, canChangeAgain: null });
  }

  const previousUsername = user.username;

  // Build atomic update  - unique index is the final race-condition guard
  const updateOps = {
    $set: { username, usernameChangedAt: new Date() },
  };
  if (previousUsername) {
    updateOps.$push = {
      usernameHistory: { username: previousUsername, changedAt: new Date() },
    };
  }

  try {
    await User.findOneAndUpdate({ _id: userId }, updateOps, {
      new: true,
      runValidators: true,
    });
  } catch (err) {
    if (err.code === 11000) {
      // Unique index violation  - name was claimed between check and write
      return res.status(409).json({
        error: 'username_taken',
        message: 'That username was just claimed. Please choose another.',
      });
    }
    throw err;
  }

  // Release old username into the 30-day cooldown pool (non-critical)
  if (previousUsername) {
    ReleasedUsername.create({
      username: previousUsername,
      releasedBy: userId,
      expiresAt: new Date(Date.now() + CHANGE_COOLDOWN_DAYS * 86_400_000),
    }).catch((e) => {
      // Duplicate key means it was already released  - safe to ignore
      if (e.code !== 11000) {
        console.error('[username] Failed to release old username:', e.message);
      }
    });

    // Invalidate old username's cache entry so it becomes available after cooldown
    cache.del(takenCacheKey(previousUsername)).catch(() => { });
  }

  // Mark new username as taken in Redis
  await cache.set(takenCacheKey(username), '1', TAKEN_CACHE_TTL);

  const canChangeAgain = new Date(Date.now() + CHANGE_COOLDOWN_DAYS * 86_400_000);
  return res.json({ success: true, username, canChangeAgain });
});

module.exports = { checkAvailability, setUsername };
