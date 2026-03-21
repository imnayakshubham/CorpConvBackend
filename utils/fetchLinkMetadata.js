const axios = require('axios');
const { load } = require('cheerio');

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

module.exports = { fetchLinkMetadata, sanitizeMetadata };
