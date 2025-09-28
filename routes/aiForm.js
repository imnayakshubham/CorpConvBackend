import express from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { cohere } from '@ai-sdk/cohere';
import { groq } from '@ai-sdk/groq';
import { generateText, streamText } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, requirePremium } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting for AI operations
const aiGenerateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Limit each user to 20 AI requests per 5 minutes
  message: { error: 'Too many AI requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const aiChatLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each user to 10 chat messages per minute
  message: { error: 'Too many chat messages, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware
const validateAIGenerate = [
  body('messages')
    .isArray()
    .withMessage('Messages must be an array')
    .custom((messages) => {
      if (messages.length === 0) {
        throw new Error('Messages array cannot be empty');
      }
      return true;
    }),
  body('messages.*.role')
    .isIn(['user', 'assistant', 'system'])
    .withMessage('Invalid message role'),
  body('messages.*.content')
    .isString()
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Message content must be between 1 and 5000 characters'),
  body('sessionId')
    .optional()
    .isString()
    .withMessage('Session ID must be a string')
];

const validateChatHistory = [
  body('sessionId')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Session ID is required')
];

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Helper function to get AI model based on environment
function getAIModel() {
  const aiProvider = process.env.AI_PROVIDER || 'groq';
  const modelName = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';

  if (aiProvider === 'cohere' && process.env.COHERE_API_KEY) {
    return cohere('command-r-plus');
  } else if (process.env.GROQ_API_KEY) {
    return groq(modelName);
  } else {
    throw new Error('No AI provider configured. Please set GROQ_API_KEY or COHERE_API_KEY');
  }
}

// Store for chat sessions (in production, use Redis or database)
const chatSessionStore = new Map();

// Get system prompt for form generation
const getFormGenerationPrompt = () => {
  return process.env.AI_FORM_SYSTEM_PROMPT || `You are an expert form builder AI. Your task is to create form schemas based on user requirements.

IMPORTANT: You must respond with ONLY a valid JSON object representing the form schema. Do not include any explanations, markdown formatting, or additional text.

The JSON schema must follow this exact structure:
{
  "title": "Form Title",
  "description": "Form description",
  "fields": [
    {
      "id": "unique_field_id",
      "type": "text|email|number|textarea|select|radio|checkbox|file|date|url|tel",
      "label": "Field Label",
      "placeholder": "Placeholder text (optional)",
      "required": true|false,
      "options": [{"label": "Option 1", "value": "value1"}] // Only for select, radio, checkbox
    }
  ],
  "settings": {
    "submitButtonText": "Submit",
    "successMessage": "Thank you for your submission!"
  }
}

Supported field types:
- text: Single line text input
- email: Email input with validation
- number: Numeric input
- textarea: Multi-line text input
- select: Dropdown selection
- radio: Single choice from multiple options
- checkbox: Multiple choice options
- file: File upload
- date: Date picker
- url: URL input with validation
- tel: Phone number input

Always create meaningful field IDs (no spaces, use underscores or camelCase).
Make labels descriptive and user-friendly.
Set appropriate required status based on form context.
Include helpful placeholder text when relevant.`;
};

// Get system prompt for chat assistance
const getChatAssistantPrompt = () => {
  return `You are a helpful AI assistant specializing in form creation and design. You help users build forms by:

1. Understanding their requirements
2. Suggesting form structures and field types
3. Providing best practices for form design
4. Helping improve existing forms
5. Answering questions about form functionality

Keep responses concise, helpful, and focused on form building. Ask clarifying questions when needed to better understand user requirements.`;
};

// Generate form schema using AI
const generateFormWithAI = async (messages) => {
  try {
    const model = getAIModel();
    const systemPrompt = getFormGenerationPrompt();

    const result = await generateText({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      maxTokens: 2000,
    });

    // Parse the AI response as JSON
    let formSchema;
    try {
      formSchema = JSON.parse(result.text.trim());
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', result.text);
      throw new Error('AI returned invalid JSON format');
    }

    // Validate the schema structure
    if (!formSchema.title || !formSchema.fields || !Array.isArray(formSchema.fields)) {
      throw new Error('AI returned invalid form schema structure');
    }

    return formSchema;
  } catch (error) {
    console.error('AI form generation error:', error);

    // Fallback to a basic form if AI fails
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage.content.toLowerCase();

    if (prompt.includes('contact') || prompt.includes('email')) {
      return {
        title: "Contact Form",
        description: "A simple contact form for getting in touch",
        fields: [
          {
            id: "name",
            type: "text",
            label: "Full Name",
            required: true,
            placeholder: "Enter your full name"
          },
          {
            id: "email",
            type: "email",
            label: "Email Address",
            required: true,
            placeholder: "Enter your email"
          },
          {
            id: "message",
            type: "textarea",
            label: "Message",
            required: true,
            placeholder: "Enter your message"
          }
        ],
        settings: {
          submitButtonText: "Send Message",
          successMessage: "Thank you for your message! We'll get back to you soon."
        }
      };
    }

    // Default fallback form
    return {
      title: "Custom Form",
      description: "A form generated based on your requirements",
      fields: [
        {
          id: "field1",
          type: "text",
          label: "Text Field",
          required: true,
          placeholder: "Enter text here"
        }
      ],
      settings: {
        submitButtonText: "Submit",
        successMessage: "Thank you for your submission!"
      }
    };
  }
};

// @route   POST /api/ai/generate-form
// @desc    Generate a form using AI
// @access  Private (Premium)
router.post('/generate-form',
  authenticateToken,
  requirePremium,
  aiGenerateLimit,
  validateAIGenerate,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { messages, sessionId } = req.body;

      // Sanitize messages
      const sanitizedMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content.trim()
      }));

      // Generate form using AI
      const formSchema = await generateFormWithAI(sanitizedMessages);

      // TODO: Save chat message to database for history
      // await saveAIBuilderMessage(req.user._id, sessionId, messages, formSchema);

      res.json({
        success: true,
        data: {
          formSchema,
          sessionId: sessionId || `ai-session-${Date.now()}`,
          message: 'Form generated successfully'
        }
      });

    } catch (error) {
      console.error('AI form generation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate form',
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @route   POST /api/ai/chat
// @desc    Continue AI chat conversation
// @access  Private (Premium)
router.post('/chat',
  authenticateToken,
  requirePremium,
  aiChatLimit,
  validateAIGenerate,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { messages, sessionId } = req.body;

      // Sanitize messages
      const sanitizedMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content.trim()
      }));

      // Get or create session
      const currentSessionId = sessionId || uuidv4();
      let conversationHistory = chatSessionStore.get(currentSessionId) || [];

      // Add user message to conversation history
      conversationHistory.push({ role: 'user', content: sanitizedMessages[sanitizedMessages.length - 1].content });

      // Generate AI response
      const model = getAIModel();
      const systemPrompt = getChatAssistantPrompt();

      const result = await generateText({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationHistory
        ],
        temperature: 0.8,
        maxTokens: 500,
      });

      const aiResponse = result.text;

      // Add AI response to conversation history
      conversationHistory.push({ role: 'assistant', content: aiResponse });

      // Store conversation (limit to last 20 messages)
      if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-20);
      }
      chatSessionStore.set(currentSessionId, conversationHistory);

      // TODO: Save to database
      // await saveAIChatMessage(req.user._id, sessionId, lastUserMessage, aiResponse);

      res.json({
        success: true,
        data: {
          response: aiResponse,
          sessionId: currentSessionId
        }
      });

    } catch (error) {
      console.error('AI chat error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process chat message',
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @route   POST /api/ai/chat/stream
// @desc    Continue AI chat conversation with streaming
// @access  Private (Premium)
router.post('/chat/stream',
  authenticateToken,
  requirePremium,
  aiChatLimit,
  validateAIGenerate,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { messages, sessionId } = req.body;

      // Sanitize messages
      const sanitizedMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content.trim()
      }));

      // Get or create session
      const currentSessionId = sessionId || uuidv4();
      let conversationHistory = chatSessionStore.get(currentSessionId) || [];

      // Add user message to conversation history
      conversationHistory.push({ role: 'user', content: sanitizedMessages[sanitizedMessages.length - 1].content });

      // Set headers for streaming
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Generate AI response with streaming
      const model = getAIModel();
      const systemPrompt = getChatAssistantPrompt();

      const result = await streamText({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationHistory
        ],
        temperature: 0.8,
        maxTokens: 500,
      });

      let fullResponse = '';

      for await (const delta of result.textStream) {
        fullResponse += delta;
        res.write(delta);
      }

      // Add AI response to conversation history
      conversationHistory.push({ role: 'assistant', content: fullResponse });

      // Store conversation (limit to last 20 messages)
      if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-20);
      }
      chatSessionStore.set(currentSessionId, conversationHistory);

      res.end();

    } catch (error) {
      console.error('AI chat streaming error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process chat message',
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @route   GET /api/ai/chat/history/:sessionId
// @desc    Get chat history for a session
// @access  Private (Premium)
router.get('/chat/history/:sessionId',
  authenticateToken,
  requirePremium,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      // Get conversation history from store
      const conversationHistory = chatSessionStore.get(sessionId) || [];

      const history = {
        sessionId,
        messages: conversationHistory.map(msg => ({
          ...msg,
          timestamp: new Date().toISOString()
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      res.json({
        success: true,
        data: history
      });

    } catch (error) {
      console.error('Get chat history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get chat history',
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @route   DELETE /api/ai/chat/history/:sessionId
// @desc    Delete chat history for a session
// @access  Private (Premium)
router.delete('/chat/history/:sessionId',
  authenticateToken,
  requirePremium,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      // Delete conversation history from store
      chatSessionStore.delete(sessionId);

      res.json({
        success: true,
        message: 'Chat history deleted successfully'
      });

    } catch (error) {
      console.error('Delete chat history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete chat history',
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @route   GET /api/ai/status
// @desc    Get AI service status
// @access  Private
router.get('/status', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'available',
      features: {
        formGeneration: true,
        chatAssistant: true,
        premium: req.user.hasPremium || true // Since payment is disabled
      },
      limits: {
        generatePerDay: 100,
        chatMessagesPerHour: 50
      }
    }
  });
});

export default router;