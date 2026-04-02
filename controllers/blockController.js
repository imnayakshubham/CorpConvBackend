const asyncHandler = require('express-async-handler');
const BlockProfile = require('../models/bentoProfileModel');
const ActivityEvent = require('../models/activityEventModel');
const cache = require('../redisClient/cacheHelper');
const TTL = require('../redisClient/cacheTTL');
const {
    getBlocksCacheKey,
    resolveUser,
    invalidateBlockCache,
    sanitizeBlockTextFields,
    attachLinkMetadata,
    extractBlockFields,
} = require('../utils/blockHelpers');

const PAGE_LIMIT_DEFAULT = 12;
const PAGE_LIMIT_MAX = 50;
const BLOCK_LIMIT = 100;

// Maps frontend field names → DB field names before saving
const mapToDbFields = (updates) => {
    const mapped = { ...updates };
    if ('bgColor' in mapped) { mapped.background_color = mapped.bgColor; delete mapped.bgColor; }
    if ('textColor' in mapped) { mapped.text_color = mapped.textColor; delete mapped.textColor; }
    if ('email' in mapped) { mapped.email_address = mapped.email; delete mapped.email; }
    // Never allow overwriting these from client input
    delete mapped.block_id;
    delete mapped._id;
    delete mapped.id;
    return mapped;
};

// GET /:id_or_username/list
const listBlocks = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(PAGE_LIMIT_MAX, parseInt(req.query.limit) || PAGE_LIMIT_DEFAULT));
        const skip = (page - 1) * limit;

        const result = await resolveUser(id_or_username);
        if (result.redirect) {
            return res.status(301).json({ status: 'Redirect', redirect_to: result.redirect });
        }
        if (result.notFound) {
            return res.status(404).json({ status: 'Failed', message: 'User not found', data: null });
        }

        const { user } = result;
        const is_owner = req.user?._id?.toString() === user._id.toString();

        let allBlocks;
        let vibe = { theme: 'dark', font: 'font-sans', radius: 'rounded-[1.8rem]' };
        let is_published = false;

        if (is_owner) {
            // Owner always gets fresh data — no cache
            const profile = await BlockProfile.findOne({ user_id: user._id }).lean();
            allBlocks = profile?.blocks || [];
            vibe = profile?.vibe || vibe;
            is_published = profile?.is_published || false;
        } else {
            // Non-owner: try cache first
            const cacheKey = getBlocksCacheKey(id_or_username);
            const cached = await cache.get(cacheKey);
            if (cached) {
                allBlocks = cached.blocks || [];
                vibe = cached.vibe || vibe;
                is_published = cached.is_published || false;
                if (!is_published) {
                    return res.status(404).json({
                        status: 'Failed',
                        message: 'Profile not published',
                        data: null,
                    });
                }
            } else {
                const profile = await BlockProfile.findOne({ user_id: user._id }).lean();
                is_published = profile?.is_published || false;
                if (!is_published) {
                    return res.status(404).json({
                        status: 'Failed',
                        message: 'Profile not published',
                        data: null,
                    });
                }
                allBlocks = profile?.published_blocks?.length
                    ? profile.published_blocks
                    : profile?.blocks || [];
                vibe = profile?.vibe || vibe;

                // Cache the published state for non-owners
                await cache.set(cacheKey, { blocks: allBlocks, vibe, is_published }, TTL.BENTO_PAGE_BLOCKS);
            }
        }

        // Sort by layout position (top-to-bottom, left-to-right)
        allBlocks.sort((a, b) => {
            const ay = a.layout?.y ?? 0, by = b.layout?.y ?? 0;
            if (ay !== by) return ay - by;
            return (a.layout?.x ?? 0) - (b.layout?.x ?? 0);
        });

        // Apply type-based field projection
        const projectedBlocks = allBlocks.map(extractBlockFields);

        // Paginate
        const total = projectedBlocks.length;
        const blocks = projectedBlocks.slice(skip, skip + limit);

        return res.status(200).json({
            status: 'Success',
            data: {
                blocks,
                vibe,
                is_published,
                is_owner,
                pagination: { total, page, limit, hasMore: skip + limit < total },
            },
            message: 'Blocks fetched successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to fetch blocks', data: null });
    }
});

// POST /:id_or_username/add
const addBlock = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;
        const result = await resolveUser(id_or_username);
        if (result.notFound || result.redirect) {
            return res.status(404).json({ status: 'Failed', message: 'User not found', data: null });
        }

        const { user } = result;
        if (req.user._id.toString() !== user._id.toString()) {
            return res.status(403).json({ status: 'Failed', message: 'You can only edit your own profile', data: null });
        }

        let profile = await BlockProfile.findOne({ user_id: user._id });
        if (!profile) {
            profile = await BlockProfile.create({ user_id: user._id, blocks: [] });
        }

        if ((profile.blocks?.length || 0) >= BLOCK_LIMIT) {
            return res.status(400).json({ status: 'Failed', message: `Maximum ${BLOCK_LIMIT} blocks allowed`, data: null });
        }

        const { layout, block_type, ...rest } = req.body;
        const newBlock = mapToDbFields({ block_type, ...rest });
        newBlock.block_type = block_type;
        if (layout) newBlock.layout = layout;

        // If sentinel y was used (y: 9999), compute actual bottom of existing blocks
        if (newBlock.layout && newBlock.layout.y >= 9999) {
            const maxY = profile.blocks.reduce((max, b) => {
                const bottom = (b.layout?.y ?? 0) + (b.layout?.h ?? 1);
                return Math.max(max, bottom);
            }, 0);
            newBlock.layout.y = maxY;
        }

        sanitizeBlockTextFields(newBlock);
        await attachLinkMetadata(newBlock);

        profile.blocks.push(newBlock);
        profile.version = (profile.version || 0) + 1;
        await profile.save();

        const savedBlock = profile.blocks[profile.blocks.length - 1];

        await invalidateBlockCache(user._id);
        ActivityEvent.create({ userId: user._id, eventType: 'block_added' }).catch(() => { });

        return res.status(201).json({
            status: 'Success',
            data: { block: extractBlockFields(savedBlock) },
            message: 'Block added successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to add block', data: null });
    }
});

// PATCH /:id_or_username/update
const updateBlock = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;
        const { block_id, ...rawUpdates } = req.body;

        const result = await resolveUser(id_or_username);
        if (result.notFound || result.redirect) {
            return res.status(404).json({ status: 'Failed', message: 'User not found', data: null });
        }

        const { user } = result;
        if (req.user._id.toString() !== user._id.toString()) {
            return res.status(403).json({ status: 'Failed', message: 'You can only edit your own profile', data: null });
        }

        const profile = await BlockProfile.findOne({ user_id: user._id });
        if (!profile) {
            return res.status(404).json({ status: 'Failed', message: 'Profile not found', data: null });
        }

        const block = profile.blocks.id(block_id);
        if (!block) {
            return res.status(404).json({ status: 'Failed', message: 'Block not found', data: null });
        }

        const updates = mapToDbFields(rawUpdates);
        const urlChanged = block.block_type === 'link' && updates.url && updates.url !== block.url;

        sanitizeBlockTextFields(updates);
        Object.assign(block, updates);

        if (urlChanged) await attachLinkMetadata(block);

        profile.version = (profile.version || 0) + 1;
        await profile.save();

        await invalidateBlockCache(user._id);

        return res.status(200).json({
            status: 'Success',
            data: { block: extractBlockFields(block) },
            message: 'Block updated successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to update block', data: null });
    }
});

// DELETE /:id_or_username/delete
const deleteBlock = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;
        const { block_id } = req.body;

        const result = await resolveUser(id_or_username);
        if (result.notFound || result.redirect) {
            return res.status(404).json({ status: 'Failed', message: 'User not found', data: null });
        }

        const { user } = result;
        if (req.user._id.toString() !== user._id.toString()) {
            return res.status(403).json({ status: 'Failed', message: 'You can only edit your own profile', data: null });
        }

        const profile = await BlockProfile.findOneAndUpdate(
            { user_id: user._id },
            { $pull: { blocks: { _id: block_id } }, $inc: { version: 1 } },
            { new: true }
        );

        if (!profile) {
            return res.status(404).json({ status: 'Failed', message: 'Profile not found', data: null });
        }

        await invalidateBlockCache(user._id);

        return res.status(200).json({
            status: 'Success',
            data: null,
            message: 'Block deleted successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to delete block', data: null });
    }
});

// PATCH /:id_or_username/layout
const updateLayout = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;
        const { layouts } = req.body;

        const result = await resolveUser(id_or_username);
        if (result.notFound || result.redirect) {
            return res.status(404).json({ status: 'Failed', message: 'User not found', data: null });
        }

        const { user } = result;
        if (req.user._id.toString() !== user._id.toString()) {
            return res.status(403).json({ status: 'Failed', message: 'You can only edit your own profile', data: null });
        }

        const profile = await BlockProfile.findOne({ user_id: user._id });
        if (!profile) {
            return res.status(404).json({ status: 'Failed', message: 'Profile not found', data: null });
        }

        for (const layoutUpdate of layouts) {
            const block = profile.blocks.find((b) => b._id.toString() === layoutUpdate.i);
            if (block) {
                if (!block.layout) block.layout = { x: 0, y: 0, w: 4, h: 3, minW: 1, minH: 1 };
                block.layout.x = layoutUpdate.x;
                block.layout.y = layoutUpdate.y;
                block.layout.w = layoutUpdate.w;
                block.layout.h = layoutUpdate.h;
            }
        }

        profile.version = (profile.version || 0) + 1;
        await profile.save();

        // Re-warm cache with updated block list
        await invalidateBlockCache(user._id);

        return res.status(200).json({
            status: 'Success',
            data: null,
            message: 'Layout saved successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to save layout', data: null });
    }
});

// PATCH /:id_or_username/vibe
const updateVibe = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;
        const { vibe } = req.body;

        const result = await resolveUser(id_or_username);
        if (result.notFound || result.redirect) {
            return res.status(404).json({ status: 'Failed', message: 'User not found', data: null });
        }

        const { user } = result;
        if (req.user._id.toString() !== user._id.toString()) {
            return res.status(403).json({ status: 'Failed', message: 'You can only edit your own profile', data: null });
        }

        const updateFields = {};
        if (vibe.theme !== undefined) updateFields['vibe.theme'] = vibe.theme;
        if (vibe.font !== undefined) updateFields['vibe.font'] = vibe.font;
        if (vibe.radius !== undefined) updateFields['vibe.radius'] = vibe.radius;

        const profile = await BlockProfile.findOneAndUpdate(
            { user_id: user._id },
            { $set: updateFields, $inc: { version: 1 } },
            { new: true, upsert: true }
        );

        await invalidateBlockCache(user._id);

        return res.status(200).json({
            status: 'Success',
            data: { vibe: profile.vibe },
            message: 'Vibe updated successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to update vibe', data: null });
    }
});

// PATCH /:id_or_username/publish
const publishBlocks = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;
        const { is_published } = req.body;

        const result = await resolveUser(id_or_username);
        if (result.notFound || result.redirect) {
            return res.status(404).json({ status: 'Failed', message: 'User not found', data: null });
        }

        const { user } = result;
        if (req.user._id.toString() !== user._id.toString()) {
            return res.status(403).json({ status: 'Failed', message: 'You can only edit your own profile', data: null });
        }

        const profile = await BlockProfile.findOne({ user_id: user._id });
        if (!profile) {
            return res.status(404).json({ status: 'Failed', message: 'Profile not found', data: null });
        }

        if (is_published) {
            profile.published_blocks = [...profile.blocks];
            profile.is_published = true;
        } else {
            profile.is_published = false;
        }
        profile.version = (profile.version || 0) + 1;
        await profile.save();

        await invalidateBlockCache(user._id);
        ActivityEvent.create({ userId: user._id, eventType: 'block_profile_published' }).catch(() => { });

        return res.status(200).json({
            status: 'Success',
            data: { is_published: profile.is_published },
            message: is_published ? 'Profile published successfully' : 'Profile unpublished',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to publish profile', data: null });
    }
});

module.exports = {
    listBlocks,
    addBlock,
    updateBlock,
    deleteBlock,
    updateLayout,
    updateVibe,
    publishBlocks,
};
