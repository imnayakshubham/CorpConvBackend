const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Fetches OpenGraph metadata from a given URL
 * @param {string} url - The URL to fetch metadata from
 * @returns {Promise<Object>} Metadata object with title, description, image, and url
 */
async function fetchLinkMetadata(url) {
    try {
        // Validate URL
        const urlObj = new URL(url);

        // Fetch the HTML content
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; HushworkBot/1.0; +https://hushwork.com)',
            },
            timeout: 10000, // 10 second timeout
            maxRedirects: 5,
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Extract OpenGraph metadata
        const metadata = {
            url: url,
            title: null,
            description: null,
            image: null,
            siteName: null,
        };

        // Try OpenGraph tags first
        metadata.title =
            $('meta[property="og:title"]').attr('content') ||
            $('meta[name="twitter:title"]').attr('content') ||
            $('title').text() ||
            null;

        metadata.description =
            $('meta[property="og:description"]').attr('content') ||
            $('meta[name="twitter:description"]').attr('content') ||
            $('meta[name="description"]').attr('content') ||
            null;

        metadata.image =
            $('meta[property="og:image"]').attr('content') ||
            $('meta[name="twitter:image"]').attr('content') ||
            $('meta[property="og:image:url"]').attr('content') ||
            null;

        metadata.siteName =
            $('meta[property="og:site_name"]').attr('content') ||
            urlObj.hostname ||
            null;

        // Make image URL absolute if it's relative
        if (metadata.image && !metadata.image.startsWith('http')) {
            metadata.image = new URL(metadata.image, url).href;
        }

        // Truncate long strings
        if (metadata.title && metadata.title.length > 200) {
            metadata.title = metadata.title.substring(0, 197) + '...';
        }
        if (metadata.description && metadata.description.length > 500) {
            metadata.description = metadata.description.substring(0, 497) + '...';
        }

        return metadata;
    } catch (error) {
        console.error('Error fetching link metadata:', error.message);

        // Return basic metadata on error
        try {
            const urlObj = new URL(url);
            return {
                url: url,
                title: urlObj.hostname,
                description: null,
                image: null,
                siteName: urlObj.hostname,
            };
        } catch (urlError) {
            throw new Error('Invalid URL provided');
        }
    }
}

module.exports = {
    fetchLinkMetadata,
};
