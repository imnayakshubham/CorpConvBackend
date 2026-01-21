
const jobPostSites = [
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
    "craigslist",
    "upwork",
    "freelancer",
    "elance",
    "fiverr",
    "naukri",
    "shine",
    "timesjobs",
    "freshersworld",
    "angel.co",
    "linkedin",
    "dribbble",
    "github jobs",
    "stack overflow jobs",
    "remote OK",
    "we work remotely",
    "remote.co",
    "justremote",
    "virtual vocations",
    "flexjobs",
    "indeed remote",
    "google for jobs",
    "careerjet",
    "juju",
    "linkup",
    "neuvoo",
    "jobisjob",
    "jobrapido",
    "careerjet",
    "jobs2careers",
    "gumtree",
    "reed",
    "totaljobs",
    "workopolis",
    "jobbank",
    "jobboom",
    "jooble",
    "jobindex",
    "jobcase",
    "glassdoor",
    "ladders",
    "monster",
    "ziprecruiter",
    "simplyhired",
    "dice",
    "idealist",
    "usajobs",
    "snagajob",
    "craigslist",
    "upwork",
    "freelancer",
    "elance",
    "fiverr",
    "naukri",
    "shine",
    "timesjobs",
    "freshersworld",
    "angel.co",
    "linkedin",
    "dribbble",
    "github jobs",
    "stack overflow jobs",
    "remote OK",
    "we work remotely",
    "remote.co",
    "justremote",
    "virtual vocations",
    "flexjobs",
    "indeed remote",
    "google for jobs",
    "careerjet",
    "juju",
    "linkup",
    "neuvoo",
    "jobisjob",
    "jobrapido",
    "careerjet",
    "jobs2careers",
    "gumtree",
    "reed",
    "totaljobs",
    "workopolis",
    "jobbank",
    "jobboom",
    "jooble",
    "jobindex",
    "jobcase",
    "idealista",
    "creativepool",
    "coroflot",
    "krop",
    "behance",
    "golang jobs",
    "python.org/jobs",
    "ruby now",
    "weworkmeteor",
    "hasjob",
    "careers.javascriptweekly",
    "angularjobs",
    "larajobs",
    "jobs.vuejs",
    "gamedevjobs.io",
    "unity3d",
    "jobs.gamasutra",
    "gamejobs.co",
    "jobs.gameindustry.biz",
    "gisjobs",
    "gisuser",
    "geojobs.biz",
    "esri",
    "environmental jobs",
    "conservation job board",
    "ecojobs",
    "greenjobs",
    "sustainable business",
    "hcareers",
    "ihirehospitality",
    "culinaryagents",
    "bartend.com",
    "workinretail",
    "theladders",
    "jobdiagnosis",
    "jora",
    "mitula",
    "us.jobs",
    "us.jobrapido",
    "jobsgalore",
    "jobvertise",
    "jobhat",
    "jobisite",
    "postjobfree",
    "veteran jobs",
    "militaryhire",
    "hirepurpose",
    "vetjobs",
    "clearancejobs",
    "hireveterans",
    "recruitmilitary",
    "taonline",
    "military.com/jobsearch",
    "transitioning military",
    "jobsonline",
    "bestjobsusa",
    "veteranjoblistings",
    "veteranjobs.net",
    "veteransjobexchange",
    "justveteransjobs",
    "vettedhonor",
    "hiringourheroes",
    "militaryfriendly",
    "gi jobs",
    "hcareers",
    "ihirehospitality",
    "culinaryagents",
    "bartend.com",
    "workinretail",
    "theladders",
    "jobdiagnosis",
    "jora",
    "mitula",
    "careers",
    "jobs"
];


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
    _id: 1
};


module.exports = { jobPostSites, tokenkeyName, cookieOptions, isProd, MODELS, getModelsByTask, projection }
