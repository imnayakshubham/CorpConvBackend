const asyncHandler = require('express-async-handler');
const Link = require('../models/linkModel');
const Category = require('../models/categoryModel');
const Click = require('../models/clickModel');
const Referral = require('../models/referralModel');
const { getIo } = require('../utils/socketManger');
const axios = require("axios");
const { load } = require("cheerio");
const { isVerifiedSource, randomIdGenerator } = require('../utils/utils');
const cache = require('../redisClient/cacheHelper');
const TTL = require('../redisClient/cacheTTL');

// --- Link cache helpers ---

// Get all cache keys that may contain a given link
const getLinkCacheKeys = (ownerId, category) => {
    const keys = [
        cache.generateKey('links', 'all'),
        cache.generateKey('links', 'user', ownerId, 'all'),
    ];
    if (category) {
        keys.push(cache.generateKey('links', 'user', ownerId, category));
        keys.push(cache.generateKey('links', 'category', category));
    }
    return keys;
};

// Add a link to the front of each cached list
const addLinkToCacheLists = async (keys, link) => {
    await Promise.all(keys.map(async (key) => {
        const data = await cache.get(key);
        if (data && Array.isArray(data)) {
            data.unshift(link);
            await cache.set(key, data, TTL.LINKS_LIST);
        }
    }));
};

// Replace a link in each cached list
const updateLinkInCacheLists = async (keys, updatedLink) => {
    await Promise.all(keys.map(async (key) => {
        const data = await cache.get(key);
        if (data && Array.isArray(data)) {
            const index = data.findIndex(l => l._id.toString() === updatedLink._id.toString());
            if (index !== -1) {
                data[index] = updatedLink;
                await cache.set(key, data, TTL.LINKS_LIST);
            }
        }
    }));
};

// Remove a link from each cached list
const removeLinkFromCacheLists = async (keys, linkId) => {
    await Promise.all(keys.map(async (key) => {
        const data = await cache.get(key);
        if (data && Array.isArray(data)) {
            const filtered = data.filter(l => l._id.toString() !== linkId.toString());
            if (filtered.length !== data.length) {
                await cache.set(key, filtered, TTL.LINKS_LIST);
            }
        }
    }));
};

// Add a category to the categories cache if not already present
const addCategoryToCache = async (category) => {
    if (!category) return;
    const key = cache.generateKey('links', 'categories');
    const data = await cache.get(key);
    if (data && Array.isArray(data)) {
        if (!data.some(c => c.toLowerCase() === category.toLowerCase())) {
            data.push(category);
            data.sort();
            await cache.set(key, data, TTL.LINK_CATEGORIES);
        }
    }
};

// Predefined categories
const PREDEFINED_CATEGORIES = [
    'jobs', 'learning', 'tools', 'resources', 'news',
    'tutorial', 'article', 'video', 'open_source', 'other'
];

// URL Validation
const validateUrl = (url) => {
    if (!url || typeof url !== 'string') {
        throw new Error('URL is required');
    }

    const trimmedUrl = url.trim();

    // Check for dangerous protocols
    if (/^(javascript|data|vbscript|file):/i.test(trimmedUrl)) {
        throw new Error('Blocked protocol');
    }

    // Basic URL format validation
    try {
        const urlObj = new URL(trimmedUrl);
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
            throw new Error('Only HTTP and HTTPS protocols are allowed');
        }
    } catch (e) {
        throw new Error('Invalid URL format');
    }

    return trimmedUrl;
};

// Category Validation
const validateCategory = (category) => {
    if (!category || typeof category !== 'string') {
        throw new Error('Category is required');
    }

    const sanitized = category
        .replace(/<[^>]*>/g, '')  // Strip HTML
        .replace(/[<>'"&]/g, '')  // Remove dangerous chars
        .trim()
        .substring(0, 50);

    if (sanitized.length < 2) {
        throw new Error('Category must be at least 2 characters');
    }

    return sanitized;
};

// Sanitize metadata to prevent XSS
const sanitizeMetadata = (data) => {
    const stripHtml = (str) => (str || '').replace(/<[^>]*>/g, '').trim();

    const isValidUrl = (url) => {
        if (!url) return false;
        try {
            const urlObj = new URL(url);
            return ['http:', 'https:'].includes(urlObj.protocol);
        } catch {
            return false;
        }
    };

    return {
        url: data.url,
        title: stripHtml(data.title).substring(0, 200),
        description: stripHtml(data.description).substring(0, 500),
        image: isValidUrl(data.image) ? data.image : null,
        favicon: isValidUrl(data.favicon) ? data.favicon : null,
        author: stripHtml(data.author).substring(0, 100)
    };
};

// Fetch and parse link metadata
const fetchLinkMetadata = async (url) => {
    try {
        const { data } = await axios.get(url, {
            timeout: 10000,
            maxRedirects: 5,
            maxContentLength: 5 * 1024 * 1024,
            headers: { 'User-Agent': 'HushworkBot/1.0' }
        });

        const $ = load(data);

        const getMetaTag = (name) => {
            return (
                $(`meta[name=${name}]`).attr("content") ||
                $(`meta[property="twitter:${name}"]`).attr("content") ||
                $(`meta[property="og:${name}"]`).attr("content")
            );
        };

        const rawMetadata = {
            url: url,
            title: $("title").first().text(),
            favicon:
                $('link[rel="shortcut icon"]').attr("href") ||
                $('link[rel="alternate icon"]').attr("href") ||
                $('link[rel="icon"]').attr("href"),
            description: getMetaTag("description"),
            image: getMetaTag("image"),
            author: getMetaTag("author"),
        };

        // Make favicon URL absolute if it's relative
        if (rawMetadata.favicon && !rawMetadata.favicon.startsWith('http')) {
            const urlObj = new URL(url);
            rawMetadata.favicon = rawMetadata.favicon.startsWith('/')
                ? `${urlObj.protocol}//${urlObj.host}${rawMetadata.favicon}`
                : `${urlObj.protocol}//${urlObj.host}/${rawMetadata.favicon}`;
        }

        return sanitizeMetadata(rawMetadata);
    } catch (error) {
        // Return minimal metadata if fetch fails
        return sanitizeMetadata({ url, title: '', description: '', image: null, favicon: null, author: '' });
    }
};

const createLink = asyncHandler(async (req, res) => {
    try {
        const { url, category } = req.body;

        // Validate URL
        const validatedUrl = validateUrl(url);

        // Validate category
        const validatedCategory = validateCategory(category);

        // Check if link already exists
        const linkAlreadyExists = await Link.findOne({ "link_data.url": validatedUrl });

        if (linkAlreadyExists) {
            return res.status(400).json({
                status: 'Failed',
                message: "Link already exists",
                data: null
            });
        }

        const linkPayload = {
            link_data: await fetchLinkMetadata(validatedUrl),
            posted_by: req.user._id,
            is_verified_source: isVerifiedSource(validatedUrl),
            category: validatedCategory
        };

        const link = await Link.create(linkPayload);

        // Ensure category is tracked in the separate collection
        if (validatedCategory) {
            await Category.findOneAndUpdate(
                { name: validatedCategory.toLowerCase() },
                {
                    $setOnInsert: {
                        name: validatedCategory.toLowerCase(),
                        display_name: validatedCategory,
                        created_by: req.user._id,
                        source: 'links'
                    }
                },
                { upsert: true }
            );
        }

        const linkData = await link.populate("posted_by", "public_user_name is_email_verified avatar_config");

        // Update caches — add new link to all relevant cached lists
        const cacheKeys = getLinkCacheKeys(req.user._id, validatedCategory);
        await Promise.all([
            addLinkToCacheLists(cacheKeys, linkData),
            addCategoryToCache(validatedCategory),
        ]);

        if (linkData) {
            const io = getIo();
            io.emit('listen_link_creation', linkData);

            return res.status(201).json({
                status: 'Success',
                data: linkData,
                message: "Link created successfully"
            });
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Link not created",
                data: null
            });
        }
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: error.message || "Link not created"
        });
    }
});

const fetchLinks = asyncHandler(async (req, res) => {
    try {
        const { user_id, category } = req.query;
        let query = { access: true };

        if (user_id) {
            query.posted_by = user_id;
        }

        if (category) {
            query.category = category;
        }

        // Generate cache key based on query params
        const cacheKey = user_id
            ? cache.generateKey('links', 'user', user_id, category || 'all')
            : category
                ? cache.generateKey('links', 'category', category)
                : cache.generateKey('links', 'all');

        const cachedData = await cache.get(cacheKey);

        if (cachedData) {
            return res.status(200).json({
                status: 'Success',
                data: cachedData,
                message: "Links fetched successfully (Cached)"
            });
        }

        const links = await Link.find(query)
            .sort({ updatedAt: -1 })
            .populate('posted_by', 'public_user_name is_email_verified avatar_config');

        // Cache the result
        await cache.set(cacheKey, links, TTL.LINKS_LIST);

        if (links) {
            return res.status(200).json({
                status: 'Success',
                data: links,
                message: "Links fetched successfully"
            });
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Links not fetched",
                data: null
            });
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Links not fetched"
        });
    }
});

const updateLink = asyncHandler(async (req, res) => {
    try {
        const { link_id, url, category, title, description } = req.body;

        const linkExists = await Link.findOne({ _id: link_id });
        if (!linkExists) {
            return res.status(400).json({
                status: 'Failed',
                message: "Link does not exist",
                data: null
            });
        }

        // Check ownership
        if (linkExists.posted_by.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                status: 'Failed',
                message: "Not authorized to update this link",
                data: null
            });
        }

        const updateData = {};
        const stripHtml = (str) => (str || '').replace(/<[^>]*>/g, '').trim();

        if (url) {
            const validatedUrl = validateUrl(url);
            updateData.link_data = await fetchLinkMetadata(validatedUrl);
            updateData.is_verified_source = isVerifiedSource(validatedUrl);
            // Overlay user-provided overrides on the freshly fetched metadata
            if (typeof title === 'string') {
                updateData.link_data.title = stripHtml(title).substring(0, 200);
            }
            if (typeof description === 'string') {
                updateData.link_data.description = stripHtml(description).substring(0, 500);
            }
        } else {
            // URL unchanged — use dot notation to update individual fields
            if (typeof title === 'string') {
                updateData['link_data.title'] = stripHtml(title).substring(0, 200);
            }
            if (typeof description === 'string') {
                updateData['link_data.description'] = stripHtml(description).substring(0, 500);
            }
        }

        if (category) {
            updateData.category = validateCategory(category);
        }

        const link = await Link.findByIdAndUpdate(
            link_id,
            { $set: updateData },
            { new: true }
        ).populate("posted_by", "public_user_name is_email_verified avatar_config");

        // Ensure category is tracked if updated
        if (updateData.category) {
            await Category.findOneAndUpdate(
                { name: updateData.category.toLowerCase() },
                {
                    $setOnInsert: {
                        name: updateData.category.toLowerCase(),
                        display_name: updateData.category,
                        created_by: req.user._id,
                        source: 'links'
                    }
                },
                { upsert: true }
            );
        }

        // Update caches
        const oldCategory = linkExists.category;
        const newCategory = link.category;
        const ownerId = req.user._id;

        // Update the link in global + user:all caches
        const baseKeys = [
            cache.generateKey('links', 'all'),
            cache.generateKey('links', 'user', ownerId, 'all'),
        ];
        await updateLinkInCacheLists(baseKeys, link);

        if (oldCategory !== newCategory) {
            // Category changed: remove from old category caches, add to new
            if (oldCategory) {
                await removeLinkFromCacheLists([
                    cache.generateKey('links', 'category', oldCategory),
                    cache.generateKey('links', 'user', ownerId, oldCategory),
                ], link._id);
            }
            if (newCategory) {
                await addLinkToCacheLists([
                    cache.generateKey('links', 'category', newCategory),
                    cache.generateKey('links', 'user', ownerId, newCategory),
                ], link);
                await addCategoryToCache(newCategory);
            }
        } else if (newCategory) {
            // Same category: update in-place
            await updateLinkInCacheLists([
                cache.generateKey('links', 'category', newCategory),
                cache.generateKey('links', 'user', ownerId, newCategory),
            ], link);
        }

        if (link) {
            const io = getIo();
            io.emit('listen_link_update', link);

            return res.status(200).json({
                status: 'Success',
                data: link,
                message: "Link updated successfully"
            });
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Link not updated",
                data: null
            });
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: error.message || "Link not updated"
        });
    }
});

const deleteLink = asyncHandler(async (req, res) => {
    try {
        const linkExists = await Link.findOne({ _id: req.body.link_id });
        if (!linkExists) {
            return res.status(400).json({
                status: 'Failed',
                message: "Link does not exist",
                data: null
            });
        }

        // Check ownership
        if (linkExists.posted_by.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                status: 'Failed',
                message: "Not authorized to delete this link",
                data: null
            });
        }

        // Remove from all relevant cached lists
        const cacheKeys = getLinkCacheKeys(req.user._id, linkExists.category);
        await removeLinkFromCacheLists(cacheKeys, req.body.link_id);

        const link = await Link.findByIdAndDelete({ _id: req.body.link_id });
        if (link) {
            return res.status(200).json({
                status: 'Success',
                data: link,
                message: "Link deleted successfully"
            });
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Link not deleted",
                data: null
            });
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Link not deleted"
        });
    }
});

const likeDislikeLink = asyncHandler(async (req, res) => {
    try {
        const link = await Link.findById(req.body.link_id);

        if (link) {
            const io = getIo();

            if (link.liked_by.includes(req.user._id)) {
                const linkData = await Link.findByIdAndUpdate(
                    req.body.link_id,
                    { $pull: { liked_by: req.user._id } },
                    { new: true }
                ).populate("posted_by", "public_user_name is_email_verified avatar_config");

                // Update cached lists with new liked_by data
                const cacheKeys = getLinkCacheKeys(link.posted_by, linkData.category);
                await updateLinkInCacheLists(cacheKeys, linkData);

                io.emit('listen_link_like', linkData);

                if (linkData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: linkData,
                        message: "Link unliked successfully"
                    });
                }
            } else {
                const linkData = await Link.findByIdAndUpdate(
                    req.body.link_id,
                    { $addToSet: { liked_by: req.user._id } },
                    { new: true }
                ).populate("posted_by", "public_user_name is_email_verified avatar_config");

                // Update cached lists with new liked_by data
                const cacheKeys = getLinkCacheKeys(link.posted_by, linkData.category);
                await updateLinkInCacheLists(cacheKeys, linkData);

                io.emit('listen_link_like', linkData);

                if (linkData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: linkData,
                        message: "Link liked successfully"
                    });
                }
            }
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Link not found",
                data: null
            });
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Like operation failed"
        });
    }
});

const bookmarkLink = asyncHandler(async (req, res) => {
    try {
        const link = await Link.findById(req.body.link_id);

        if (link) {
            const io = getIo();

            if (link.bookmarked_by.includes(req.user._id)) {
                const linkData = await Link.findByIdAndUpdate(
                    req.body.link_id,
                    { $pull: { bookmarked_by: req.user._id } },
                    { new: true }
                ).populate("posted_by", "public_user_name is_email_verified avatar_config");

                // Update cached lists with new bookmarked_by data
                const cacheKeys = getLinkCacheKeys(link.posted_by, linkData.category);
                await updateLinkInCacheLists(cacheKeys, linkData);

                io.emit('listen_link_bookmark', linkData);

                if (linkData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: linkData,
                        message: "Link unbookmarked successfully"
                    });
                } else {
                    return res.status(400).json({
                        status: 'Failed',
                        message: "Link not unbookmarked",
                        data: null
                    });
                }
            } else {
                const linkData = await Link.findByIdAndUpdate(
                    req.body.link_id,
                    { $addToSet: { bookmarked_by: req.user._id } },
                    { new: true }
                ).populate("posted_by", "public_user_name is_email_verified avatar_config");

                // Update cached lists with new bookmarked_by data
                const cacheKeys = getLinkCacheKeys(link.posted_by, linkData.category);
                await updateLinkInCacheLists(cacheKeys, linkData);

                io.emit('listen_link_bookmark', linkData);

                if (linkData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: linkData,
                        message: "Link bookmarked successfully"
                    });
                } else {
                    return res.status(400).json({
                        status: 'Failed',
                        message: "Link not bookmarked",
                        data: null
                    });
                }
            }
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Link not found",
                data: null
            });
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Something went wrong! Please try again later."
        });
    }
});

const getCategories = asyncHandler(async (req, res) => {
    try {
        const cacheKey = cache.generateKey('links', 'categories');
        const cached = await cache.get(cacheKey);

        if (cached) {
            return res.status(200).json({
                status: 'Success',
                data: cached,
                message: "Categories fetched successfully (Cached)"
            });
        }

        // Get categories from the new Category collection
        const dbCategories = await Category.find({}).sort({ display_name: 1 });
        const categoryNames = dbCategories.map(c => c.display_name);

        // Merge with predefined categories and deduplicate
        const categoryMap = new Map();
        [...PREDEFINED_CATEGORIES, ...categoryNames].forEach(cat => {
            if (cat?.trim()) {
                const lower = cat.toLowerCase().trim();
                if (!categoryMap.has(lower)) {
                    categoryMap.set(lower, cat.trim());
                }
            }
        });

        const uniqueCategories = Array.from(categoryMap.values()).sort();

        // Cache the result
        await cache.set(cacheKey, uniqueCategories, TTL.LINK_CATEGORIES);

        return res.status(200).json({
            status: 'Success',
            data: uniqueCategories,
            message: "Categories fetched successfully"
        });
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Failed to fetch categories"
        });
    }
});

// Track link view (increment view_count)
const trackLinkView = asyncHandler(async (req, res) => {
    try {
        const { link_id } = req.body;

        if (!link_id) {
            return res.status(400).json({
                status: 'Failed',
                message: 'Link ID is required',
                data: null
            });
        }

        const link = await Link.findByIdAndUpdate(
            link_id,
            { $inc: { view_count: 1 } },
            { new: true }
        );

        if (!link) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Link not found',
                data: null
            });
        }

        return res.status(200).json({
            status: 'Success',
            data: { view_count: link.view_count },
            message: 'View tracked successfully'
        });
    } catch (error) {
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to track view',
            data: null
        });
    }
});

// Track link click (increment click_count)
const trackLinkClick = asyncHandler(async (req, res) => {
    try {
        const { link_id } = req.body;

        if (!link_id) {
            return res.status(400).json({
                status: 'Failed',
                message: 'Link ID is required',
                data: null
            });
        }

        const link = await Link.findByIdAndUpdate(
            link_id,
            { $inc: { click_count: 1 } },
            { new: true }
        );

        if (!link) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Link not found',
                data: null
            });
        }

        return res.status(200).json({
            status: 'Success',
            data: { click_count: link.click_count },
            message: 'Click tracked successfully'
        });
    } catch (error) {
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to track click',
            data: null
        });
    }
});

// Get link analytics for the authenticated user
const getLinkAnalytics = asyncHandler(async (req, res) => {
    try {
        const userId = req.user._id;

        // Get all links by the user
        const links = await Link.find({ posted_by: userId, access: true })
            .sort({ updatedAt: -1 })
            .select('link_data category view_count click_count liked_by bookmarked_by createdAt');

        // Calculate aggregate stats
        const totalViews = links.reduce((sum, link) => sum + (link.view_count || 0), 0);
        const totalClicks = links.reduce((sum, link) => sum + (link.click_count || 0), 0);
        const totalLikes = links.reduce((sum, link) => sum + (link.liked_by?.length || 0), 0);
        const totalBookmarks = links.reduce((sum, link) => sum + (link.bookmarked_by?.length || 0), 0);

        // Get top performing links (by views)
        const topLinks = [...links]
            .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
            .slice(0, 5)
            .map(link => ({
                _id: link._id,
                title: link.link_data?.title || 'Untitled',
                url: link.link_data?.url,
                category: link.category,
                view_count: link.view_count || 0,
                click_count: link.click_count || 0,
                likes: link.liked_by?.length || 0,
                bookmarks: link.bookmarked_by?.length || 0
            }));

        // Analytics by category
        const categoryStats = links.reduce((acc, link) => {
            const cat = link.category || 'other';
            if (!acc[cat]) {
                acc[cat] = { count: 0, views: 0, clicks: 0 };
            }
            acc[cat].count++;
            acc[cat].views += link.view_count || 0;
            acc[cat].clicks += link.click_count || 0;
            return acc;
        }, {});

        return res.status(200).json({
            status: 'Success',
            data: {
                summary: {
                    total_links: links.length,
                    total_views: totalViews,
                    total_clicks: totalClicks,
                    total_likes: totalLikes,
                    total_bookmarks: totalBookmarks,
                    click_through_rate: totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(2) : 0
                },
                top_links: topLinks,
                category_stats: categoryStats,
                all_links: links.map(link => ({
                    _id: link._id,
                    title: link.link_data?.title || 'Untitled',
                    url: link.link_data?.url,
                    category: link.category,
                    view_count: link.view_count || 0,
                    click_count: link.click_count || 0,
                    likes: link.liked_by?.length || 0,
                    bookmarks: link.bookmarked_by?.length || 0,
                    created_at: link.createdAt
                }))
            },
            message: 'Analytics fetched successfully'
        });
    } catch (error) {
        console.error('Link analytics error:', error);
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to fetch analytics',
            data: null
        });
    }
});

// --- Affiliate link cache helpers ---

const getAffiliateCacheKeys = (ownerId, category) => {
    const keys = [
        cache.generateKey('affiliate', 'all'),
        cache.generateKey('affiliate', 'user', ownerId, 'all'),
    ];
    if (category) {
        keys.push(cache.generateKey('affiliate', 'user', ownerId, category));
        keys.push(cache.generateKey('affiliate', 'category', category));
    }
    return keys;
};

// Generate a unique slug for affiliate links
const generateUniqueSlug = async () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let slug;
    let exists = true;
    while (exists) {
        slug = randomIdGenerator(8, chars);
        const existing = await Link.findOne({ slug });
        if (!existing) exists = false;
    }
    return slug;
};

const createAffiliateLink = asyncHandler(async (req, res) => {
    try {
        const { url, category, title, description, rich_description, campaign, tags, referral_enabled } = req.body;

        const validatedUrl = validateUrl(url);
        const validatedCategory = validateCategory(category);

        const slug = await generateUniqueSlug();

        const metadata = await fetchLinkMetadata(validatedUrl);

        // Override title/description with user-provided values if present
        if (typeof title === 'string' && title.trim()) {
            metadata.title = title.replace(/<[^>]*>/g, '').trim().substring(0, 200);
        }
        if (typeof description === 'string' && description.trim()) {
            metadata.description = description.replace(/<[^>]*>/g, '').trim().substring(0, 500);
        }

        const linkPayload = {
            link_data: metadata,
            posted_by: req.user._id,
            is_verified_source: isVerifiedSource(validatedUrl),
            category: validatedCategory,
            is_affiliate_link: true,
            slug,
            rich_description: rich_description || null,
            campaign: campaign?.trim().substring(0, 100) || null,
            tags: Array.isArray(tags) ? tags.map(t => t.trim().substring(0, 30)).filter(Boolean) : [],
            referral_enabled: !!referral_enabled,
        };

        const link = await Link.create(linkPayload);

        if (validatedCategory) {
            await Category.findOneAndUpdate(
                { name: validatedCategory.toLowerCase() },
                {
                    $setOnInsert: {
                        name: validatedCategory.toLowerCase(),
                        display_name: validatedCategory,
                        created_by: req.user._id,
                        source: 'links'
                    }
                },
                { upsert: true }
            );
        }

        const linkData = await link.populate("posted_by", "public_user_name is_email_verified avatar_config");

        // Update both regular and affiliate caches
        const regularCacheKeys = getLinkCacheKeys(req.user._id, validatedCategory);
        const affiliateCacheKeys = getAffiliateCacheKeys(req.user._id, validatedCategory);
        await Promise.all([
            addLinkToCacheLists(regularCacheKeys, linkData),
            addLinkToCacheLists(affiliateCacheKeys, linkData),
            addCategoryToCache(validatedCategory),
        ]);

        if (linkData) {
            const io = getIo();
            io.emit('listen_link_creation', linkData);

            return res.status(201).json({
                status: 'Success',
                data: linkData,
                message: "Affiliate link created successfully"
            });
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Affiliate link not created",
                data: null
            });
        }
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: error.message || "Affiliate link not created"
        });
    }
});

const fetchAffiliateLinks = asyncHandler(async (req, res) => {
    try {
        const { user_id, category, campaign, tag } = req.query;
        let query = { is_affiliate_link: true, access: true };

        if (user_id) query.posted_by = user_id;
        if (category) query.category = category;
        if (campaign) query.campaign = campaign;
        if (tag) query.tags = tag;

        const cacheKey = user_id
            ? cache.generateKey('affiliate', 'user', user_id, category || 'all')
            : category
                ? cache.generateKey('affiliate', 'category', category)
                : cache.generateKey('affiliate', 'all');

        const cachedData = await cache.get(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                status: 'Success',
                data: cachedData,
                message: "Affiliate links fetched successfully (Cached)"
            });
        }

        const links = await Link.find(query)
            .sort({ updatedAt: -1 })
            .populate('posted_by', 'public_user_name is_email_verified avatar_config');

        await cache.set(cacheKey, links, TTL.AFFILIATE_LINKS_LIST);

        return res.status(200).json({
            status: 'Success',
            data: links,
            message: "Affiliate links fetched successfully"
        });
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Affiliate links not fetched"
        });
    }
});

const updateAffiliateLink = asyncHandler(async (req, res) => {
    try {
        const { link_id, url, category, title, description, rich_description, campaign, tags, referral_enabled } = req.body;

        const linkExists = await Link.findOne({ _id: link_id });
        if (!linkExists) {
            return res.status(400).json({
                status: 'Failed',
                message: "Link does not exist",
                data: null
            });
        }

        if (linkExists.posted_by.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                status: 'Failed',
                message: "Not authorized to update this link",
                data: null
            });
        }

        if (!linkExists.is_affiliate_link) {
            return res.status(400).json({
                status: 'Failed',
                message: "This link is not an affiliate link",
                data: null
            });
        }

        const updateData = {};
        const stripHtml = (str) => (str || '').replace(/<[^>]*>/g, '').trim();

        if (url) {
            const validatedUrl = validateUrl(url);
            updateData.link_data = await fetchLinkMetadata(validatedUrl);
            updateData.is_verified_source = isVerifiedSource(validatedUrl);
            if (typeof title === 'string') {
                updateData.link_data.title = stripHtml(title).substring(0, 200);
            }
            if (typeof description === 'string') {
                updateData.link_data.description = stripHtml(description).substring(0, 500);
            }
        } else {
            if (typeof title === 'string') {
                updateData['link_data.title'] = stripHtml(title).substring(0, 200);
            }
            if (typeof description === 'string') {
                updateData['link_data.description'] = stripHtml(description).substring(0, 500);
            }
        }

        if (category) {
            updateData.category = validateCategory(category);
        }

        if (typeof rich_description === 'string') {
            updateData.rich_description = rich_description;
        }
        if (typeof campaign === 'string') {
            updateData.campaign = campaign.trim().substring(0, 100) || null;
        }
        if (Array.isArray(tags)) {
            updateData.tags = tags.map(t => t.trim().substring(0, 30)).filter(Boolean);
        }
        if (typeof referral_enabled === 'boolean') {
            updateData.referral_enabled = referral_enabled;
        }

        const link = await Link.findByIdAndUpdate(
            link_id,
            { $set: updateData },
            { new: true }
        ).populate("posted_by", "public_user_name is_email_verified avatar_config");

        if (updateData.category) {
            await Category.findOneAndUpdate(
                { name: updateData.category.toLowerCase() },
                {
                    $setOnInsert: {
                        name: updateData.category.toLowerCase(),
                        display_name: updateData.category,
                        created_by: req.user._id,
                        source: 'links'
                    }
                },
                { upsert: true }
            );
        }

        // Update both regular and affiliate caches
        const oldCategory = linkExists.category;
        const newCategory = link.category;
        const ownerId = req.user._id;

        const baseKeys = [
            cache.generateKey('links', 'all'),
            cache.generateKey('links', 'user', ownerId, 'all'),
            cache.generateKey('affiliate', 'all'),
            cache.generateKey('affiliate', 'user', ownerId, 'all'),
        ];
        await updateLinkInCacheLists(baseKeys, link);

        if (oldCategory !== newCategory) {
            if (oldCategory) {
                await removeLinkFromCacheLists([
                    cache.generateKey('links', 'category', oldCategory),
                    cache.generateKey('links', 'user', ownerId, oldCategory),
                    cache.generateKey('affiliate', 'category', oldCategory),
                    cache.generateKey('affiliate', 'user', ownerId, oldCategory),
                ], link._id);
            }
            if (newCategory) {
                await addLinkToCacheLists([
                    cache.generateKey('links', 'category', newCategory),
                    cache.generateKey('links', 'user', ownerId, newCategory),
                    cache.generateKey('affiliate', 'category', newCategory),
                    cache.generateKey('affiliate', 'user', ownerId, newCategory),
                ], link);
                await addCategoryToCache(newCategory);
            }
        } else if (newCategory) {
            await updateLinkInCacheLists([
                cache.generateKey('links', 'category', newCategory),
                cache.generateKey('links', 'user', ownerId, newCategory),
                cache.generateKey('affiliate', 'category', newCategory),
                cache.generateKey('affiliate', 'user', ownerId, newCategory),
            ], link);
        }

        if (link) {
            const io = getIo();
            io.emit('listen_link_update', link);

            return res.status(200).json({
                status: 'Success',
                data: link,
                message: "Affiliate link updated successfully"
            });
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Affiliate link not updated",
                data: null
            });
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: error.message || "Affiliate link not updated"
        });
    }
});

const redirectAndTrack = asyncHandler(async (req, res) => {
    try {
        const link = await Link.findOne({ slug: req.params.slug, access: true });

        if (!link) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Link not found',
                data: null
            });
        }

        const refUserId = req.query.ref || null;
        const ipAddress = req.ip || req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'] || '';
        const referrer = req.headers.referer || req.headers.referrer || '';

        // Check for duplicate click (same IP + link within 24h)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existingClick = await Click.findOne({
            link_id: link._id,
            ip_address: ipAddress,
            timestamp: { $gte: twentyFourHoursAgo }
        });

        await Click.create({
            link_id: link._id,
            user_agent: userAgent,
            ip_address: ipAddress,
            referrer,
            referral_user_id: refUserId,
            is_unique: !existingClick,
        });

        // Upsert referral if ref param present
        if (refUserId) {
            await Referral.findOneAndUpdate(
                { link_id: link._id, referral_user_id: refUserId },
                {
                    $inc: { click_count: 1 },
                    $set: { last_click_at: new Date() },
                    $setOnInsert: { first_click_at: new Date() }
                },
                { upsert: true }
            );
        }

        // Increment click_count on the link
        await Link.findByIdAndUpdate(link._id, { $inc: { click_count: 1 } });

        return res.redirect(302, link.link_data.url);
    } catch (error) {
        console.error('Redirect and track error:', error);
        return res.status(500).json({
            status: 'Failed',
            message: 'Redirect failed',
            data: null
        });
    }
});

const getAffiliateLinkById = asyncHandler(async (req, res) => {
    try {
        const link = await Link.findOne({
            _id: req.params.id,
            is_affiliate_link: true,
            access: true
        }).populate('posted_by', 'public_user_name is_email_verified avatar_config');

        if (!link) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Affiliate link not found',
                data: null
            });
        }

        return res.status(200).json({
            status: 'Success',
            data: link,
            message: 'Affiliate link fetched successfully'
        });
    } catch (error) {
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to fetch affiliate link',
            data: null
        });
    }
});

const getAffiliateLinkAnalytics = asyncHandler(async (req, res) => {
    try {
        const userId = req.user._id;
        const { link_id } = req.params;

        if (link_id) {
            // Per-link analytics
            const link = await Link.findOne({ _id: link_id, posted_by: userId, is_affiliate_link: true });
            if (!link) {
                return res.status(404).json({
                    status: 'Failed',
                    message: 'Affiliate link not found or not authorized',
                    data: null
                });
            }

            // Daily clicks aggregation
            const dailyClicks = await Click.aggregate([
                { $match: { link_id: link._id } },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                        count: { $sum: 1 },
                        unique_count: { $sum: { $cond: ["$is_unique", 1, 0] } }
                    }
                },
                { $sort: { _id: 1 } }
            ]);

            const totalClicks = await Click.countDocuments({ link_id: link._id });
            const uniqueClicks = await Click.countDocuments({ link_id: link._id, is_unique: true });

            // Referral breakdown
            const referrals = await Referral.find({ link_id: link._id })
                .sort({ click_count: -1 });

            return res.status(200).json({
                status: 'Success',
                data: {
                    link_id: link._id,
                    title: link.link_data?.title || 'Untitled',
                    slug: link.slug,
                    total_clicks: totalClicks,
                    unique_clicks: uniqueClicks,
                    daily_clicks: dailyClicks.map(d => ({ date: d._id, count: d.count, unique_count: d.unique_count })),
                    referrals: referrals.map(r => ({
                        referral_user_id: r.referral_user_id,
                        click_count: r.click_count,
                        first_click_at: r.first_click_at,
                        last_click_at: r.last_click_at
                    }))
                },
                message: 'Affiliate link analytics fetched successfully'
            });
        }

        // All affiliate links summary for user
        const links = await Link.find({ posted_by: userId, is_affiliate_link: true, access: true })
            .sort({ updatedAt: -1 })
            .select('link_data category slug campaign tags click_count view_count liked_by bookmarked_by createdAt');

        const linkIds = links.map(l => l._id);
        const totalClicksFromDb = await Click.countDocuments({ link_id: { $in: linkIds } });
        const uniqueClicksFromDb = await Click.countDocuments({ link_id: { $in: linkIds }, is_unique: true });
        const totalReferrals = await Referral.countDocuments({ link_id: { $in: linkIds } });

        // Top performers by click_count
        const topPerformers = [...links]
            .sort((a, b) => (b.click_count || 0) - (a.click_count || 0))
            .slice(0, 5)
            .map(link => ({
                _id: link._id,
                title: link.link_data?.title || 'Untitled',
                slug: link.slug,
                click_count: link.click_count || 0,
                view_count: link.view_count || 0,
            }));

        // Campaign breakdown
        const campaignStats = links.reduce((acc, link) => {
            const camp = link.campaign || 'none';
            if (!acc[camp]) acc[camp] = { count: 0, clicks: 0 };
            acc[camp].count++;
            acc[camp].clicks += link.click_count || 0;
            return acc;
        }, {});

        // Category breakdown
        const categoryStats = links.reduce((acc, link) => {
            const cat = link.category || 'other';
            if (!acc[cat]) acc[cat] = { count: 0, clicks: 0 };
            acc[cat].count++;
            acc[cat].clicks += link.click_count || 0;
            return acc;
        }, {});

        // Daily clicks timeline for all affiliate links
        const dailyClicks = await Click.aggregate([
            { $match: { link_id: { $in: linkIds } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        return res.status(200).json({
            status: 'Success',
            data: {
                summary: {
                    total_links: links.length,
                    total_clicks: totalClicksFromDb,
                    unique_clicks: uniqueClicksFromDb,
                    total_referrals: totalReferrals,
                },
                top_performers: topPerformers,
                campaign_stats: campaignStats,
                category_stats: categoryStats,
                daily_clicks: dailyClicks.map(d => ({ date: d._id, count: d.count })),
                all_links: links.map(link => ({
                    _id: link._id,
                    title: link.link_data?.title || 'Untitled',
                    slug: link.slug,
                    category: link.category,
                    campaign: link.campaign,
                    click_count: link.click_count || 0,
                    view_count: link.view_count || 0,
                    created_at: link.createdAt
                }))
            },
            message: 'Affiliate analytics fetched successfully'
        });
    } catch (error) {
        console.error('Affiliate analytics error:', error);
        return res.status(500).json({
            status: 'Failed',
            message: 'Failed to fetch affiliate analytics',
            data: null
        });
    }
});

module.exports = {
    createLink,
    fetchLinks,
    updateLink,
    deleteLink,
    likeDislikeLink,
    bookmarkLink,
    getCategories,
    trackLinkView,
    trackLinkClick,
    getLinkAnalytics,
    createAffiliateLink,
    fetchAffiliateLinks,
    updateAffiliateLink,
    redirectAndTrack,
    getAffiliateLinkById,
    getAffiliateLinkAnalytics,
};
