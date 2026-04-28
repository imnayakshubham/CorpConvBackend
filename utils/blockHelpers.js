const User = require('../models/userModel');
const ReleasedUsername = require('../models/releasedUsernameModel');
const cache = require('../redisClient/cacheHelper');
const { stripAllHtml } = require('./sanitize');
const { fetchLinkMetadata } = require('./fetchLinkMetadata');
const { projection } = require('../constants');

// Cache key generators (block-namespaced)
const getBlocksCacheKey = (idOrUsername) => cache.generateKey('block', 'page-blocks', idOrUsername);
const getBlockProfileCacheKey = (idOrUsername) => cache.generateKey('block', 'page-profile', idOrUsername);

// Resolve user by ID or username, handling released usernames
const resolveUser = async (idOrUsername) => {
    const user = await User.findOne({
        access: true,
        $or: [{ _id: idOrUsername }, { username: idOrUsername }],
    }, projection).lean();

    if (user) return { user };

    const released = await ReleasedUsername.findOne({ username: idOrUsername.toLowerCase() }).lean();
    if (released) {
        const newUser = await User.findById(released.releasedBy).select('username').lean();
        if (newUser?.username) return { redirect: `/${newUser.username}` };
    }
    return { notFound: true };
};

// Wipe all block-related cache entries for a user (both ID and username keyed)
const invalidateBlockCache = async (userId) => {
    const user = await User.findById(userId).select('username').lean();
    const keys = [];
    if (user?.username) {
        keys.push(getBlocksCacheKey(user.username));
        keys.push(getBlockProfileCacheKey(user.username));
    }
    keys.push(getBlocksCacheKey(userId.toString()));
    keys.push(getBlockProfileCacheKey(userId.toString()));
    if (keys.length) await cache.del(...keys);
};

// Mutates block in place  - strips HTML from all text fields
const sanitizeBlockTextFields = (block) => {
    const textFields = ['title', 'subtitle', 'text_content', 'text', 'name', 'role', 'location'];
    for (const field of textFields) {
        if (block[field]) block[field] = stripAllHtml(block[field]);
    }
    return block;
};

// Mutates block in place  - fetches and attaches link metadata for link-type blocks
const attachLinkMetadata = async (block) => {
    if (block.block_type === 'link' && block.url) {
        try {
            const metadata = await fetchLinkMetadata(block.url);
            block.link_metadata = {
                meta_title: metadata.title || '',
                meta_description: metadata.description || '',
                meta_image: metadata.image || '',
                favicon: metadata.favicon || '',
            };
        } catch {
            // Non-critical: link metadata fetch failure is silent
        }
    }
    return block;
};

// Fields to include per block type (DB field names)
const BLOCK_TYPE_FIELDS = {
    link:      ['_id', 'block_type', 'layout', 'text', 'url', 'link_metadata'],
    image:     ['_id', 'block_type', 'layout', 'src'],
    text:      ['_id', 'block_type', 'layout', 'text_content', 'background_color', 'text_color'],
    textCard:  ['_id', 'block_type', 'layout', 'name', 'text', 'background_color', 'text_color'],
    greenText: ['_id', 'block_type', 'layout', 'text'],
    title:     ['_id', 'block_type', 'layout', 'text'],
    embed:     ['_id', 'block_type', 'layout', 'embed_url', 'embed_type', 'title'],
    linkedin:  ['_id', 'block_type', 'layout', 'name', 'role', 'url'],
    github:    ['_id', 'block_type', 'layout', 'name', 'role', 'url'],
    twitter:   ['_id', 'block_type', 'layout', 'name', 'role', 'url'],
    instagram: ['_id', 'block_type', 'layout', 'name', 'role', 'url'],
    youtube:   ['_id', 'block_type', 'layout', 'name', 'role', 'url'],
    upwork:    ['_id', 'block_type', 'layout', 'name', 'role', 'url', 'src'],
    email:     ['_id', 'block_type', 'layout', 'name', 'email_address', 'url'],
    map:       ['_id', 'block_type', 'layout', 'src', 'location'],
    iconCard:  ['_id', 'block_type', 'layout', 'src', 'url'],
};

// Returns a plain object with only type-relevant fields, normalized to frontend naming
const extractBlockFields = (rawBlock) => {
    const block = rawBlock.toObject ? rawBlock.toObject() : rawBlock;
    const fields = BLOCK_TYPE_FIELDS[block.block_type] || ['_id', 'block_type', 'layout'];
    const result = {};
    for (const f of fields) {
        if (block[f] !== undefined) result[f] = block[f];
    }
    // Normalize DB names → frontend names
    result.id = block._id?.toString() || block.id;
    result.type = block.block_type;
    if (result.background_color !== undefined) {
        result.bgColor = result.background_color;
        delete result.background_color;
    }
    if (result.text_color !== undefined) {
        result.textColor = result.text_color;
        delete result.text_color;
    }
    if (result.email_address !== undefined) {
        result.email = result.email_address;
        delete result.email_address;
    }
    delete result._id;
    delete result.block_type;
    return result;
};

module.exports = {
    getBlocksCacheKey,
    getBlockProfileCacheKey,
    resolveUser,
    invalidateBlockCache,
    sanitizeBlockTextFields,
    attachLinkMetadata,
    BLOCK_TYPE_FIELDS,
    extractBlockFields,
};
