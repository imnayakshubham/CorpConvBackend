const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Reversible encryption for shared access codes (survey/poll PINs) so the creator can view
// and manage them, while they stay encrypted at rest. AES-256-GCM with a random IV per code.
// Key: PIN_ENCRYPTION_KEY — 64 hex chars (32 bytes). Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const ALGO = 'aes-256-gcm';

const getKey = () => {
    const raw = process.env.PIN_ENCRYPTION_KEY;
    if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
        throw new Error('PIN_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes)');
    }
    return Buffer.from(raw, 'hex');
};

// Returns "iv:tag:ciphertext", all base64.
const encryptCode = (plain) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
};

const decryptCode = (enc) => {
    const [ivB64, tagB64, ctB64] = String(enc).split(':');
    if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted code');
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
};

const encryptCodes = (list) => (Array.isArray(list) ? list : []).map(encryptCode);

// Decrypt best-effort — skip any code that fails to decrypt rather than throwing the whole read.
const decryptCodes = (list) => (Array.isArray(list) ? list : []).reduce((acc, enc) => {
    try { acc.push(decryptCode(enc)); } catch { /* skip unreadable code */ }
    return acc;
}, []);

// True if `plain` matches any stored access code, or the legacy bcrypt hash (back-compat).
const verifyPin = async (plain, { pins, pin_hash } = {}) => {
    if (!plain) return false;
    if (Array.isArray(pins) && pins.length > 0) {
        if (decryptCodes(pins).includes(String(plain))) return true;
    }
    if (pin_hash) {
        try { return await bcrypt.compare(String(plain), pin_hash); } catch { return false; }
    }
    return false;
};

module.exports = { encryptCode, decryptCode, encryptCodes, decryptCodes, verifyPin };
