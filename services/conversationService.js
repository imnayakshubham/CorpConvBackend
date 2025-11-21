const logger = require('../utils/logger');

class ConversationService {
    constructor() {
        // In-memory storage for conversations (use Redis/DB in production)
        this.conversations = new Map();
        this.maxHistoryLength = 20; // Keep last 20 messages
        this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
    }

    getConversation(sessionId) {
        const conversation = this.conversations.get(sessionId);

        if (!conversation) {
            return this.createConversation(sessionId);
        }

        // Check if session has expired
        if (Date.now() - conversation.lastActivity > this.sessionTimeout) {
            logger.info(`Session ${sessionId} expired, creating new conversation`);
            return this.createConversation(sessionId);
        }

        return conversation;
    }

    createConversation(sessionId) {
        const conversation = {
            sessionId,
            messages: [],
            createdAt: Date.now(),
            lastActivity: Date.now(),
            totalMessages: 0
        };

        this.conversations.set(sessionId, conversation);
        logger.info(`Created new conversation for session: ${sessionId}`);
        return conversation;
    }

    addMessage(sessionId, role, content, metadata = {}) {
        const conversation = this.getConversation(sessionId);

        const message = {
            role,
            content,
            timestamp: Date.now(),
            ...metadata
        };

        conversation.messages.push(message);
        conversation.lastActivity = Date.now();
        conversation.totalMessages++;

        // Trim history if too long (keep system message + recent messages)
        if (conversation.messages.length > this.maxHistoryLength) {
            const systemMessages = conversation.messages.filter(msg => msg.role === 'system');
            const recentMessages = conversation.messages
                .filter(msg => msg.role !== 'system')
                .slice(-this.maxHistoryLength + systemMessages.length);

            conversation.messages = [...systemMessages, ...recentMessages];
            logger.info(`Trimmed conversation history for session: ${sessionId}`);
        }

        return conversation;
    }

    getFormattedMessages(sessionId) {
        const conversation = this.getConversation(sessionId);

        return conversation.messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    clearConversation(sessionId) {
        this.conversations.delete(sessionId);
        logger.info(`Cleared conversation for session: ${sessionId}`);
    }

    getConversationStats(sessionId) {
        const conversation = this.conversations.get(sessionId);

        if (!conversation) {
            return null;
        }

        return {
            sessionId: conversation.sessionId,
            messageCount: conversation.messages.length,
            totalMessages: conversation.totalMessages,
            createdAt: new Date(conversation.createdAt).toISOString(),
            lastActivity: new Date(conversation.lastActivity).toISOString(),
            duration: Date.now() - conversation.createdAt
        };
    }

    // Cleanup expired conversations (call periodically)
    cleanupExpiredSessions() {
        const now = Date.now();
        let cleaned = 0;

        for (const [sessionId, conversation] of this.conversations.entries()) {
            if (now - conversation.lastActivity > this.sessionTimeout) {
                this.conversations.delete(sessionId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.info(`Cleaned up ${cleaned} expired conversations`);
        }

        return cleaned;
    }
}

module.exports = new ConversationService();
