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

module.exports = { MODELS, getModelsByTask };
