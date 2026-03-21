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

const layoutShape = z.object({
    x: z.number().int().min(0).max(100),
    y: z.number().int().min(0).max(500),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(20),
    minW: z.number().int().min(1).max(12).optional(),
    minH: z.number().int().min(1).max(20).optional(),
}).strict();

const blockShape = z.object({
    _id: mongoId.optional(),
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
    name: z.string().max(200).optional(),
    role: z.string().max(100).optional(),
    email_address: z.string().max(254).optional(),
    src: z.string().max(2000).optional(),
    location: z.string().max(200).optional(),
    text: z.string().max(2000).optional(),
    layout: layoutShape.optional(),
}).strict();

const sectionShape = z.object({
    _id: mongoId.optional(),
    title: z.string().max(100).optional(),
    order: z.number().int().min(0).optional(),
    blocks: z.array(blockShape).max(50).optional(),
}).strict();

const upsertProfileBody = z.object({
    is_published: z.boolean().optional(),
    sections: z.array(sectionShape).max(20),
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
