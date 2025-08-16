const swaggerUi = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');

// Only create swagger spec in non-production environments
function createSwaggerSpec() {
    if (process.env.NODE_ENV === 'production') {
        return null; // No docs in production
    }

    const options = {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'API Documentation',
                version: '1.0.0',
                description: 'Development API documentation',
            },
        },
        apis: ['./routes/*.js'],
    };

    return swaggerJSDoc(options);
}

const swaggerSpec = createSwaggerSpec();

module.exports = {
    swaggerUi: process.env.NODE_ENV === 'production' ? null : swaggerUi,
    swaggerSpec,
    isDocsEnabled: process.env.NODE_ENV !== 'production'
};
