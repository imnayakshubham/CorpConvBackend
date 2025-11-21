const OpenAI = require('openai/index.js');
const config = require('../config');
const { MODELS } = require('../constants/models');
const rateLimitHandler = require('./rateLimitHandler');
const conversationService = require('./conversationService');
const logger = require('../utils/logger');

class AIService {
    constructor() {
        this.openai = new OpenAI({
            baseURL: config.cloudflare.baseUrl,
            apiKey: config.cloudflare.apiToken,
            defaultHeaders: {
                'Authorization': `Bearer ${config.cloudflare.apiToken}`,
            }
        });
    }

    async generateResponse(sessionId, userMessage, options = {}) {
        const {
            temperature = 0.7,
            max_tokens = 500,
            modelType = 'TEXT_GENERATION',
            systemPrompt = null
        } = options;

        // Add system prompt if provided and conversation is new
        if (systemPrompt) {
            const conversation = conversationService.getConversation(sessionId);
            if (conversation.messages.length === 0) {
                conversationService.addMessage(sessionId, 'system', systemPrompt);
            }
        }

        // Add user message to conversation
        conversationService.addMessage(sessionId, 'user', userMessage);

        // Get conversation history
        const messages = conversationService.getFormattedMessages(sessionId);

        const availableModels = MODELS[modelType].filter(model =>
            !rateLimitHandler.shouldSkipModel(model.name)
        );

        if (availableModels.length === 0) {
            throw new Error('All models are currently rate limited');
        }

        let lastError = null;

        for (const model of availableModels) {
            try {
                logger.info(`Generating response with model: ${model.name} for session: ${sessionId}`);

                const completion = await this.openai.chat.completions.create({
                    model: model.name,
                    messages: messages,
                    temperature,
                    max_tokens,
                });

                const assistantResponse = completion.choices[0].message.content;

                // Add assistant response to conversation
                conversationService.addMessage(sessionId, 'assistant', assistantResponse, {
                    model: model.name,
                    usage: completion.usage
                });

                // Success - reset failure count for this model
                rateLimitHandler.resetFailures(model.name);

                return {
                    response: assistantResponse,
                    model_used: model.name,
                    usage: completion.usage,
                    conversation_stats: conversationService.getConversationStats(sessionId),
                    message_count: messages.length
                };

            } catch (error) {
                logger.error(`Model ${model.name} failed for session ${sessionId}:`, error.message);
                lastError = error;

                if (rateLimitHandler.isRateLimitError(error)) {
                    rateLimitHandler.recordFailure(model.name);
                    logger.warn(`Rate limit hit for ${model.name}, trying next model...`);
                    continue;
                }

                // Non-rate-limit error, don't try other models
                throw error;
            }
        }

        throw new Error(`All available models failed. Last error: ${lastError?.message}`);
    }

    async getSingleResponse(message, options = {}) {
        // For stateless single responses without conversation history
        const {
            temperature = 0.7,
            max_tokens = 150,
            modelType = 'TEXT_GENERATION'
        } = options;

        const availableModels = MODELS[modelType].filter(model =>
            !rateLimitHandler.shouldSkipModel(model.name)
        );

        if (availableModels.length === 0) {
            throw new Error('All models are currently rate limited');
        }

        let lastError = null;

        for (const model of availableModels) {
            try {
                logger.info(`Generating single response with model: ${model.name}`);

                const completion = await this.openai.chat.completions.create({
                    model: model.name,
                    messages: [{ role: 'user', content: message }],
                    temperature,
                    max_tokens,
                });

                rateLimitHandler.resetFailures(model.name);

                return {
                    response: completion.choices[0].message.content,
                    model_used: model.name,
                    usage: completion.usage
                };

            } catch (error) {
                logger.error(`Model ${model.name} failed:`, error.message);
                lastError = error;

                if (rateLimitHandler.isRateLimitError(error)) {
                    rateLimitHandler.recordFailure(model.name);
                    continue;
                }

                throw error;
            }
        }

        throw new Error(`All available models failed. Last error: ${lastError?.message}`);
    }

    getModelStatus() {
        return MODELS.TEXT_GENERATION.map(model => ({
            name: model.name,
            rateLimit: `${model.rateLimit} req/min`,
            status: rateLimitHandler.shouldSkipModel(model.name) ? 'rate_limited' : 'available'
        }));
    }

    async getEmbeddingModelStatus() {
        try {
            const res = await fetch(`${process.env.HF_API_END_POINT}health`);
            const text = await res.text();
            return {
                status: text,
            };
        } catch (err) {
            console.error('Health check failed:', err);
            return { status: 'failed', error: err.message };
        }
    }
}

module.exports = new AIService();
