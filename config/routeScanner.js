const fs = require('fs');
const path = require('path');

class RouteScanner {
    constructor(routesDir = './routes') {
        this.routesDir = path.resolve(routesDir);
        this.discoveredRoutes = new Map();
    }

    // Scan all route files
    scanAllRoutes() {
        const routeFiles = [...this.getRouteFiles(), path.resolve("index.js")]
        routeFiles.forEach(file => {
            console.log(`📄 Scanning route file: ${file}`);
            this.scanRouteFile(file);
        });

        console.log(`✅ Discovered ${this.discoveredRoutes.size} route definitions`);
        return this.discoveredRoutes;
    }

    // Get all .js files in routes directory
    getRouteFiles() {
        return fs.readdirSync(this.routesDir)
            .filter(file => file.endsWith('.js'))
            .map(file => {
                return path.join(this.routesDir, file)
            });
    }

    // Extract routes from a single file
    scanRouteFile(filePath) {
        const fileName = path.basename(filePath, '.js');
        const fileContent = fs.readFileSync(filePath, 'utf8');

        // Extract route definitions using multiple patterns
        const routes = this.extractRoutesFromContent(fileContent, fileName);

        routes.forEach(route => {
            const key = `${route.method}:${route.path}`;
            this.discoveredRoutes.set(key, {
                ...route,
                file: fileName,
                filePath
            });
        });
    }

    // Extract routes using multiple detection methods
    extractRoutesFromContent(content, fileName) {
        const routes = [];

        // Method 1: Extract from router.method() calls
        const routerMatches = content.match(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g);
        if (routerMatches) {
            routerMatches.forEach(match => {
                const [, method, path] = match.match(/router\.(\w+)\s*\(\s*['"`]([^'"`]+)['"`]/);

                routes.push(this.createRouteDefinition(method, path, fileName, content));
            });
        }

        // Method 2: Extract from app.method() calls
        const appMatches = content.match(/app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g);
        if (appMatches) {
            appMatches.forEach(match => {
                const [, method, path] = match.match(/app\.(\w+)\s*\(\s*['"`]([^'"`]+)['"`]/);
                routes.push(this.createRouteDefinition(method, path, fileName, content));
            });
        }

        // Method 3: Extract from router.route() chains - NEW
        const routeMatches = this.extractRouterRoutes(content, fileName);
        routes.push(...routeMatches);

        return routes;
    }

    // NEW: Extract router.route() patterns
    extractRouterRoutes(content, fileName) {
        const routes = [];
        const chainPattern = /router\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)((?:\s*\.\s*(?:get|post|put|delete|patch|head|options|all)\s*\([^)]*\))*)/g;
        let match;

        while ((match = chainPattern.exec(content)) !== null) {
            const routePath = match[1];
            const chainMethods = match[2] || '';
            // Method pattern for each chained call
            const methodPattern = /\.\s*(get|post|put|delete|patch|head|options|all)\s*\(\s*([^)]*?)\s*\)/g;
            methodPattern.lastIndex = 0;

            let methodMatch;
            while ((methodMatch = methodPattern.exec(chainMethods)) !== null) {
                const method = methodMatch[1];
                const middlewareAndHandler = methodMatch[2];

                const route = this.createRouteDefinition(method, routePath, fileName, content);
                const middlewareInfo = this.extractMiddlewareFromChain(middlewareAndHandler.trim());

                if (middlewareInfo.hasProtection) {
                    route.security = [{ bearerAuth: [] }];
                }
                if (middlewareInfo.hasValidation) {
                    route.requestBody = {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/GenericRequest' }
                            }
                        }
                    };
                }

                route.metadata = {
                    fullMatch: match[0].trim(),
                    methodMatch: methodMatch[0].trim(),
                    rawMiddleware: middlewareAndHandler.trim()
                };

                routes.push(route);
            }
        }

        return routes;
    }


    // Extract middleware information from method parameters
    extractMiddlewareFromChain(paramString) {
        const info = {
            hasProtection: false,
            hasValidation: false,
            middlewares: []
        };

        // Common protection middleware patterns
        const protectionPatterns = [
            'protect', 'authenticate', 'auth', 'requireAuth',
            'isAuthenticated', 'verifyToken', 'checkAuth'
        ];

        // Common validation middleware patterns
        const validationPatterns = [
            'validate', 'validateBody', 'validateParams', 'validateQuery',
            'validation', 'check', 'sanitize'
        ];

        // Extract all parameters/middleware names
        const params = paramString.split(',').map(p => p.trim());

        params.forEach(param => {
            // Remove whitespace and common characters
            const cleanParam = param.replace(/[\s\(\)]/g, '');

            // Check for protection middleware
            if (protectionPatterns.some(pattern => cleanParam.includes(pattern))) {
                info.hasProtection = true;
                info.middlewares.push('authentication');
            }

            // Check for validation middleware
            if (validationPatterns.some(pattern => cleanParam.includes(pattern))) {
                info.hasValidation = true;
                info.middlewares.push('validation');
            }
        });

        return info;
    }

    // Create swagger definition for discovered route
    createRouteDefinition(method, path, fileName, fileContent) {
        const baseRoute = {
            method: method.toLowerCase(),
            path: this.normalizeRoutePath(path, fileName),
            summary: this.generateSummary(method, path),
            description: this.generateDescription(method, path, fileName),
            tags: [this.generateTag(fileName)],
            responses: this.generateResponses(method)
        };

        // Try to extract additional info from code
        const controllerInfo = this.extractControllerInfo(fileContent, path);
        const validationInfo = this.extractValidationInfo(fileContent, path);

        if (controllerInfo.requestBody) {
            baseRoute.requestBody = controllerInfo.requestBody;
        }

        if (controllerInfo.parameters) {
            baseRoute.parameters = controllerInfo.parameters;
        }

        // Add security if protection middleware detected
        if (controllerInfo.hasProtection) {
            baseRoute.security = [{ bearerAuth: [] }];
        }

        return baseRoute;
    }

    // Enhanced controller info extraction
    extractControllerInfo(content, path) {
        const info = {};

        // Look for protection middleware
        const protectionPatterns = ['protect', 'authenticate', 'auth', 'requireAuth'];
        if (protectionPatterns.some(pattern => content.includes(pattern))) {
            info.hasProtection = true;
        }

        // Look for validation middleware patterns
        if (content.includes('validate') || content.includes('check')) {
            info.requestBody = {
                required: true,
                content: {
                    'application/json': {
                        schema: this.determineSchemaFromPath(path)
                    }
                }
            };
        }

        // Look for path parameters
        const paramMatches = path.match(/:(\w+)/g);
        if (paramMatches) {
            info.parameters = paramMatches.map(param => ({
                in: 'path',
                name: param.slice(1), // Remove :
                required: true,
                schema: { type: 'string' },
                description: `The ${param.slice(1)} parameter`
            }));
        }

        return info;
    }

    // Determine appropriate schema based on route path
    determineSchemaFromPath(path) {
        const pathLower = path.toLowerCase();

        // Chat-related endpoints
        if (pathLower.includes('chat')) {
            return { $ref: '#/components/schemas/ChatRequest' };
        }

        // Message-related endpoints
        if (pathLower.includes('message')) {
            return { $ref: '#/components/schemas/MessageRequest' };
        }

        // User-related endpoints
        if (pathLower.includes('user')) {
            return { $ref: '#/components/schemas/UserRequest' };
        }

        // Default generic request
        return { $ref: '#/components/schemas/GenericRequest' };
    }

    // Normalize route path for OpenAPI
    normalizeRoutePath(path, fileName) {
        // Add base path based on filename
        const basePath = fileName === 'index' ? '' : `/${fileName}`;
        const fullPath = `${basePath}${path}`;
        // Convert Express params to OpenAPI format
        return fullPath.replace(/:(\w+)/g, '{$1}');
    }

    // Generate meaningful summary based on path patterns
    generateSummary(method, path) {
        const action = this.getActionFromMethod(method);
        const resource = this.getResourceFromPath(path);

        // Special handling for common patterns
        if (path.includes('chat-list') || path.includes('chats')) {
            return `${action} chat conversations`;
        }

        if (path.includes('message')) {
            return `${action} message`;
        }

        return `${action} ${resource}`;
    }

    // Enhanced description generation
    generateDescription(method, path, fileName) {
        let description = `${method.toUpperCase()} endpoint for ${path} in ${fileName} module.`;

        // Add specific descriptions for common patterns
        if (path.includes('chat-list')) {
            description += ' Retrieves list of chat conversations for the authenticated user.';
        } else if (path.includes('chat') && method === 'post') {
            description += ' Creates a new chat conversation or sends a message.';
        } else if (path.includes('protect')) {
            description += ' Requires authentication.';
        }

        return description;
    }

    // Generate tag from filename with better formatting
    generateTag(fileName) {
        return fileName
            .replace(/([A-Z])/g, ' $1') // Add space before capital letters
            .replace(/[-_]/g, ' ') // Replace hyphens and underscores with spaces
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    // Enhanced response generation based on method and path
    generateResponses(method, path = '') {
        const baseResponses = {
            400: {
                description: 'Bad Request',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ErrorResponse' }
                    }
                }
            },
            401: {
                description: 'Unauthorized - Authentication required',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ErrorResponse' }
                    }
                }
            },
            500: {
                description: 'Internal Server Error',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ErrorResponse' }
                    }
                }
            }
        };

        // Success responses based on method
        if (method === 'post') {
            baseResponses[201] = {
                description: 'Created successfully',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/SuccessResponse' }
                    }
                }
            };
        }

        if (method === 'delete') {
            baseResponses[200] = {
                description: 'Deleted successfully',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/SuccessResponse' }
                    }
                }
            };
        } else {
            baseResponses[200] = {
                description: 'Success',
                content: {
                    'application/json': {
                        schema: this.getResponseSchemaForPath(path)
                    }
                }
            };
        }

        return baseResponses;
    }

    // Get appropriate response schema based on path
    getResponseSchemaForPath(path) {
        const pathLower = path.toLowerCase();

        if (pathLower.includes('chat-list') || pathLower.includes('chats')) {
            return { $ref: '#/components/schemas/ChatListResponse' };
        }

        if (pathLower.includes('message')) {
            return { $ref: '#/components/schemas/MessageResponse' };
        }

        return { $ref: '#/components/schemas/GenericResponse' };
    }

    // Helper methods (keeping existing ones)
    getActionFromMethod(method) {
        const actions = {
            get: 'Retrieve',
            post: 'Create',
            put: 'Update',
            delete: 'Delete',
            patch: 'Modify'
        };
        return actions[method.toLowerCase()] || 'Process';
    }

    getResourceFromPath(path) {
        // Extract resource name from path, handling special cases
        const segments = path.split('/').filter(s => s && !s.startsWith(':'));

        if (segments.length === 0) return 'resource';

        const lastSegment = segments[segments.length - 1];

        // Handle hyphenated names
        return lastSegment.replace(/-/g, ' ');
    }

    extractValidationInfo(content, path) {
        // Enhanced validation detection
        return {};
    }
}

module.exports = new RouteScanner();
