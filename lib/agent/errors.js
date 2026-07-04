// lib/agent/errors.js — framework-neutral error classification + user-facing copy.

const { BRAND_NAME } = require('./config');

// True for capacity/size errors we want to soft-handle (rate limits AND requests that
// blew the token ceiling or got truncated). Used for both the client message and the
// chunked-build retry loop.
function isRateLimitLike(error) {
  const status = error?.statusCode ?? error?.status;
  return (
    status === 429 || status === 413 ||
    /rate.?limit|too large|tokens per minute|TPM|context.{0,12}length|max(imum)?.{0,12}tokens|request too large|payload too large|reduce the (length|amount)|finish.?reason.{0,10}length/i
      .test(error?.message || '')
  );
}

// Maps a streaming/API error into a clean, product-language message for the client.
// Never names models, providers, or "under the hood" mechanics.
function toClientErrorMessage(error, brand = BRAND_NAME) {
  if (isRateLimitLike(error)) {
    const retryAfter = Number(error?.responseHeaders?.['retry-after']);
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? ` Please wait about ${Math.max(30, retryAfter)} seconds before retrying.`
      : ' Please wait about 30 seconds before retrying.';
    return `${brand} is busy right now.${wait}`;
  }
  return `Something went wrong reaching ${brand}. Please try again.`;
}

module.exports = { isRateLimitLike, toClientErrorMessage };
