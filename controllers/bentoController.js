const asyncHandler = require('express-async-handler');
const BentoProfile = require('../models/bentoProfileModel');
const User = require('../models/userModel');
const ReleasedUsername = require('../models/releasedUsernameModel');
const ActivityEvent = require('../models/activityEventModel');
const cache = require('../redisClient/cacheHelper');
const TTL = require('../redisClient/cacheTTL');
const { stripAllHtml } = require('../utils/sanitize');
const { projection } = require('../constants');
const { fetchLinkMetadata } = require('../utils/fetchLinkMetadata');

const getBentoCacheKey = (username) => cache.generateKey('bento', 'profile', username);
const getBentoPageBlocksCacheKey = (idOrUsername) => cache.generateKey('bento', 'page-blocks', idOrUsername);
const getBentoPageProfileCacheKey = (idOrUsername) => cache.generateKey('bento', 'page-profile', idOrUsername);

const invalidateBentoCache = async (userId) => {
    const user = await User.findById(userId).select('username').lean();
    const keys = [];
    if (user?.username) {
        keys.push(getBentoCacheKey(user.username));
        keys.push(getBentoPageBlocksCacheKey(user.username));
        keys.push(getBentoPageProfileCacheKey(user.username));
    }
    keys.push(getBentoPageBlocksCacheKey(userId.toString()));
    keys.push(getBentoPageProfileCacheKey(userId.toString()));
    if (keys.length) await cache.del(...keys);
};

// Reusable user resolution — extracted from getPublicProfile
const resolveUser = async (idOrUsername) => {
    const user = await User.findOne({
        access: true,
        $or: [{ _id: idOrUsername }, { username: idOrUsername }]
    }, projection).lean();

    if (user) return { user };

    // Check released username → redirect
    const released = await ReleasedUsername.findOne({ username: idOrUsername.toLowerCase() }).lean();
    if (released) {
        const newUser = await User.findById(released.releasedBy).select('username').lean();
        if (newUser?.username) {
            return { redirect: `/bento/${newUser.username}` };
        }
    }
    return { notFound: true };
};

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

        // Phase 2A: Publish validation — must have at least one section with content
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

        // Phase 2D: Optimistic locking — if version is provided, use it as a filter
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
            // Version mismatch — concurrent edit detected
            return res.status(409).json({
                status: 'Failed',
                error: 'version_conflict',
                message: 'Profile was modified in another session. Please refresh and try again.',
                data: null,
            });
        }

        await invalidateBentoCache(req.user._id);
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
        await invalidateBentoCache(req.user._id);

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
        await invalidateBentoCache(req.user._id);

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

        await invalidateBentoCache(req.user._id);

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

        await invalidateBentoCache(req.user._id);

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
        await invalidateBentoCache(req.user._id);

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

        const cacheKey = getBentoPageProfileCacheKey(id_or_username);
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

const listBentoBlocks = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;

        const cacheKey = getBentoPageBlocksCacheKey(id_or_username);
        const cached = await cache.get(cacheKey);
        if (cached) {
            const is_owner = req.user?._id?.toString() === cached._userId?.toString();
            return res.status(200).json({
                status: 'Success',
                data: { blocks: cached.blocks, vibe: cached.vibe, is_published: cached.is_published, is_owner },
                message: 'Bento blocks fetched successfully (Cached)',
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

        const profile = await BentoProfile.findOne({ user_id: user._id }).lean();

        let blocks = [];
        let vibe = profile?.vibe || { theme: 'dark', font: 'font-sans', radius: 'rounded-[1.8rem]' };
        let is_published = profile?.is_published || false;

        if (is_owner) {
            blocks = profile?.blocks || [];
        } else {
            if (!profile?.is_published) {
                return res.status(404).json({
                    status: 'Failed',
                    message: 'Bento profile not found or not published',
                    data: null,
                });
            }
            blocks = profile.published_blocks?.length ? profile.published_blocks : profile.blocks || [];
        }

        // Sort by layout position
        blocks.sort((a, b) => {
            const ay = a.layout?.y ?? 0;
            const by = b.layout?.y ?? 0;
            if (ay !== by) return ay - by;
            return (a.layout?.x ?? 0) - (b.layout?.x ?? 0);
        });

        const cacheData = { blocks, vibe, is_published, _userId: user._id.toString() };
        await cache.set(cacheKey, cacheData, TTL.BENTO_PAGE_BLOCKS);

        return res.status(200).json({
            status: 'Success',
            data: { blocks, vibe, is_published, is_owner },
            message: 'Bento blocks fetched successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to fetch bento blocks',
            data: null,
        });
    }
});

// Sanitize text fields on a block object
const sanitizeBlockTextFields = (block) => {
    const textFields = ['title', 'subtitle', 'text_content', 'text', 'name', 'role', 'location'];
    for (const field of textFields) {
        if (block[field]) {
            block[field] = stripAllHtml(block[field]);
        }
    }
    return block;
};

// Fetch and attach link metadata if block is a link type with a URL
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
            // Metadata fetch failure is non-critical
        }
    }
    return block;
};

const updateBentoBlocks = asyncHandler(async (req, res) => {
    try {
        const { id_or_username } = req.params;
        const { addedItems, deletedItems, itemUpdates, layouts, vibe, is_published } = req.body;

        // Resolve user and verify ownership
        const result = await resolveUser(id_or_username);
        if (result.notFound || result.redirect) {
            return res.status(404).json({
                status: 'Failed',
                message: 'User not found',
                data: null,
            });
        }

        const { user } = result;
        if (req.user._id.toString() !== user._id.toString()) {
            return res.status(403).json({
                status: 'Failed',
                message: 'You can only edit your own bento profile',
                data: null,
            });
        }

        // Find or create profile
        let profile = await BentoProfile.findOne({ user_id: user._id });
        if (!profile) {
            profile = await BentoProfile.create({ user_id: user._id, blocks: [], sections: [] });
        }

        // Apply operations in sequence

        // 1. Add new blocks
        if (addedItems?.length) {
            if ((profile.blocks?.length || 0) + addedItems.length > 100) {
                return res.status(400).json({
                    status: 'Failed',
                    message: 'Maximum 100 blocks allowed',
                    data: null,
                });
            }

            // Fetch link metadata in parallel (fire-and-forget pattern)
            const processedItems = await Promise.allSettled(
                addedItems.map(async (item) => {
                    const sanitized = sanitizeBlockTextFields({ ...item });
                    return attachLinkMetadata(sanitized);
                })
            );

            for (const result of processedItems) {
                if (result.status === 'fulfilled') {
                    profile.blocks.push(result.value);
                }
            }
        }

        // 2. Delete blocks
        if (deletedItems?.length) {
            profile.blocks = profile.blocks.filter(
                (b) => !deletedItems.includes(b._id.toString())
            );
        }

        // 3. Apply layout updates
        if (layouts?.length) {
            for (const layoutUpdate of layouts) {
                const block = profile.blocks.find(
                    (b) => b._id.toString() === layoutUpdate.i
                );
                if (block) {
                    if (!block.layout) {
                        block.layout = { x: 0, y: 0, w: 4, h: 3, minW: 1, minH: 1 };
                    }
                    block.layout.x = layoutUpdate.x;
                    block.layout.y = layoutUpdate.y;
                    block.layout.w = layoutUpdate.w;
                    block.layout.h = layoutUpdate.h;
                }
            }
        }

        // 4. Apply item updates
        if (itemUpdates?.length) {
            const metadataFetches = [];

            for (const update of itemUpdates) {
                const { id, ...updates } = update;
                const block = profile.blocks.find(
                    (b) => b._id.toString() === id
                );
                if (!block) continue;

                // Check if URL changed on a link block
                const urlChanged = block.block_type === 'link' && updates.url && updates.url !== block.url;

                // Sanitize text fields in updates
                sanitizeBlockTextFields(updates);

                // Merge updates
                for (const [key, value] of Object.entries(updates)) {
                    block[key] = value;
                }

                // Re-fetch metadata if URL changed
                if (urlChanged) {
                    metadataFetches.push(attachLinkMetadata(block));
                }
            }

            if (metadataFetches.length) {
                await Promise.allSettled(metadataFetches);
            }
        }

        // 5. Update vibe
        if (vibe) {
            if (!profile.vibe) {
                profile.vibe = { theme: 'dark', font: 'font-sans', radius: 'rounded-[1.8rem]' };
            }
            if (vibe.theme !== undefined) profile.vibe.theme = vibe.theme;
            if (vibe.font !== undefined) profile.vibe.font = vibe.font;
            if (vibe.radius !== undefined) profile.vibe.radius = vibe.radius;
        }

        // 6. Publish
        if (is_published === true) {
            profile.published_blocks = [...profile.blocks];
            profile.is_published = true;
        }

        // Increment version and save
        profile.version = (profile.version || 0) + 1;
        await profile.save();

        // Update cache incrementally
        await updateBentoBlocksCache(user._id, user.username, {
            addedItems, deletedItems, itemUpdates, layouts, vibe,
            blocks: profile.blocks,
            is_published: profile.is_published,
            vibeData: profile.vibe,
        });

        ActivityEvent.create({ userId: user._id, eventType: 'bento_blocks_updated' }).catch(() => { });

        return res.status(200).json({
            status: 'Success',
            data: {
                blocks: profile.blocks,
                vibe: profile.vibe,
                is_published: profile.is_published,
            },
            message: 'Bento blocks updated successfully',
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to update bento blocks',
            data: null,
        });
    }
});

// Incremental Redis cache update after successful DB write
const updateBentoBlocksCache = async (userId, username, operations) => {
    try {
        const { blocks, vibeData, is_published } = operations;

        // Update blocks cache with the final state from DB
        const identifiers = [userId.toString()];
        if (username) identifiers.push(username);

        for (const id of identifiers) {
            const blocksCacheKey = getBentoPageBlocksCacheKey(id);
            const cacheData = {
                blocks: blocks || [],
                vibe: vibeData || { theme: 'dark', font: 'font-sans', radius: 'rounded-[1.8rem]' },
                is_published: is_published || false,
                _userId: userId.toString(),
            };
            await cache.set(blocksCacheKey, cacheData, TTL.BENTO_PAGE_BLOCKS);
        }

        // Invalidate profile cache (lightweight, rarely changes)
        const profileKeys = identifiers.map((id) => getBentoPageProfileCacheKey(id));
        if (profileKeys.length) await cache.del(...profileKeys);
    } catch {
        // Cache update failure is non-critical
    }
};

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
    listBentoBlocks,
    updateBentoBlocks,
};
