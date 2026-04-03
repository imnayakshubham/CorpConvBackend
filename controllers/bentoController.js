const asyncHandler = require('express-async-handler');
const BentoProfile = require('../models/bentoProfileModel');
const User = require('../models/userModel');
const ActivityEvent = require('../models/activityEventModel');
const cache = require('../redisClient/cacheHelper');
const TTL = require('../redisClient/cacheTTL');
const { stripAllHtml } = require('../utils/sanitize');
const {
    getBlockProfileCacheKey,
    invalidateBlockCache,
    resolveUser,
    sanitizeBlockTextFields,
    attachLinkMetadata,
} = require('../utils/blockHelpers');

const getBentoCacheKey = (username) => cache.generateKey('bento', 'profile', username);

const getPublicProfile = asyncHandler(async (req, res) => {
    try {
        const { username } = req.params;

        const cacheKey = getBentoCacheKey(username);
        const cached = await cache.get(cacheKey);
        if (cached) {
            return res.status(200).json({
                status: 'Success',
                data: cached,
                message: 'Bento profile fetched successfully (Cached)',
            });
        }

        const result = await resolveUser(username);

        if (result.redirect) {
            return res.status(301).json({
                status: 'Redirect',
                redirect_to: result.redirect,
                message: 'Username changed, redirecting to new profile',
            });
        }

        if (result.notFound) {
            return res.status(404).json({
                status: 'Failed',
                message: 'User not found',
                data: null,
            });
        }

        const { user } = result;

        const profile = await BentoProfile.findOne({
            user_id: user._id,
            is_published: true,
        }).lean();

        if (!profile) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Bento profile not found or not published',
                data: null,
            });
        }

        // Use published_sections for public view, fall back to sections for backward compatibility
        const publicSections = profile.published_sections?.length
            ? profile.published_sections
            : profile.sections;

        // Sort sections and blocks by order
        if (publicSections) {
            publicSections.sort((a, b) => a.order - b.order);
            publicSections.forEach((section) => {
                if (section.blocks) {
                    section.blocks.sort((a, b) => a.order - b.order);
                }
            });
        }

        const responseData = {
            user,
            profile: { ...profile, sections: publicSections },
        };
        await cache.set(cacheKey, responseData, TTL.BENTO_PROFILE);

        return res.status(200).json({
            status: 'Success',
            data: responseData,
            message: 'Bento profile fetched successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to fetch bento profile',
            data: null,
        });
    }
});

const getMyProfile = asyncHandler(async (req, res) => {
    try {
        const profile = await BentoProfile.findOne({ user_id: req.user._id }).lean();

        return res.status(200).json({
            status: 'Success',
            data: profile,
            message: profile
                ? 'Bento profile fetched successfully'
                : 'No bento profile yet',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to fetch bento profile',
            data: null,
        });
    }
});

const upsertProfile = asyncHandler(async (req, res) => {
    try {
        const { sections, is_published, version } = req.body;

        // Sanitize text fields in sections/blocks
        const sanitizedSections = sections.map((section, sIdx) => ({
            ...section,
            title: stripAllHtml(section.title || 'Untitled Section'),
            order: section.order ?? sIdx,
            blocks: (section.blocks || []).map((block, bIdx) => ({
                ...block,
                title: block.title ? stripAllHtml(block.title) : '',
                subtitle: block.subtitle ? stripAllHtml(block.subtitle) : '',
                text_content: block.text_content ? stripAllHtml(block.text_content) : '',
                order: block.order ?? bIdx,
            })),
        }));

        // Phase 2A: Publish validation  - must have at least one section with content
        if (is_published) {
            const hasContent = sanitizedSections.some(
                (section) => section.blocks && section.blocks.length > 0
            );
            if (!sanitizedSections.length || !hasContent) {
                return res.status(400).json({
                    status: 'Failed',
                    error: 'publish_validation',
                    message: 'Profile must have at least one section with content',
                    data: null,
                });
            }
        }

        // Build the update object based on save type
        const updateSet = {
            sections: sanitizedSections,
        };

        if (is_published) {
            // Publishing: update both draft and live, set published flag
            updateSet.published_sections = sanitizedSections;
            updateSet.is_published = true;
        } else if (is_published === false) {
            // Explicit draft save: only update draft sections, don't touch published state
            // Leave is_published and published_sections untouched
        }

        // Phase 2D: Optimistic locking  - if version is provided, use it as a filter
        const filter = { user_id: req.user._id };
        if (version !== undefined && version !== null) {
            filter.version = version;
        }

        const profile = await BentoProfile.findOneAndUpdate(
            filter,
            {
                $set: updateSet,
                $inc: { version: 1 },
            },
            { new: true, upsert: version === undefined || version === null }
        );

        if (!profile) {
            // Version mismatch  - concurrent edit detected
            return res.status(409).json({
                status: 'Failed',
                error: 'version_conflict',
                message: 'Profile was modified in another session. Please refresh and try again.',
                data: null,
            });
        }

        await invalidateBlockCache(req.user._id);
        ActivityEvent.create({ userId: req.user._id, eventType: 'bento_profile_updated' }).catch(() => { });

        return res.status(200).json({
            status: 'Success',
            data: profile,
            message: 'Bento profile saved successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to save bento profile',
            data: null,
        });
    }
});

const upsertSection = asyncHandler(async (req, res) => {
    try {
        const { section_id, title, order } = req.body;

        let profile = await BentoProfile.findOne({ user_id: req.user._id });
        if (!profile) {
            profile = await BentoProfile.create({ user_id: req.user._id, sections: [] });
        }

        if (section_id) {
            const section = profile.sections.id(section_id);
            if (!section) {
                return res.status(404).json({ status: 'Failed', message: 'Section not found', data: null });
            }
            if (title !== undefined) section.title = stripAllHtml(title);
            if (order !== undefined) section.order = order;
        } else {
            const newOrder = order ?? profile.sections.length;
            profile.sections.push({
                title: stripAllHtml(title || 'Untitled Section'),
                order: newOrder,
                blocks: [],
            });
        }

        await profile.save();
        await invalidateBlockCache(req.user._id);

        return res.status(200).json({
            status: 'Success',
            data: profile,
            message: 'Section saved successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to save section', data: null });
    }
});

const upsertBlock = asyncHandler(async (req, res) => {
    try {
        const { section_id, block_id, ...blockData } = req.body;

        const profile = await BentoProfile.findOne({ user_id: req.user._id });
        if (!profile) {
            return res.status(404).json({ status: 'Failed', message: 'Profile not found', data: null });
        }

        const section = profile.sections.id(section_id);
        if (!section) {
            return res.status(404).json({ status: 'Failed', message: 'Section not found', data: null });
        }

        // Sanitize text fields
        if (blockData.title) blockData.title = stripAllHtml(blockData.title);
        if (blockData.subtitle) blockData.subtitle = stripAllHtml(blockData.subtitle);
        if (blockData.text_content) blockData.text_content = stripAllHtml(blockData.text_content);

        if (block_id) {
            const block = section.blocks.id(block_id);
            if (!block) {
                return res.status(404).json({ status: 'Failed', message: 'Block not found', data: null });
            }
            Object.assign(block, blockData);
        } else {
            blockData.order = blockData.order ?? section.blocks.length;
            section.blocks.push(blockData);
        }

        await profile.save();
        await invalidateBlockCache(req.user._id);

        return res.status(200).json({
            status: 'Success',
            data: profile,
            message: 'Block saved successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to save block', data: null });
    }
});

const deleteSection = asyncHandler(async (req, res) => {
    try {
        const { section_id } = req.body;

        const profile = await BentoProfile.findOneAndUpdate(
            { user_id: req.user._id },
            { $pull: { sections: { _id: section_id } } },
            { new: true }
        );

        if (!profile) {
            return res.status(404).json({ status: 'Failed', message: 'Profile not found', data: null });
        }

        await invalidateBlockCache(req.user._id);

        return res.status(200).json({
            status: 'Success',
            data: profile,
            message: 'Section deleted successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to delete section', data: null });
    }
});

const deleteBlock = asyncHandler(async (req, res) => {
    try {
        const { section_id, block_id } = req.body;

        const profile = await BentoProfile.findOneAndUpdate(
            { user_id: req.user._id, 'sections._id': section_id },
            { $pull: { 'sections.$.blocks': { _id: block_id } } },
            { new: true }
        );

        if (!profile) {
            return res.status(404).json({ status: 'Failed', message: 'Profile or section not found', data: null });
        }

        await invalidateBlockCache(req.user._id);

        return res.status(200).json({
            status: 'Success',
            data: profile,
            message: 'Block deleted successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to delete block', data: null });
    }
});

const reorderItems = asyncHandler(async (req, res) => {
    try {
        const { section_id, items } = req.body;

        const profile = await BentoProfile.findOne({ user_id: req.user._id });
        if (!profile) {
            return res.status(404).json({ status: 'Failed', message: 'Profile not found', data: null });
        }

        if (section_id) {
            // Reorder blocks within a section
            const section = profile.sections.id(section_id);
            if (!section) {
                return res.status(404).json({ status: 'Failed', message: 'Section not found', data: null });
            }
            for (const item of items) {
                const block = section.blocks.id(item._id);
                if (block) block.order = item.order;
            }
        } else {
            // Reorder sections
            for (const item of items) {
                const section = profile.sections.id(item._id);
                if (section) section.order = item.order;
            }
        }

        await profile.save();
        await invalidateBlockCache(req.user._id);

        return res.status(200).json({
            status: 'Success',
            data: profile,
            message: 'Reorder saved successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({ status: 'Failed', message: 'Failed to reorder', data: null });
    }
});

// --- Bento Page API ---

const getBentoPageProfile = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;

        const cacheKey = getBlockProfileCacheKey(id_or_username);
        const cached = await cache.get(cacheKey);
        if (cached) {
            const is_owner = req.user?._id?.toString() === cached.user?._id?.toString();
            return res.status(200).json({
                status: 'Success',
                data: { ...cached, is_owner },
                message: 'Bento page profile fetched successfully (Cached)',
            });
        }

        const result = await resolveUser(id_or_username);

        if (result.redirect) {
            return res.status(301).json({
                status: 'Redirect',
                redirect_to: result.redirect,
                message: 'Username changed, redirecting to new profile',
            });
        }

        if (result.notFound) {
            return res.status(404).json({
                status: 'Failed',
                message: 'User not found',
                data: null,
            });
        }

        const { user } = result;
        const is_owner = req.user?._id?.toString() === user._id.toString();

        const responseData = { user };
        await cache.set(cacheKey, responseData, TTL.BENTO_PAGE_PROFILE);

        return res.status(200).json({
            status: 'Success',
            data: { ...responseData, is_owner },
            message: 'Bento page profile fetched successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to fetch bento page profile',
            data: null,
        });
    }
});


module.exports = {
    getPublicProfile,
    getMyProfile,
    upsertProfile,
    upsertSection,
    upsertBlock,
    deleteSection,
    deleteBlock,
    reorderItems,
    getBentoPageProfile,
};
