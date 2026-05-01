const mongoose = require("mongoose");
const User = require("../models/userModel");
const { projection } = require("../constants");
const cacheTTL = require("../redisClient/cacheTTL");

let _auth;

const getAuth = async () => {
    if (!_auth) {
        if (mongoose.connection.readyState !== 1) {
            throw new Error("Database not connected yet. Cannot initialize Better Auth.");
        }
        // Ensure mongoose.connection.db is available (Mongoose 8.x timing)
        const db = mongoose.connection.db || await mongoose.connection.asPromise().then(() => mongoose.connection.db);
        if (!db) {
            throw new Error("Database connection established but db instance not available.");
        }

        // Dynamic imports for ESM-only packages
        const { betterAuth } = await import("better-auth");
        const { mongodbAdapter } = await import("better-auth/adapters/mongodb");
        const { customSession, admin } = await import("better-auth/plugins");
        const { passkey } = await import("@better-auth/passkey");
        const { createAuthEndpoint } = await import("@better-auth/core/api");
        const { sensitiveSessionMiddleware } = await import("better-auth/api");
        const { setSessionCookie } = await import("better-auth/cookies");
        const { APIError } = await import("better-auth");

        const UserModel = require("../models/userModel");
        const BackupCode = require("../models/backupCodesModel");
        const z = require("zod");

        const accountRecoveryPlugin = () => ({
            id: "account-recovery",
            endpoints: {
                // better-auth's built-in setPassword is created without an HTTP path,
                // so it never gets registered in the router. This re-exposes it with
                // an explicit /set-password path so OAuth-only users can add a password.
                setPassword: createAuthEndpoint(
                    "/set-password",
                    {
                        method: "POST",
                        body: z.object({ newPassword: z.string() }).strict(),
                        use: [sensitiveSessionMiddleware],
                    },
                    async (ctx) => {
                        const { newPassword } = ctx.body;
                        const session = ctx.context.session;
                        const minLen = ctx.context.password.config.minPasswordLength;
                        const maxLen = ctx.context.password.config.maxPasswordLength;
                        if (newPassword.length < minLen) {
                            throw new APIError("BAD_REQUEST", { message: "Password is too short" });
                        }
                        if (newPassword.length > maxLen) {
                            throw new APIError("BAD_REQUEST", { message: "Password is too long" });
                        }
                        const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
                        const credAccount = accounts.find(a => a.providerId === "credential" && a.password);
                        if (credAccount) {
                            throw new APIError("BAD_REQUEST", { message: "user already has a password" });
                        }
                        const passwordHash = await ctx.context.password.hash(newPassword);
                        await ctx.context.internalAdapter.linkAccount({
                            userId: session.user.id,
                            providerId: "credential",
                            accountId: session.user.id,
                            password: passwordHash,
                        });
                        return ctx.json({ status: true });
                    }
                ),
                signInAccountRecovery: createAuthEndpoint(
                    "/sign-in/account-recovery",
                    {
                        method: "POST",
                        body: z.object({
                            email: z.string().email().max(254),
                            backupCode: z.string().regex(/^[A-Fa-f0-9]{5}-[A-Fa-f0-9]{5}$/i, "Invalid backup code format"),
                        }).strict(),
                        metadata: { openapi: { description: "Recover account using backup code" } },
                    },
                    async (ctx) => {
                        const { email, backupCode } = ctx.body;
                        const ip =
                            ctx.request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                            ctx.request?.headers?.get("x-real-ip") ||
                            "unknown";

                        const normalizedEmail = email.toLowerCase().trim();
                        const user = await UserModel.findOne({
                            $or: [
                                { user_email_id: normalizedEmail },
                                { secondary_email_id: normalizedEmail, is_secondary_email_id_verified: true },
                            ],
                        });

                        const INVALID_MSG = "Invalid email or backup code.";
                        if (!user || !user.access) {
                            throw new APIError("UNAUTHORIZED", { message: INVALID_MSG });
                        }

                        const result = await BackupCode.verifyCode(user._id, backupCode.toUpperCase(), ip);
                        if (!result.valid) {
                            throw new APIError("UNAUTHORIZED", { message: INVALID_MSG });
                        }

                        const baUser = await ctx.context.internalAdapter.findUserById(user._id.toString());
                        if (!baUser) {
                            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to load user" });
                        }

                        const session = await ctx.context.internalAdapter.createSession(baUser.id);
                        if (!session) {
                            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
                        }

                        await setSessionCookie(ctx, { session, user: baUser });

                        return ctx.json({
                            status: "Success",
                            message: "Recovery successful. You are now logged in.",
                            remainingCodes: result.remaining,
                        });
                    }
                ),
            },
            rateLimit: [{
                pathMatcher(path) { return path === "/sign-in/account-recovery"; },
                window: 900,
                max: 5,
            }],
        });

        const superAdminIds = process.env.SUPER_ADMIN_IDS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];

        db.collection("verification").deleteMany({ id: null })


        // Parse ALLOW_ORIGIN from env
        const allowedOrigins = process.env.ALLOW_ORIGIN ? process.env.ALLOW_ORIGIN.split(",").map(o => o.trim()) : [];

        console.log("[Better Auth] Initializing with allowedOrigins:", allowedOrigins, process.env.GOOGLE_REDIRECT_URI);

        _auth = betterAuth({
            baseURL: process.env.BETTER_AUTH_URL,
            database: mongodbAdapter(db),
            appName: "hushwork",
            emailAndPassword: {
                enabled: true,
            },
            trustedOrigins: allowedOrigins,
            user: {
                modelName: "users",
                fields: {
                    userId: "_id",
                    email: "user_email_id",
                    username: "actual_user_name",
                    name: "actual_user_name",
                    phone: "user_phone_number",
                    image: "actual_profile_pic"
                },
                additionalFields: {
                    public_user_name: {
                        type: "string",
                        defaultValue: "Someone"
                    },
                    is_email_verified: {
                        type: "boolean",
                        defaultValue: false,
                    },
                    user_location: {
                        type: "string",
                        defaultValue: null
                    },
                    user_public_location: {
                        type: String,
                        default: null
                    },
                    user_job_role: {
                        type: "string",
                        defaultValue: null
                    },
                    user_job_experience: {
                        type: "number",
                        defaultValue: null
                    },
                    user_bio: {
                        type: "string",
                        defaultValue: null
                    },
                    is_admin: {
                        type: "boolean",
                        defaultValue: false,
                    },
                    user_public_profile_pic: {
                        type: "string",
                        defaultValue: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg",
                    },
                    provider: {
                        type: "string",
                        defaultValue: null
                    },
                    provider_id: {
                        type: "string",
                        defaultValue: null
                    },
                    is_anonymous: {
                        type: "boolean",
                        defaultValue: true,
                    },
                    access: {
                        type: "boolean",
                        defaultValue: true
                    },
                    meta_data: {
                        type: "object",
                        defaultValue: {}
                    },
                    user_current_company_name: {
                        type: "string",
                        defaultValue: "Somewhere",
                    },
                    user_company_id: {
                        type: "string",
                        defaultValue: null,
                    },
                    user_past_company_history: {
                        type: "object",
                        defaultValue: []
                    },
                    token: {
                        defaultValue: null,
                        type: "string",
                    },
                    followers: {
                        type: "object",
                        defaultValue: [],
                    },
                    followings: {
                        type: "object",
                        defaultValue: [],
                    },
                    pending_followings: {
                        type: "object",
                        defaultValue: []
                    },
                    secondary_email_id: {
                        type: "string",
                        defaultValue: null,
                    },
                    is_secondary_email_id_verified: {
                        defaultValue: false,
                        type: "boolean",
                    },
                    primary_email_domain: {
                        type: "string",
                        defaultValue: "",
                    },
                    secondary_email_domain: {
                        type: "string",
                        defaultValue: null,
                    },
                    academic_level: {
                        type: "string",
                        defaultValue: null
                    },
                    field_of_study: {
                        type: "string",
                        defaultValue: null
                    },
                    hobbies: {
                        type: "object",
                        defaultValue: []
                    },
                    gender: {
                        type: "string",
                        defaultValue: "prefer-not-to-say"
                    },
                    profession: {
                        type: "string",
                        defaultValue: null,
                    },
                    embedding: {
                        type: "object",
                        defaultValue: null
                    },
                    last_active_at: {
                        type: "date",
                        defaultValue: () => new Date()
                    },
                    email_verified_at: {
                        type: "date",
                        defaultValue: null
                    },
                    user_image: {
                        type: "string",
                        defaultValue: null
                    },
                    auth_methods: {
                        type: "object",
                        defaultValue: {
                            email: true,
                            google: true,
                            passkey: false
                        }
                    },
                    two_factor_enabled: {
                        type: "boolean",
                        defaultValue: false
                    },
                    is_masked: {
                        type: "boolean",
                        defaultValue: false,
                    },
                    has_premium: {
                        type: "boolean",
                        defaultValue: false,
                    },
                    premium_expires_at: {
                        type: "date",
                        defaultValue: null
                    },
                    premium_plan: {
                        type: "string",
                        defaultValue: "free",
                    },
                    avatar_config: {
                        type: "object",
                        defaultValue: {
                            style: "avataaars",
                            seed: null,
                            options: {}
                        }
                    },
                    qr_config: {
                        type: "object",
                        defaultValue: null
                    },
                    last_login_at: {
                        type: "date",
                        defaultValue: null
                    },
                    login_count: {
                        type: "number",
                        defaultValue: 0
                    },
                    usernameChangedAt: {
                        type: "date",
                        defaultValue: null
                    },
                    usernameHistory: {
                        type: "object",
                        defaultValue: []
                    },
                    username: {
                        type: "string",
                        defaultValue: null,
                    },
                    current_plan: {
                        type: "string",
                        defaultValue: "free",
                    },
                    ai_calls_this_month: {
                        type: "number",
                        defaultValue: 0,
                    },
                }
            },
            socialProviders: {
                google: {
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    prompt: "select_account",
                    scope: ["openid", "email", "profile"],
                    redirectURI: process.env.GOOGLE_REDIRECT_URI,
                },
            },

            advanced: {
                useSecureCookies: process.env.APP_ENV === 'PROD',
                database: {
                    idField: "_id",
                },

                cookies: {
                    session_token: {
                        attributes: {
                            httpOnly: true,
                            secure: process.env.APP_ENV === 'PROD',
                            sameSite: process.env.APP_ENV === 'PROD' ? 'none' : 'lax',
                            maxAge: 60 * 60 * 24 * 7, // 7 days in ms
                            path: '/',
                        }
                    },
                },
                crossSubDomainCookies: {
                    enabled: process.env.APP_ENV === 'PROD',
                    domain: process.env.APP_ENV === 'PROD' && process.env.FRONTEND_URL
                        ? `.${new URL(process.env.FRONTEND_URL).hostname.replace(/^www\./, '')}`
                        : undefined,
                },
            },
            databaseHooks: {
                user: {
                    create: {
                        after: async (user) => {
                            console.log({ user })
                            const cache = require('../redisClient/cacheHelper');
                            const eventBus = require('./eventBus');
                            const userId = user._id || user.id;
                            if (userId) {

                                const cacheKey = cache.generateKey('user', 'info', userId);
                                await cache.set(cacheKey, user, cacheTTL.USER_PROFILE);
                            }
                            eventBus.emit('user:signup', user);
                        },
                    },
                },
                session: {
                    create: {

                        after: async (session) => {

                            const cache = require('../redisClient/cacheHelper');
                            const eventBus = require('./eventBus');
                            const cacheKey = cache.generateKey('user', 'info', session.userId);
                            let user = await cache.get(cacheKey);
                            if (!user) {
                                const User = require('../models/userModel');
                                user = await User.findById(session.userId, projection).lean();
                                if (user) {
                                    await cache.set(cacheKey, user, cacheTTL.USER_PROFILE);
                                }
                            }
                            if (user) {
                                // Fetch email only for the Slack notification — never cached, never sent to client
                                const User = require('../models/userModel');
                                const emailDoc = await User.findById(session.userId, { user_email_id: 1, _id: 0 }).lean();
                                eventBus.emit('user:login', { ...user, user_email_id: emailDoc?.user_email_id });
                            }
                        },
                    },
                },
            },
            plugins: [
                accountRecoveryPlugin(),
                passkey({
                    rpID: process.env.APP_ENV === 'PROD' ? 'hushworknow.com' : 'localhost',
                    rpName: 'Hushwork',
                    origin: process.env.APP_ENV === 'PROD'
                        ? 'https://www.hushworknow.com'
                        : 'http://localhost:3005',
                }),
                admin({
                    defaultRole: "user",
                    adminUserIds: superAdminIds,
                }),
                customSession(async ({ user, session }) => {
                    const superAdminEmails = process.env.SUPER_ADMIN_IDS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];

                    const isSuperAdmin =
                        superAdminIds.includes(user?.id?.toString()) ||
                        superAdminEmails.includes(user?.user_email_id);

                    const userInfo = Object.keys(user ?? {}).reduce((acc, key) => {
                        if (projection[key] === 1) {
                            acc[key] = user[key]
                        }
                        return acc
                    }, {})

                    return {
                        user: { ...userInfo, isSuperAdmin },
                        session,
                    }
                })
            ]
        });
    }
    return _auth;
};

module.exports = { getAuth };
