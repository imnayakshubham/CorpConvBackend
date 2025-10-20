const jwt = require("jsonwebtoken");
const { default: mongoose } = require("mongoose");
const { jobPostSites } = require("../constants");

/**
 * Generate minimal JWT token for security
 * SECURITY: Token payload contains ONLY the user ID ({ id: user_id })
 * No sensitive data (email, name, etc.) is included in the token
 * All user information is fetched from MongoDB on each request via authMiddleware
 *
 * @param {string} id - User ID (MongoDB ObjectId)
 * @param {string} expiresIn - Token expiration time (default: 30 days)
 * @returns {string} - JWT token with minimal payload
 */
const generateToken = (id, expiresIn = "30d") => {
    return jwt.sign({ id }, process.env.JWT_SECRET_KEY, {
        expiresIn,
    });
};

const toTitleCase = (userInput) => {
    return userInput.replace(/\b\w/g, match => match.toUpperCase());
}

const randomIdGenerator = (size = 15, chars = '0123456789ABCDEF') => {
    let result = '';
    for (let i = 0; i < size; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result
}

const generateUserId = (userType = "user_") => {
    const date = new Date();
    const year = date.getFullYear().toString();
    const size = 24 - `${userType.trim()}${year}`.length;

    const randomId = randomIdGenerator(size);
    const newId = randomId.padEnd(size, '0');

    const user_id = `${userType.toLowerCase()}${newId}${year}`;
    return user_id;
};

const keepOnlyNumbers = (inputString) => {
    return Number(inputString.replace(/[^0-9]/g, ''))
}

const isJobVerified = (link) => {
    return jobPostSites.some(keyword => link.includes(keyword));
}

const populateChildComments = async (comments) => {
    for (const comment of comments) {
        await comment.populate('commented_by', "public_user_name is_email_verified")

        if (comment.nested_comments.length > 0) {
            if (comment.access || comment?.access === undefined) {
                await comment.populate('commented_by', "public_user_name is_email_verified")
                await comment.populate({
                    path: 'nested_comments',
                    match: { access: { $ne: false } },
                });
                await populateChildComments(comment.nested_comments)
            }
        }
    }
}


const DEFAULT_RATE_LIMIT_SETTINGS = {
    enabled: true,
    maxSubmissions: 5,
    timeWindow: 30,
    blockDuration: 60,
    message: "Please wait before submitting another request.",
};

/**
 * Default profanity filter settings for all forms
 */
const DEFAULT_PROFANITY_FILTER_SETTINGS = {
    enabled: true,
    strictMode: true,
    replaceWithAsterisks: false,
    customWords: [],
    custom_message: "Please keep your submission respectful.",
    whitelistedWords: [],
};

/**
 * Default response limit for all forms
 */

const DEFAULT_RESPONSE_LIMIT_SETTINGS = {
    enabled: false,
    maxResponses: 100,
    message: "This survey is no longer accepting responses.",
};

/**
 * Default password protection settings for all forms
 */
const DEFAULT_PASSWORD_PROTECTION_SETTINGS = {
    enabled: false,
    password: "",
    message:
        "This survey is password protected. Please enter the password to continue.",
};

/**
 * Default duplicate prevention settings for all forms
 */
const DEFAULT_DUPLICATE_PREVENTION_SETTINGS = {
    enabled: false,
    strategy: "combined",
    mode: "one-time",
    timeWindow: 1440,
    message:
        "You have already submitted this survey. Each user can only submit once.",
    allowOverride: false,
    maxAttempts: 1,
};

const DEFAULT_SOCIAL_MEDIA_SETTINGS = {
    enabled: true,
    platforms: {
        github: "https://github.com/preetsuthar17",
        twitter: "https://x.com/preetsuthar17",
    },
    showIcons: true,
    iconSize: "md",
    position: "footer",
};

const DEFAULT_EMAIL_VALIDATION_SETTINGS = {
    allowedDomains: [],
    blockedDomains: [],
    autoCompleteDomain: "",
    requireBusinessEmail: false,
    customValidationMessage: "",
};

const DEFAULT_NOTIFICATION_SETTINGS = {
    enabled: true,
    email: "",
    subject: "You received a submission! 🥳",
    message: "Whoo-hoo!! You have received a new submission on your survey.",
};

const DEFAULT_LAYOUT_SETTINGS = {
    margin: "md",
    padding: "lg",
    maxWidth: "md",
    border_radius: "md",
    spacing: "normal",
    alignment: "left",
};

/**
 * Default color settings for all forms
 */
const DEFAULT_COLOR_SETTINGS = {
    text: "#1f2937",
    border: "#e5e7eb",
    primary: "#3b82f6",
    background: "transparent",
};

/**
 * Default typography settings for all forms
 */
const DEFAULT_TYPOGRAPHY_SETTINGS = {
    fontSize: "base",
    fontFamily: "Inter",
    fontWeight: "normal",
    lineHeight: "normal",
    letterSpacing: "normal",
};


function createDefaultFormSchema(options) {
    return {
        blocks: options.multiStep
            ? [
                {
                    id: "step-1",
                    title: "Step 1",
                    description: "First step of your survey",
                    fields: [],
                },
            ]
            : [
                {
                    id: "default",
                    title: "Survey Fields",
                    description: "",
                    fields: [],
                },
            ],
        fields: [],
        settings: {
            title: options.title || "Untitled Survey",
            publicTitle: options.publicTitle || "",
            description: options.description || "",
            submitText: "Submit",
            successMessage: "Thank you for your submission!",
            redirect_url: "",
            multiStep: options.multiStep,
            showProgress: options.multiStep !== false,
            hideHeader: false,
            colors: { ...DEFAULT_COLOR_SETTINGS },
            typography: { ...DEFAULT_TYPOGRAPHY_SETTINGS },
            branding: {
                socialMedia: { ...DEFAULT_SOCIAL_MEDIA_SETTINGS },
            },
            layout: { ...DEFAULT_LAYOUT_SETTINGS },
            rateLimit: { ...DEFAULT_RATE_LIMIT_SETTINGS },
            profanityFilter: { ...DEFAULT_PROFANITY_FILTER_SETTINGS },
            responseLimit: { ...DEFAULT_RESPONSE_LIMIT_SETTINGS },
            passwordProtection: { ...DEFAULT_PASSWORD_PROTECTION_SETTINGS },
            notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
            duplicatePrevention: { ...DEFAULT_DUPLICATE_PREVENTION_SETTINGS },
        },
    };
}

module.exports = { generateToken, toTitleCase, randomIdGenerator, generateUserId, keepOnlyNumbers, isJobVerified, populateChildComments, createDefaultFormSchema };