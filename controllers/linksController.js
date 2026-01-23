const asyncHandler = require('express-async-handler');
const Link = require('../models/linkModel');
const { getIo } = require('../utils/socketManger');
const axios = require("axios");
const { load } = require("cheerio");
const { isVerifiedSource } = require('../utils/utils');
const cache = require('../redisClient/cacheHelper');
const TTL = require('../redisClient/cacheTTL');

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

        // Invalidate caches
        const userLinksKey = cache.generateKey('links', 'user', req.user._id);
        const allLinksKey = cache.generateKey('links', 'all');
        const categoriesKey = cache.generateKey('links', 'categories');
        await cache.del(userLinksKey, allLinksKey, categoriesKey);

        const link = await Link.create(linkPayload);
        const linkData = await link.populate("posted_by", "public_user_name is_email_verified avatar_config");

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
        const { link_id, url, category } = req.body;

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

        if (url) {
            const validatedUrl = validateUrl(url);
            updateData.link_data = await fetchLinkMetadata(validatedUrl);
            updateData.is_verified_source = isVerifiedSource(validatedUrl);
        }

        if (category) {
            updateData.category = validateCategory(category);
        }

        const link = await Link.findByIdAndUpdate(
            link_id,
            { $set: updateData },
            { new: true }
        ).populate("posted_by", "public_user_name is_email_verified avatar_config");

        // Invalidate caches
        const userLinksKey = cache.generateKey('links', 'user', req.user._id);
        const allLinksKey = cache.generateKey('links', 'all');
        const categoriesKey = cache.generateKey('links', 'categories');
        await cache.del(userLinksKey, allLinksKey, categoriesKey);

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

        // Invalidate caches
        const userLinksKey = cache.generateKey('links', 'user', req.user._id);
        const allLinksKey = cache.generateKey('links', 'all');
        const categoriesKey = cache.generateKey('links', 'categories');
        await cache.del(userLinksKey, allLinksKey, categoriesKey);

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

        // Invalidate caches
        const userLinksKey = cache.generateKey('links', 'user', req.user._id);
        const allLinksKey = cache.generateKey('links', 'all');
        await cache.del(userLinksKey, allLinksKey);

        if (link) {
            const io = getIo();

            if (link.liked_by.includes(req.user._id)) {
                const linkData = await Link.findByIdAndUpdate(
                    req.body.link_id,
                    { $pull: { liked_by: req.user._id } },
                    { new: true }
                ).populate("posted_by", "public_user_name is_email_verified avatar_config");

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

        // Invalidate caches
        const userLinksKey = cache.generateKey('links', 'user', req.user._id);
        const allLinksKey = cache.generateKey('links', 'all');
        await cache.del(userLinksKey, allLinksKey);

        if (link) {
            const io = getIo();

            if (link.bookmarked_by.includes(req.user._id)) {
                const linkData = await Link.findByIdAndUpdate(
                    req.body.link_id,
                    { $pull: { bookmarked_by: req.user._id } },
                    { new: true }
                ).populate("posted_by", "public_user_name is_email_verified avatar_config");

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

        // Get unique categories from database
        const dbCategories = await Link.distinct('category');

        // Merge with predefined categories and deduplicate
        const categoryMap = new Map();
        [...PREDEFINED_CATEGORIES, ...dbCategories].forEach(cat => {
            if (cat?.trim()) {
                categoryMap.set(cat.toLowerCase().trim(), cat.trim());
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

module.exports = {
    createLink,
    fetchLinks,
    updateLink,
    deleteLink,
    likeDislikeLink,
    bookmarkLink,
    getCategories
};
