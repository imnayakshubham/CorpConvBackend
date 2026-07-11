const crypto = require('crypto');

// Build a URL-safe slug from arbitrary text. The suffix combines a millisecond
// timestamp with random bytes, so even identical titles created back-to-back get
// distinct slugs and collisions are effectively impossible.
function generateSlug(text) {
    const base = (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 50)
        .replace(/-+$/, '');
    const suffix = `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    return base ? `${base}-${suffix}` : suffix;
}

module.exports = generateSlug;
