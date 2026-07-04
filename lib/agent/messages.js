// lib/agent/messages.js — framework-neutral helpers for UI-message arrays.

// Pull the plain text out of a UI message (string content or text parts).
function extractUserText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join(' ');
}

// Return the last user message in a list (or undefined).
function lastUserMessage(messages) {
  return [...(messages || [])].reverse().find((m) => m?.role === 'user');
}

// Replace the text of the final message, preserving its shape (string vs parts).
function replaceLastMessageText(msgs, newText) {
  if (!msgs || !msgs.length) return msgs;
  const last = msgs[msgs.length - 1];
  let updated;
  if (typeof last.content === 'string') {
    updated = { ...last, content: newText };
  } else if (Array.isArray(last.parts)) {
    updated = { ...last, parts: last.parts.map((p) => (p?.type === 'text' ? { ...p, text: newText } : p)) };
  } else {
    updated = { ...last, content: newText };
  }
  return [...msgs.slice(0, -1), updated];
}

module.exports = { extractUserText, lastUserMessage, replaceLastMessageText };
