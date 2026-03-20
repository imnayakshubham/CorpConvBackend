const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const blockTypes = z.enum(['link', 'image', 'text', 'embed']);
const blockSizes = z.enum(['small', 'medium', 'large']);
const embedTypes = z.enum(['youtube', 'spotify', 'twitter', 'other', '']);

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

module.exports = {
    upsertProfileBody,
    upsertSectionBody,
    upsertBlockBody,
    deleteSectionBody,
    deleteBlockBody,
    reorderBody,
    usernameParam,
};
