
const routeScanner = require('../config/routeScanner');

class SwaggerGenerator {
    constructor() {
        this.routes = new Map();
        this.schemas = new Map();
        this.tags = new Set();
        this.autoDiscovery = true;
    }

    // Auto-discover all routes
    discoverRoutes() {
        if (!this.autoDiscovery) return;

        console.log('🔍 Auto-discovering routes...');
        const discoveredRoutes = routeScanner.scanAllRoutes();
        // Add discovered routes to swagger
        for (const [key, route] of discoveredRoutes) {
            this.addRoute(route.method, route.path, {
                summary: route.summary,
                description: route.description,
                tags: route.tags,
                responses: route.responses,
                requestBody: route.requestBody,
                parameters: route.parameters
            });
        }
    }

    // Generate spec with auto-discovery
    generateSpec() {
        // Auto-discover routes first
        this.discoverRoutes();

        const paths = {};

        // Convert routes to OpenAPI paths
        for (const [key, route] of this.routes) {
            // console.log({ key, route })
            if (!paths[route.path]) {
                paths[route.path] = {};
            }

            paths[route.path][route.method] = this.buildOperation(route);
        }

        return {
            openapi: '3.0.0',
            info: {
                title: 'API Documentation',
                version: '1.0.0',
                description: `Total: ${this.routes.size} Apis`,
            },
            tags: Array.from(this.tags).map(tag => ({
                name: tag,
                description: `${tag} related endpoints`
            })),
            paths,
            components: {
                schemas: {
                    ...Object.fromEntries(this.schemas),
                    // Add generic schemas for auto-discovered routes
                    GenericRequest: {
                        type: 'object',
                        properties: {
                            data: { type: 'object', description: 'Request payload' }
                        }
                    },
                    GenericResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean' },
                            data: { type: 'object', description: 'Response data' },
                            message: { type: 'string' }
                        }
                    },
                    ErrorResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: { type: 'string' },
                            details: { type: 'string' }
                        }
                    }
                }
            }
        };
    }

    // Add manual route (overrides auto-discovery)
    addRoute(method, path, config) {
        const key = `${method.toUpperCase()}:${path}`;
        this.routes.set(key, {
            method: method.toLowerCase(),
            path,
            ...config
        });

        if (config.tags) {
            config.tags.forEach(tag => this.tags.add(tag));
        }
    }

    // Add schema
    addSchema(name, schema) {
        this.schemas.set(name, schema);
    }

    // Build operation object
    buildOperation(route) {
        const operation = {
            summary: route.summary,
            description: route.description,
            tags: route.tags || []
        };

        if (route.parameters) {
            operation.parameters = route.parameters;
        }

        if (route.requestBody) {
            operation.requestBody = route.requestBody;
        }

        operation.responses = route.responses || {
            200: { description: 'Success' },
            400: { description: 'Bad Request' },
            500: { description: 'Internal Server Error' }
        };

        return operation;
    }

    // Enable/disable auto-discovery
    setAutoDiscovery(enabled) {
        this.autoDiscovery = enabled;
    }

    // Get statistics
    getStats() {
        return {
            totalRoutes: this.routes.size,
            totalSchemas: this.schemas.size,
            totalTags: this.tags.size,
            autoDiscovery: this.autoDiscovery
        };
    }
}

module.exports = new SwaggerGenerator();
