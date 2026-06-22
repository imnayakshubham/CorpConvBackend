const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const blockTypes = z.enum([
    'link', 'image', 'text', 'embed',
    'title', 'textCard', 'linkedin', 'github', 'twitter',
    'instagram', 'youtube', 'email', 'greenText', 'upwork',
    'iconCard', 'map',
]);
const blockSizes = z.enum(['small', 'medium', 'large']);
const embedTypes = z.enum(['youtube', 'spotify', 'twitter', 'other', '']);

// Truncate-tolerant string: clamps to max instead of rejecting the whole save.
const boundedString = (max) =>
    z.string().transform((s) => (s.length > max ? s.slice(0, max) : s));

// Clamp a number into [min, max] (truncate-tolerant for layout coords / order).
const clampInt = (min, max) =>
    z.number().transform((n) => {
        const v = Number.isFinite(n) ? Math.trunc(n) : min;
        return Math.min(Math.max(v, min), max);
    });

const layoutShape = z.object({
    x: clampInt(0, 100).optional(),
    y: clampInt(0, 500).optional(),
    w: clampInt(1, 12).optional(),
    h: clampInt(1, 20).optional(),
    minW: clampInt(1, 12).optional(),
    minH: clampInt(1, 20).optional(),
});

// Auto-fetched OG metadata for link blocks. URLs/text are further sanitized in the
// controller (sanitizeLinkMetadata) - kept permissive here so empty strings pass.
const linkMetadataShape = z.object({
    meta_title: boundedString(200).optional(),
    meta_description: boundedString(500).optional(),
    meta_image: boundedString(2000).optional(),
    favicon: boundedString(2000).optional(),
});

// --- Per-type block variants (discriminated union on block_type) ---
// Each variant declares only the fields that type owns (mirrors BLOCK_TYPE_FIELDS in
// utils/blockHelpers.js). Default strip drops cross-type / legacy fields the client may
// still send; all content fields are optional so half-filled blocks never fail; strings
// truncate instead of rejecting. This is the controlled, no-recurring-400s schema.
const blockBase = {
    _id: mongoId.optional(),
    order: clampInt(0, 9999).optional(),
    layout: layoutShape.optional(),
};
const colorFields = {
    background_color: boundedString(20).optional(),
    text_color: boundedString(20).optional(),
};
const socialFields = {
    name: boundedString(200).optional(),
    role: boundedString(100).optional(),
    url: boundedString(2000).optional(),
};
const mkBlock = (type, fields) =>
    z.object({ ...blockBase, block_type: z.literal(type), ...fields });

const blockShape = z.discriminatedUnion('block_type', [
    mkBlock('link', { text: boundedString(2000).optional(), url: boundedString(2000).optional(), link_metadata: linkMetadataShape.optional() }),
    mkBlock('image', { src: boundedString(2000).optional() }),
    mkBlock('text', { text: boundedString(2000).optional(), ...colorFields }),
    mkBlock('textCard', { name: boundedString(200).optional(), text: boundedString(2000).optional(), ...colorFields }),
    mkBlock('greenText', { text: boundedString(2000).optional() }),
    mkBlock('title', { text: boundedString(2000).optional() }),
    mkBlock('embed', { embed_url: boundedString(2000).optional(), embed_type: embedTypes.optional(), text: boundedString(2000).optional() }),
    mkBlock('linkedin', socialFields),
    mkBlock('github', socialFields),
    mkBlock('twitter', socialFields),
    mkBlock('instagram', socialFields),
    mkBlock('youtube', socialFields),
    mkBlock('upwork', { ...socialFields, src: boundedString(2000).optional() }),
    mkBlock('email', { name: boundedString(200).optional(), email_address: boundedString(254).optional(), url: boundedString(2000).optional() }),
    mkBlock('map', { src: boundedString(2000).optional(), location: boundedString(200).optional() }),
    mkBlock('iconCard', { src: boundedString(2000).optional(), url: boundedString(2000).optional() }),
]);

const sectionShape = z.object({
    _id: mongoId.optional(),
    title: z.string().max(100).optional(),
    order: z.number().int().min(0).optional(),
    blocks: z.array(blockShape).max(50).optional(),
}).strict();

const vibeShape = z.object({
    theme: z.string().max(30).optional(),
    font: z.string().max(50).optional(),
    radius: z.string().max(50).optional(),
}).strict();

const upsertProfileBody = z.object({
    is_published: z.boolean().optional(),
    sections: z.array(sectionShape).max(20),
    vibe: vibeShape.optional(),
    version: z.number().int().min(0).nullable().optional(),
}).strict();

const upsertSectionBody = z.object({
    section_id: mongoId.optional(),
    title: z.string().max(100).optional(),
    order: z.number().int().min(0).optional(),
}).strict();

const upsertBlockBody = z.object({
    section_id: mongoId,
    block_id: mongoId.optional(),
    block_type: blockTypes,
    size: blockSizes.optional(),
    order: z.number().int().min(0).optional(),
    title: z.string().max(200).optional(),
    subtitle: z.string().max(300).optional(),
    url: z.string().max(2000).optional(),
    icon_url: z.string().max(2000).optional(),
    image_url: z.string().max(2000).optional(),
    text_content: z.string().max(2000).optional(),
    background_color: z.string().max(20).optional(),
    text_color: z.string().max(20).optional(),
    embed_url: z.string().max(2000).optional(),
    embed_type: embedTypes.optional(),
}).strict();

const deleteSectionBody = z.object({
    section_id: mongoId,
}).strict();

const deleteBlockBody = z.object({
    section_id: mongoId,
    block_id: mongoId,
}).strict();

const reorderItem = z.object({
    _id: mongoId,
    order: z.number().int().min(0),
}).strict();

const reorderBody = z.object({
    section_id: mongoId.optional(),
    items: z.array(reorderItem).max(50),
}).strict();

const usernameParam = z.object({
    username: z.string().min(1).max(30),
});

// --- Bento Page API schemas ---

const idOrUsernameParam = z.object({
    id_or_username: z.string().min(1).max(30),
});

const bentoBlockItem = z.object({
    _id: mongoId.optional(),
    block_type: blockTypes,
    layout: layoutShape.optional(),
    title: z.string().max(200).optional(),
    subtitle: z.string().max(300).optional(),
    url: z.string().max(2000).optional(),
    icon_url: z.string().max(2000).optional(),
    image_url: z.string().max(2000).optional(),
    text_content: z.string().max(2000).optional(),
    text: z.string().max(2000).optional(),
    name: z.string().max(200).optional(),
    role: z.string().max(100).optional(),
    email_address: z.string().max(254).optional(),
    src: z.string().max(2000).optional(),
    location: z.string().max(200).optional(),
    background_color: z.string().max(20).optional(),
    text_color: z.string().max(20).optional(),
    embed_url: z.string().max(2000).optional(),
    embed_type: embedTypes.optional(),
    link_metadata: linkMetadataShape.optional(),
}).strict();

// Item update shape (id + partial updates)
// passthrough() used because itemUpdates can contain any block field.
// The controller sanitizes individual fields before saving.
// sanitizeBody middleware already strips prototype pollution keys.
const blockItemUpdate = z.object({
    id: z.string().min(1),
}).passthrough();

const blockLayoutUpdate = z.object({
    i: z.string().min(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(20),
}).strict();

const updateBentoBlocksBody = z.object({
    addedItems: z.array(bentoBlockItem).max(20).optional(),
    deletedItems: z.array(z.string()).max(50).optional(),
    itemUpdates: z.array(blockItemUpdate).max(50).optional(),
    layouts: z.array(blockLayoutUpdate).max(100).optional(),
    vibe: z.object({
        theme: z.string().max(30).optional(),
        font: z.string().max(50).optional(),
        radius: z.string().max(50).optional(),
    }).strict().optional(),
    is_published: z.boolean().optional(),
}).strict();

module.exports = {
    upsertProfileBody,
    upsertSectionBody,
    upsertBlockBody,
    deleteSectionBody,
    deleteBlockBody,
    reorderBody,
    usernameParam,
    idOrUsernameParam,
    updateBentoBlocksBody,
};
