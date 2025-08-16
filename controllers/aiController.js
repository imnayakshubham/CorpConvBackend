const aiService = require('../services/aiService');
const conversationService = require('../services/conversationService');
const logger = require('../utils/logger');

class AIController {
    async generateResponse(req, res, next) {
        try {
            const {
                message,
                sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                temperature,
                max_tokens,
                systemPrompt
            } = req.body;

            const result = await aiService.generateResponse(sessionId, message, {
                temperature,
                max_tokens,
                systemPrompt
            });

            logger.info(`Successfully generated response using ${result.model_used} for session ${sessionId}`);

            res.json({
                success: true,
                data: result,
                sessionId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            logger.error('Response generation failed:', error.message);
            next(error);
        }
    }

    async generateSingleResponse(req, res, next) {
        try {
            const { message, temperature, max_tokens } = req.body;

            const result = await aiService.getSingleResponse(message, {
                temperature,
                max_tokens
            });

            logger.info(`Successfully generated single response using ${result.model_used}`);

            res.json({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            logger.error('Single response generation failed:', error.message);
            next(error);
        }
    }

    async getConversation(req, res, next) {
        try {
            const { sessionId } = req.params;

            const stats = conversationService.getConversationStats(sessionId);

            if (!stats) {
                return res.status(404).json({
                    success: false,
                    error: 'Conversation not found'
                });
            }

            const messages = conversationService.getFormattedMessages(sessionId);

            res.json({
                success: true,
                data: {
                    stats,
                    messages
                }
            });

        } catch (error) {
            logger.error('Get conversation failed:', error.message);
            next(error);
        }
    }

    async clearConversation(req, res, next) {
        try {
            const { sessionId } = req.params;

            conversationService.clearConversation(sessionId);

            res.json({
                success: true,
                message: `Conversation ${sessionId} cleared`
            });

        } catch (error) {
            logger.error('Clear conversation failed:', error.message);
            next(error);
        }
    }

    async getHealth(req, res) {
        try {
            const modelStatus = aiService.getModelStatus();

            // Cleanup expired sessions
            const cleanedSessions = conversationService.cleanupExpiredSessions();

            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                models: modelStatus,
                active_sessions: conversationService.conversations.size,
                cleaned_sessions: cleanedSessions
            });
        } catch (error) {
            console.log(error)
            res.status(500).json({
                status: 'unhealthy',
                error: error.message
            });
        }
    }
}

module.exports = new AIController();