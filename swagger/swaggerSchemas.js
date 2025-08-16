const swaggerGenerator = require('./swaggerGenerator');

// Define all required schemas including the missing ones
const schemas = {
    // Add the missing SuccessResponse schema
    SuccessResponse: {
        type: 'object',
        properties: {
            success: {
                type: 'boolean',
                example: true
            },
            message: {
                type: 'string',
                example: 'Operation completed successfully'
            },
            data: {
                type: 'object',
                description: 'Optional response data'
            }
        }
    },

    // Add GenericRequest schema
    GenericRequest: {
        type: 'object',
        properties: {
            data: {
                type: 'object',
                description: 'Request payload'
            }
        }
    },

    // Add GenericResponse schema  
    GenericResponse: {
        type: 'object',
        properties: {
            success: {
                type: 'boolean',
                example: true
            },
            data: {
                type: 'object',
                description: 'Response data'
            },
            message: {
                type: 'string',
                description: 'Response message'
            }
        }
    },

    // Add ErrorResponse schema
    ErrorResponse: {
        type: 'object',
        properties: {
            success: {
                type: 'boolean',
                example: false
            },
            error: {
                type: 'string',
                example: 'Something went wrong'
            },
            message: {
                type: 'string',
                example: 'Error description'
            },
            details: {
                type: 'string',
                description: 'Additional error details'
            }
        }
    },

    // User-specific schemas
    UserRequest: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                example: 'John Doe'
            },
            email: {
                type: 'string',
                format: 'email',
                example: 'john@example.com'
            }
        }
    },

    FollowRequestResponse: {
        type: 'object',
        properties: {
            success: {
                type: 'boolean',
                example: true
            },
            message: {
                type: 'string',
                example: 'Follow request rejected successfully'
            },
            data: {
                type: 'object',
                properties: {
                    requestId: {
                        type: 'string',
                        example: 'req_123456'
                    },
                    status: {
                        type: 'string',
                        enum: ['rejected', 'accepted', 'pending'],
                        example: 'rejected'
                    }
                }
            }
        }
    },

    // Chat-related schemas
    ChatRequest: {
        type: 'object',
        required: ['message'],
        properties: {
            message: {
                type: 'string',
                description: 'The chat message',
                example: 'Hello, how can I help you today?'
            },
            chatId: {
                type: 'string',
                description: 'Chat conversation ID',
                example: 'chat_123456'
            }
        }
    },

    MessageRequest: {
        type: 'object',
        required: ['content'],
        properties: {
            content: {
                type: 'string',
                description: 'Message content',
                example: 'What is artificial intelligence?'
            },
            type: {
                type: 'string',
                enum: ['text', 'image', 'file'],
                default: 'text'
            }
        }
    },

    ChatListResponse: {
        type: 'object',
        properties: {
            success: {
                type: 'boolean',
                example: true
            },
            data: {
                type: 'object',
                properties: {
                    chats: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: {
                                    type: 'string',
                                    example: 'chat_123456'
                                },
                                title: {
                                    type: 'string',
                                    example: 'AI Conversation'
                                },
                                lastMessage: {
                                    type: 'string',
                                    example: 'Hello, how are you?'
                                },
                                updatedAt: {
                                    type: 'string',
                                    format: 'date-time'
                                }
                            }
                        }
                    },
                    total: {
                        type: 'integer',
                        example: 5
                    }
                }
            }
        }
    },

    MessageResponse: {
        type: 'object',
        properties: {
            success: {
                type: 'boolean',
                example: true
            },
            data: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        example: 'msg_789012'
                    },
                    content: {
                        type: 'string',
                        example: 'AI response here...'
                    },
                    timestamp: {
                        type: 'string',
                        format: 'date-time'
                    }
                }
            }
        }
    }
};

// Register all schemas with the swagger generator
Object.entries(schemas).forEach(([name, schema]) => {
    swaggerGenerator.addSchema(name, schema);
});

module.exports = schemas;
