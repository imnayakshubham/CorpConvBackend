const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const blockTypes = z.enum([
    'link', 'image', 'text', 'embed',
    'title', 'textCard', 'linkedin', 'github', 'twitter',
    'instagram', 'youtube', 'email', 'greenText', 'upwork',
    'iconCard', 'map',
]);

const layoutShape = z.object({
    x: z.number().int().min(0).max(100),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(20),
    minW: z.number().int().min(1).max(12).optional(),
    minH: z.number().int().min(1).max(20).optional(),
}).strict();

const idOrUsernameParam = z.object({
    id_or_username: z.string().min(1).max(50),
});

// Fields accepted use frontend naming (bgColor, textColor, email) where they differ from DB
const blockWriteFields = {
    block_type: blockTypes,
    layout: layoutShape.optional(),
    text: z.string().max(2000).optional(),
    url: z.string().max(2000).optional(),
    src: z.string().max(2000).optional(),
    location: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    role: z.string().max(100).optional(),
    email: z.string().email().max(254).optional(),
    bgColor: z.string().max(20).optional(),
    textColor: z.string().max(20).optional(),
    embed_url: z.string().max(2000).optional(),
    embed_type: z.enum(['youtube', 'spotify', 'twitter', 'other', '']).optional(),
    title: z.string().max(200).optional(),
    text_content: z.string().max(2000).optional(),
    icon_url: z.string().max(2000).optional(),
    image_url: z.string().max(2000).optional(),
};

const addBlockBody = z.object({
    ...blockWriteFields,
    block_type: blockTypes, // required for add
}).strict();

const updateBlockBody = z.object({
    block_id: mongoId,
    text: z.string().max(2000).optional(),
    url: z.string().max(2000).optional(),
    src: z.string().max(2000).optional(),
    location: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    role: z.string().max(100).optional(),
    email: z.string().email().max(254).optional(),
    bgColor: z.string().max(20).optional(),
    textColor: z.string().max(20).optional(),
    embed_url: z.string().max(2000).optional(),
    embed_type: z.enum(['youtube', 'spotify', 'twitter', 'other', '']).optional(),
    title: z.string().max(200).optional(),
    text_content: z.string().max(2000).optional(),
    icon_url: z.string().max(2000).optional(),
    image_url: z.string().max(2000).optional(),
    link_metadata: z.object({
        meta_title:       z.string().max(200).optional(),
        meta_description: z.string().max(500).optional(),
        meta_image:       z.string().max(2000).optional(),
        favicon:          z.string().max(2000).optional(),
    }).optional(),
}).strict();

const deleteBlockBody = z.object({
    block_id: mongoId,
}).strict();

const blockLayoutUpdate = z.object({
    i: z.string().min(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(20),
}).strict();

const layoutsBody = z.object({
    layouts: z.array(blockLayoutUpdate).min(1).max(100),
}).strict();

const vibeBody = z.object({
    vibe: z.object({
        theme: z.string().max(30).optional(),
        font: z.string().max(50).optional(),
        radius: z.string().max(50).optional(),
    }).strict(),
}).strict();

const publishBody = z.object({
    is_published: z.boolean(),
}).strict();

module.exports = {
    idOrUsernameParam,
    addBlockBody,
    updateBlockBody,
    deleteBlockBody,
    layoutsBody,
    vibeBody,
    publishBody,
};
