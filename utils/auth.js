const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const mongoose = require("mongoose");
const User = require("../models/userModel");
const { customSession } = require("better-auth/plugins");
const { projection } = require("../constants");

let _auth;

const getAuth = () => {
    if (!_auth) {
        if (!mongoose.connection.db) {
            throw new Error("Database not connected yet. Cannot initialize Better Auth.");
        }

        mongoose.connection.db.collection("verification").deleteMany({ id: null })


        // Parse ALLOW_ORIGIN from env
        const allowedOrigins = process.env.ALLOW_ORIGIN ? process.env.ALLOW_ORIGIN.split(",").map(o => o.trim()) : [];

        console.log("[Better Auth] Initializing with allowedOrigins:", allowedOrigins, process.env.GOOGLE_REDIRECT_URI);

        _auth = betterAuth({
            database: mongodbAdapter(mongoose.connection.db),
            appName: "hushwork",
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
                    actual_user_name: {
                        type: "string",
                        defaultValue: null,
                    },
                    public_user_name: {
                        type: "string",
                        defaultValue: null
                    },
                    is_email_verified: {
                        type: "boolean",
                        defaultValue: false,
                    },
                    user_location: {
                        type: "string",
                        defaultValue: null
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
                    actual_profile_pic: {
                        type: "string",
                        defaultValue: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg",
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
                    user_phone_number: {
                        type: "number",
                        defaultValue: null
                    },
                    is_anonymous: {
                        type: "boolean",
                        defaultValue: true,
                    },
                    user_email_id: {
                        type: "string",
                        defaultValue: null,
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
                        defaultValue: null,
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
                    }
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
                crossOrigin: true,
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
                    crossSubDomainCookies: {
                        enabled: true,
                        domain: process.env.FRONTEND_URL,
                    },
                },
            },
            plugins: [
                customSession(async ({ user, session }) => {
                    const userInfo = Object.keys(user ?? {}).reduce((acc, key) => {
                        if (projection[key] === 1) {
                            acc[key] = user[key]
                        }
                        return acc
                    }, {})

                    return {
                        user: userInfo,
                        session,

                    }
                })
            ]
        });
    }
    return _auth;
};

module.exports = { getAuth };
