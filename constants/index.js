// Verified link sources - includes job sites plus code/dev, learning, docs, news, and content platforms
const verifiedLinkSources = [
    // Job sites
    "indeed",
    "linkedin",
    "monster",
    "glassdoor",
    "careerbuilder",
    "ziprecruiter",
    "simplyhired",
    "dice",
    "idealist",
    "usajobs",
    "snagajob",
    "upwork",
    "freelancer",
    "fiverr",
    "naukri",
    "shine",
    "timesjobs",
    "freshersworld",
    "angel.co",
    "dribbble",
    "remote.co",
    "justremote",
    "flexjobs",
    "careerjet",
    "jooble",
    "ladders",
    "workopolis",
    "jobbank",
    "reed",
    "totaljobs",
    "behance",
    "larajobs",
    "weworkremotely",
    "remoteok",

    // Code/Dev platforms
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "stackoverflow.com",
    "dev.to",
    "codepen.io",
    "replit.com",
    "codesandbox.io",
    "npmjs.com",
    "pypi.org",
    "crates.io",

    // Learning platforms
    "coursera.org",
    "udemy.com",
    "edx.org",
    "pluralsight.com",
    "freecodecamp.org",
    "codecademy.com",
    "khanacademy.org",
    "skillshare.com",
    "lynda.com",
    "udacity.com",
    "leetcode.com",
    "hackerrank.com",
    "egghead.io",
    "frontendmasters.com",

    // Documentation sites
    "docs.",
    "developer.",
    "documentation",
    "developers.",
    "learn.",
    "wiki.",

    // News & Tech sites
    "news.ycombinator.com",
    "techcrunch.com",
    "theverge.com",
    "wired.com",
    "arstechnica.com",
    "thenextweb.com",
    "engadget.com",
    "venturebeat.com",
    "zdnet.com",

    // Content platforms
    "medium.com",
    "substack.com",
    "hashnode.dev",
    "notion.so",
    "blogger.com",
    "wordpress.com",

    // Video platforms
    "youtube.com",
    "vimeo.com",
    "twitch.tv",

    // Official company/product sites
    "microsoft.com",
    "google.com",
    "apple.com",
    "aws.amazon.com",
    "azure.microsoft.com",
    "cloud.google.com",
    "firebase.google.com",
    "vercel.com",
    "netlify.com",
    "heroku.com",
    "digitalocean.com",

    // Research & Academic
    "arxiv.org",
    "researchgate.net",
    "scholar.google.com",
    "acm.org",
    "ieee.org"
];

// Keep backward compatibility alias
const jobPostSites = verifiedLinkSources;


const tokenkeyName = "hush-work-key"

const isProd = process.env.APP_ENV === 'PROD';

const cookieOptions = {
    httpOnly: true,
    secure: isProd,             // must be true in production
    sameSite: isProd ? 'none' : 'lax', // cross-origin needs None in prod
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
    domain: isProd ? undefined : 'localhost'
};

const MODEL_CONFIGS = {
    TEXT_GENERATION: [
        {
            id: '@cf/meta/llama-3-8b-instruct',
            name: 'Llama 3 8B',
            rateLimit: 300, // req/min
            priority: 1,
            maxTokens: 2048,
            capabilities: ['chat', 'completion']
        },
        {
            id: '@cf/microsoft/phi-2',
            name: 'Phi-2',
            rateLimit: 720,
            priority: 2,
            maxTokens: 1024,
            capabilities: ['chat', 'completion']
        },
        {
            id: '@cf/qwen/qwen1.5-0.5b-chat',
            name: 'Qwen 1.5 0.5B',
            rateLimit: 1500,
            priority: 3,
            maxTokens: 512,
            capabilities: ['chat']
        },
        {
            id: '@cf/tinyllama/tinyllama-1.1b-chat-v1.0',
            name: 'TinyLlama',
            rateLimit: 720,
            priority: 4,
            maxTokens: 512,
            capabilities: ['chat']
        }
    ],

    EMBEDDINGS: [
        {
            id: '@cf/baai/bge-large-en-v1.5',
            name: 'BGE Large EN',
            rateLimit: 1500,
            priority: 1
        }
    ]
};

const getModelsByTask = (task) => {
    return MODEL_CONFIGS[task]?.sort((a, b) => a.priority - b.priority) || [];
};
const MODELS = {
    TEXT_GENERATION: [
        {
            name: '@cf/meta/llama-3-8b-instruct',
            rateLimit: 300, // requests per minute
            priority: 1
        },
        {
            name: '@cf/microsoft/phi-2',
            rateLimit: 720,
            priority: 2
        },
        {
            name: '@cf/qwen/qwen1.5-0.5b-chat',
            rateLimit: 1500,
            priority: 3
        },
        {
            name: '@cf/tinyllama/tinyllama-1.1b-chat-v1.0',
            rateLimit: 720,
            priority: 4
        }
    ]
};


const projection = {
    user_job_role: 1,
    is_anonymous: 1,
    is_email_verified: 1,
    user_bio: 1,
    user_current_company_name: 1,
    user_id: 1,
    user_job_experience: 1,
    user_location: 1,
    public_user_name: 1,
    followings: 1,
    followers: 1,
    id: 1,
    _id: 1,
    avatar_config: 1,
    qr_config: 1,
    user_public_profile_pic: 1
};


module.exports = { jobPostSites, verifiedLinkSources, tokenkeyName, cookieOptions, isProd, MODELS, getModelsByTask, projection }
