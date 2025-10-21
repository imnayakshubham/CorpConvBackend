const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { passkey } = require("better-auth/plugins/passkey");
const { customSession, admin, organization, multiSession } = require("better-auth/plugins");
const mongoose = require("mongoose");
const logger = require("../utils/logger");
const { projection } = require("../constants");
const { User } = require("../models/userModel");
const { getOrAddDataInRedis } = require("../redisClient/redisUtils");
const { decryptUserData } = require("../utils/encryption");
const Company = require("../models/companySchema");
const { toTitleCase, keepOnlyNumbers } = require("../utils/utils");

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store OTP in Redis or memory (for production use Redis)
const otpStore = new Map();

// Validate and provide fallback for baseURL
const baseURL = process.env.BETTER_AUTH_URL || process.env.ALLOW_ORIGIN?.split(',')[0] || "http://localhost:5000";
if (!process.env.BETTER_AUTH_URL && !process.env.ALLOW_ORIGIN) {
  logger.warn(`BETTER_AUTH_URL not configured - using fallback: ${baseURL}`);
}

const allowedOrgins = process.env.ALLOW_ORIGIN ? process.env.ALLOW_ORIGIN.split(",").map(o => o.trim()) : [];

// Email domains that should have "ORG" suffix
const commonEmailDomains = ["gmail", "outlook", "yahoo", "hotmail", "icloud", "protonmail", "example"];

// Helper to get organization name from email domain
const getOrganizationNameFromDomain = (domain) => {
  const domainName = domain.split(".")[0];
  const isCommonDomain = commonEmailDomains.includes(domainName.toLowerCase());

  if (isCommonDomain) {
    return `${toTitleCase(domainName)} ORG`;
  }

  return toTitleCase(domainName);
};

// Helper to find organization by email domain
const findOrganizationByDomain = async (emailDomain) => {
  try {
    const db = mongoose.connection.db;

    // Search for organization with matching email domain in metadata
    const organization = await db.collection('organizations').findOne({
      'organization_metadata.email_domain': emailDomain
    });

    return organization;
  } catch (error) {
    logger.error("Error finding organization by domain:", error);
    return null;
  }
};

// Helper to add user to existing organization
const addUserToOrganization = async (userId, organizationId, role = "member") => {
  try {
    const db = mongoose.connection.db;

    // Check if user is already a member
    const existingMember = await db.collection('member').findOne({
      user_id: userId,
      organization_id: organizationId
    });

    if (existingMember) {
      logger.info(`User ${userId} is already a member of organization ${organizationId}`);
      return existingMember;
    }

    // Add user as member
    const member = {
      member_id: new mongoose.Types.ObjectId().toString(),
      user_id: userId,
      organization_id: organizationId,
      member_role: role,
      member_created_at: new Date(),
      is_active_member: true,
      member_permissions: {}
    };

    await db.collection('member').insertOne(member);

    // Update member count
    await db.collection('organizations').updateOne(
      { organization_id: organizationId },
      { $inc: { member_count: 1 } }
    );

    logger.info(`User ${userId} added to organization ${organizationId} as ${role}`);

    return member;
  } catch (error) {
    logger.error("Error adding user to organization:", error);
    throw error;
  }
};

// Factory function to create auth instance after DB connection
const createAuth = () => {
  // Ensure mongoose is connected
  if (!mongoose.connection.db) {
    throw new Error("MongoDB must be connected before initializing better-auth");
  }

  return betterAuth({
    database: mongodbAdapter(mongoose.connection.db),
    secret: process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET_KEY,
    baseURL,
    appName: "hushwork",

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
          type: String,
          defaultValue: null,
          required: [true, "User Name is required"],
        },
        public_user_name: {
          type: String,
          defaultValue: null
        },
        is_email_verified: {
          type: Boolean,
          defaultValue: false,
          required: [true, "is_email_verified is required"],
        },
        user_location: {
          type: String,
          defaultValue: null
        },
        user_job_role: {
          type: String,
          defaultValue: null
        },
        user_job_experience: {
          type: Number,
          defaultValue: null
        },
        user_bio: {
          type: String,
          defaultValue: null
        },
        is_admin: {
          type: Boolean,
          required: true,
          defaultValue: false,
        },
        actual_profile_pic: {
          type: String,
          required: false,
          defaultValue: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg",
        },
        user_public_profile_pic: {
          type: String,
          required: true,
          defaultValue: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg",
        },
        provider: {
          type: String,
          defaultValue: null
        },
        provider_id: {
          type: String,
          required: false,
          defaultValue: null
        },
        user_phone_number: {
          type: Number,
          required: false,
          defaultValue: null
        },
        is_anonymous: {
          type: Boolean,
          defaultValue: true,
        },
        user_email_id: {
          type: String,
          trim: true,
          unique: true,
          required: [true, "Email is required"],
        },
        access: {
          type: Boolean,
          required: true,
          defaultValue: true
        },
        meta_data: {
          type: Object,
          defaultValue: {}
        },
        user_current_company_name: {
          type: String,
          trim: true,
          required: [true, "User Company Name is required"],
        },
        user_company_id: {
          type: String,
          trim: true,
          required: [true, "User Company Id is required"],
        },
        user_past_company_history: {
          type: Object,
          defaultValue: []
        },
        token: {
          defaultValue: null,
          type: String,
        },
        followers: [{
          type: String,
          ref: 'User',
          defaultValue: [],
        }],
        followings: [{
          type: String,
          ref: 'User',
          defaultValue: [],
        }],
        pending_followings: [{
          type: String,
          ref: 'User',
          defaultValue: []
        }],
        secondary_email_id: {
          type: String,
          trim: true,
          lowercase: true,
          defaultValue: null,
        },
        is_secondary_email_id_verified: {
          defaultValue: false,
          type: Boolean,
        },
        primary_email_domain: {
          type: String,
          required: true,
          trim: true,
        },
        secondary_email_domain: {
          type: String,
          trim: true,
        },
        avatar: {
          type: User.avatarSchemaConfig,
          required: false
        },
        academic_level: {
          type: String,
          defaultValue: null
        },
        field_of_study: {
          type: String,
          defaultValue: null
        },
        hobbies: {
          type: [{ type: String, trim: true }],
          validate: {
            validator: arr => Array.isArray(arr) && arr.length <= 10,
            message: "Maximum 10 hobbies allowed"
          },
          defaultValue: []
        },
        gender: {
          type: String,
          enum: ["male", "female", "prefer-not-to-say"],
          required: false,
          defaultValue: "prefer-not-to-say"
        },
        profession: {
          type: String,
          enum: ["student", "employed", "self-employed", "unemployed", "retired", "homemaker", "other"],
          defaultValue: null,
        },
        profile_details: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'ProfileDetails'
        },
        embedding: {
          type: [Number],
          defaultValue: null
        },
        embedding_updated_at: Date,
        last_active_at: {
          type: Date,
          defaultValue: Date.now
        },
        credentials: [User.credentialSchemaConfig],
        email_verified_at: {
          type: Date,
          defaultValue: null
        },
        user_image: {
          type: String,
          defaultValue: null
        },
        verification_tokens: [{
          token: String,
          type: {
            type: String,
            enum: ['email_verification', 'magic_link', 'otp', 'password_reset']
          },
          expires: Date,
          used: {
            type: Boolean,
            defaultValue: false
          }
        }],
        auth_accounts: [{
          provider: String,
          provider_id: String,
          access_token: String,
          refresh_token: String,
          expires_at: Date
        }],
        passkey_credentials: [{
          public_key: Buffer,
          counter: Number,
          transports: [String],
          created_at: {
            type: Date,
            defaultValue: Date.now
          },
          last_used: Date,
          nickname: String
        }],
        auth_methods: {
          email: {
            type: Boolean,
            defaultValue: true
          },
          google: {
            type: Boolean,
            defaultValue: true
          },
          passkey: {
            type: Boolean,
            defaultValue: false
          }
        },
        two_factor_enabled: {
          type: Boolean,
          defaultValue: false
        },
        backup_codes: [{
          code: String,
          used: {
            type: Boolean,
            defaultValue: false
          }
        }],
        is_masked: {
          type: Boolean,
          defaultValue: false,
          required: true,
          index: true
        },
        has_premium: {
          type: Boolean,
          defaultValue: false,
          required: true,
          index: true
        },
        premium_expires_at: {
          type: Date,
          defaultValue: null
        },
        premium_plan: {
          type: String,
          enum: ["free", "monthly", "yearly", "lifetime"],
          defaultValue: "free",
          required: true
        }
      }
    },

    advanced: {
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
        trustedOrigins: allowedOrgins,
      },
    },

    // Social providers
    socialProviders: {
      google: {
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        prompt: "select_account",
        scope: ["openid", "email", "profile"],
      }
    },

    // Plugin configuration
    plugins: [
      // Passkey authentication
      passkey({
        rpName: process.env.APP_NAME || "Hushwork",
        rpID: process.env.APP_ENV === 'PROD'
          ? new URL(process.env.BETTER_AUTH_URL || '').hostname
          : "localhost",
        origin: allowedOrgins
      }),

      admin(),
      multiSession({
        maxSessionsPerUser: 2,
      }),

      // Organization plugin with custom configuration
      organization({
        allowUserToCreateOrganization: true,
        membershipRole: ["owner", "admin", "member"],
        creatorRole: "owner",
        organizationLimit: 5,
        membershipLimit: 100,

        // Custom schema matching your naming convention
        schema: {
          // Organization table field mapping
          organization: {
            modelName: "organizations",
            fields: {
              id: "organization_id",
              name: "organization_name",
              slug: "organization_slug",
              logo: "organization_logo",
              metadata: "organization_metadata",
              createdAt: "organization_created_at",
            },
            additionalFields: {
              company_id: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              company_name: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              organization_description: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              organization_settings: {
                type: "object",
                required: false,
                input: true,
                returned: true,
                defaultValue: {}
              },
              is_active: {
                type: "boolean",
                required: true,
                defaultValue: true,
                returned: true
              },
              member_count: {
                type: "number",
                required: false,
                input: false,
                returned: true,
                defaultValue: 1
              },
              created_by_user_id: {
                type: "string",
                required: false,
                input: false,
                returned: true
              },
              access: {
                type: "boolean",
                required: true,
                defaultValue: true,
                returned: true
              }
            }
          },

          // Member table field mapping
          member: {
            modelName: "member",
            fields: {
              id: "member_id",
              userId: "user_id",
              organizationId: "organization_id",
              role: "member_role",
              createdAt: "member_created_at"
            },
            additionalFields: {
              member_display_name: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              member_title: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              member_department: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              member_bio: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              is_active_member: {
                type: "boolean",
                required: true,
                defaultValue: true,
                returned: true
              },
              member_permissions: {
                type: "object",
                required: false,
                defaultValue: {},
                returned: true
              },
              last_active_at: {
                type: "date",
                required: false,
                input: false,
                returned: true
              }
            }
          },

          // Invitation table field mapping
          invitation: {
            modelName: "invitation",
            fields: {
              id: "invitation_id",
              email: "invitation_email",
              inviterId: "inviter_id",
              organizationId: "organization_id",
              role: "invitation_role",
              status: "invitation_status",
              expiresAt: "invitation_expires_at",
              createdAt: "invitation_created_at"
            },
            additionalFields: {
              invitation_message: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              invitation_type: {
                type: "string",
                required: false,
                input: true,
                returned: true,
                defaultValue: "standard"
              },
              inviter_name: {
                type: "string",
                required: false,
                input: true,
                returned: true
              },
              invitation_metadata: {
                type: "object",
                required: false,
                input: true,
                returned: true,
                defaultValue: {}
              },
              accepted_at: {
                type: "date",
                required: false,
                input: false,
                returned: true
              },
              rejected_at: {
                type: "date",
                required: false,
                input: false,
                returned: true
              }
            }
          }
        },

        // Organization lifecycle hooks
        organizationHooks: {
          beforeCreateOrganization: async ({ organization, user }, request) => {
            logger.info(`User ${user.email} is creating organization: ${organization.name}`);

            return {
              data: {
                ...organization,
                metadata: {
                  ...organization.metadata,
                  created_by_user_id: user.id,
                  created_at: new Date().toISOString()
                }
              }
            };
          },

          afterCreateOrganization: async ({ organization, member, user }, request) => {
            logger.info(`Organization created: ${organization.id} for user: ${user.email}`);

            try {
              const orgInfoRedisKey = `${process.env.APP_ENV}_org_info_${organization.id}`;
              await getOrAddDataInRedis(orgInfoRedisKey, {
                organization_id: organization.id,
                organization_name: organization.name,
                organization_slug: organization.slug,
                organization_logo: organization.logo,
                created_by: user.id,
                member_count: 1,
                created_at: organization.createdAt
              });
            } catch (error) {
              logger.error("Error caching organization info:", error);
            }
          },

          beforeUpdateOrganization: async ({ organization, user }, request) => {
            logger.info(`Organization ${organization.id} is being updated by user: ${user.email}`);
            return { data: organization };
          },

          afterUpdateOrganization: async ({ organization, user }, request) => {
            const orgInfoRedisKey = `${process.env.APP_ENV}_org_info_${organization.id}`;
            await getOrAddDataInRedis(orgInfoRedisKey, null); // Clear cache
          },

          beforeDeleteOrganization: async ({ organization, user }, request) => {
            logger.warn(`Organization ${organization.id} is being deleted by user: ${user.email}`);
          },

          afterDeleteOrganization: async ({ organization, user }, request) => {
            const orgInfoRedisKey = `${process.env.APP_ENV}_org_info_${organization.id}`;
            await getOrAddDataInRedis(orgInfoRedisKey, null);
            logger.info(`Organization ${organization.id} deleted successfully`);
          }
        },

        // Invitation email configuration
        sendInvitationEmail: async (data) => {
          const inviteLink = `${baseURL}/accept-invitation/${data.id}`;

          logger.info(`Sending invitation to ${data.email} for organization ${data.organization.name}`);

          logger.info({
            to: data.email,
            from: data.inviter.user.email,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name,
            role: data.role,
            inviteLink: inviteLink
          });

          // TODO: Implement actual email sending
          // await sendEmail({ ... });
        },

        invitationExpiresIn: 48 * 60 * 60, // 48 hours
        cancelPendingInvitationsOnReInvite: true
      }),

      // Custom session with active organization
      customSession(async ({ user, session }) => {
        const userInfo = await getOrAdduser(user);
        return {
          user: {
            ...userInfo,
          },
          session
        };
      }),
    ],

    databaseHooks: {
      user: {
        create: {
          before: async (userData) => {
            const newUser = await getOrAdduser(userData);
            return newUser;
          },
          after: async (userData) => {
            logger.info(`User created: ${userData.email || userData.user_email_id}`);
          }
        }
      },

      // Set active organization when session is created
      session: {
        create: {
          before: async (session) => {
            try {
              const db = mongoose.connection.db;

              // Get user's organizations (prioritize owned organizations)
              const userOrganizations = await db.collection('member')
                .find({ user_id: session.userId })
                .sort({ member_role: 1, member_created_at: 1 }) // Owner first, then by creation date
                .limit(1)
                .toArray();

              if (userOrganizations && userOrganizations.length > 0) {
                return {
                  data: {
                    ...session,
                    activeOrganizationId: userOrganizations[0].organization_id
                  }
                };
              }
            } catch (error) {
              logger.error("Error setting active organization:", error);
            }

            return { data: session };
          }
        }
      }
    },

    // Rate limiting
    rateLimit: {
      window: 60,
      max: 10,
      storage: "memory" // Use Redis in production
    },

    // Custom error handling
    onError: (error, request) => {
      logger.error("BetterAuth error:", error);
      return {
        message: "Authentication error occurred",
        status: error.status || 500
      };
    },

    // Custom success handling
    onSuccess: (context) => {
      logger.info(`Authentication success: ${context.user?.email || 'Unknown'}`);
    },
  });
};

// Singleton instance
let authInstance = null;

// Get or create auth instance
const getAuth = () => {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
};

// Helper function to verify OTP manually
const verifyOTP = (email, otp) => {
  const stored = otpStore.get(email);

  if (!stored) {
    return { success: false, error: "OTP not found or expired" };
  }

  if (stored.expires < Date.now()) {
    otpStore.delete(email);
    return { success: false, error: "OTP expired" };
  }

  if (stored.otp !== otp) {
    return { success: false, error: "Invalid OTP" };
  }

  otpStore.delete(email);
  return { success: true };
};

// Helper function to generate magic link
const generateMagicLink = async (email) => {
  try {
    const token = require('crypto').randomBytes(32).toString('hex');

    otpStore.set(`magic_${email}`, {
      token,
      expires: Date.now() + (15 * 60 * 1000),
      type: 'magic-link'
    });

    const baseUrl = process.env.BETTER_AUTH_URL || process.env.ALLOW_ORIGIN?.split(',')[0];
    const magicUrl = `${baseUrl}/verify?token=${token}&email=${encodeURIComponent(email)}`;

    return { success: true, url: magicUrl, token };
  } catch (error) {
    logger.error("Failed to generate magic link:", error);
    return { success: false, error: "Failed to generate magic link" };
  }
};

// Helper function to verify magic link token
const verifyMagicToken = (email, token) => {
  const stored = otpStore.get(`magic_${email}`);

  if (!stored) {
    return { success: false, error: "Magic link not found or expired" };
  }

  if (stored.expires < Date.now()) {
    otpStore.delete(`magic_${email}`);
    return { success: false, error: "Magic link expired" };
  }

  if (stored.token !== token) {
    return { success: false, error: "Invalid magic link" };
  }

  otpStore.delete(`magic_${email}`);
  return { success: true };
};

const responseFormatterForAuth = (result) => {
  const decrypted = decryptUserData(result);

  return {
    _id: decrypted._id,
    public_user_name: decrypted.public_user_name,
    user_public_profile_pic: decrypted.user_public_profile_pic,
    is_anonymous: decrypted.is_anonymous,
    user_bio: decrypted.user_bio,
    user_job_role: decrypted.user_job_role,
    user_job_experience: decrypted.user_job_experience,
    user_current_company_name: decrypted.user_current_company_name,
    is_email_verified: decrypted.is_email_verified,
    isAdmin: decrypted.isAdmin,
    has_premium: decrypted.has_premium || false,
    premium_expires_at: decrypted.premium_expires_at || null,
    premium_plan: decrypted.premium_plan || 'free'
  };
};

const createUser = async (userData) => {
  try {
    const emailSplit = userData.email.split("@");
    const domain = emailSplit[1].split(".")[0];
    const fullDomain = emailSplit[1];

    const companyExist = await Company.findOne({ company_name: toTitleCase(domain) });
    const companyId = companyExist && companyExist?.company_id ? companyExist?.company_id : new mongoose.Types.ObjectId();
    const companyName = companyExist && companyExist?.company_name ? companyExist?.company_name : toTitleCase(domain);

    if (!companyExist) {
      const company = await new Company({
        company_id: companyId,
        company_name: companyName
      });
      await company.save();
    }

    const user_current_company_name = !commonEmailDomains.includes(domain.toLowerCase()) ? toTitleCase(domain) : "Somewhere";

    const data = {
      ...userData,
      actual_user_name: userData?.name || `${userData?.given_name || ''} ${userData?.family_name || ''}`.trim(),
      user_email_id: userData?.email,
      actual_profile_pic: userData?.picture || userData?.photoURL || null,
      providerId: userData?.providerId || "google",
      meta_data: userData?.metadata || null,
      provider: userData?.providerId ?? "google",
      is_email_verified: !commonEmailDomains.includes(domain.toLowerCase()),
      is_anonymous: true,
      user_current_company_name,
      user_phone_number: userData?.user_phone_number ? keepOnlyNumbers(userData?.user_phone_number) : null,
      user_company_id: companyId,
      user_past_company_history: [companyId],
      primary_email_domain: fullDomain,
    };

    const user = await new User(data);
    const result = await user.save();
    const userActualData = responseFormatterForAuth(result);

    const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${result._id}`;
    await getOrAddDataInRedis(userInfoRedisKey, userActualData);

    // Auto-create or join organization based on email domain
    await handleOrganizationForNewUser(result, fullDomain);

    return user;
  } catch (error) {
    logger.error("Error creating user:", error);
    throw error;
  }
};

// Handle organization creation or joining for new user
const handleOrganizationForNewUser = async (user, emailDomain) => {
  try {
    const db = mongoose.connection.db;

    const isCommonDomain = commonEmailDomains.includes(emailDomain.split(".")[0].toLowerCase())

    // Check if organization exists for this email domain
    const existingOrg = await findOrganizationByDomain(emailDomain);

    if (existingOrg && !isCommonDomain) {

      // Organization exists - add user as member
      logger.info(`Found existing organization for domain ${emailDomain}, adding user as member`);
      await addUserToOrganization(user._id.toString(), existingOrg.organization_id, "member");
    } else {
      // No organization exists - create new one
      logger.info(`No organization found for domain ${emailDomain}, creating new organization`);

      const organizationName = isCommonDomain ? user._id.toString().slice(-8) : getOrganizationNameFromDomain(emailDomain)
      const organizationSlug = `${organizationName.toLowerCase().replace(/\s+/g, '-')}-${user._id.toString().slice(6)}`;

      const organizationId = new mongoose.Types.ObjectId().toString();
      const organization = {
        organization_id: organizationId,
        organization_name: organizationName,
        organization_slug: organizationSlug,
        organization_logo: null,
        organization_metadata: {
          email_domain: emailDomain,
          company_id: user.user_company_id,
          company_name: user.user_current_company_name,
          auto_created: true,
          created_from: "user_signup",
          created_by_user_id: user._id.toString(),
          created_at: new Date().toISOString()
        },
        organization_created_at: new Date(),
        organization_settings: {},
        is_active: true,
        member_count: 1,
        created_by_user_id: user._id.toString()
      };

      await db.collection('organizations').insertOne(organization);

      // Add user as owner
      const member = {
        member_id: new mongoose.Types.ObjectId().toString(),
        user_id: user._id.toString(),
        organization_id: organizationId,
        member_role: "owner",
        member_created_at: new Date(),
        is_active_member: true,
        member_permissions: {}
      };

      await db.collection('member').insertOne(member);

      // Cache organization info
      const orgInfoRedisKey = `${process.env.APP_ENV}_org_info_${organizationId}`;
      await getOrAddDataInRedis(orgInfoRedisKey, {
        organization_id: organizationId,
        organization_name: organizationName,
        organization_slug: organizationSlug,
        organization_logo: null,
        created_by: user._id.toString(),
        member_count: 1,
        created_at: organization.organization_created_at
      });

      logger.info(`Organization "${organizationName}" created for user: ${user.user_email_id}`);
    }
  } catch (error) {
    logger.error("Error handling organization for new user:", error);
  }
};

const getOrAdduser = async (userData) => {
  try {
    let payload = {};

    if (userData.email) {
      payload.user_email_id = userData.email;
    }

    const user_id = userData.userId || userData._id;
    if (user_id) {
      payload._id = user_id;
    }

    if (user_id) {
      const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${payload?._id}`;
      const value = await getOrAddDataInRedis(userInfoRedisKey);

      if (value) {
        return value;
      }
    }

    const foundUser = await User.findOne({
      $or: [
        { ...payload },
      ]
    }, projection).exec();

    if (foundUser) {
      const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${foundUser._id}`;
      const userActualData = responseFormatterForAuth(foundUser);
      await getOrAddDataInRedis(userInfoRedisKey, userActualData);
      return userActualData;
    } else {
      const newUser = await createUser(userData);
      const userActualData = responseFormatterForAuth(newUser);
      const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${newUser._id}`;
      await getOrAddDataInRedis(userInfoRedisKey, userActualData);
      return userActualData;
    }
  } catch (error) {
    logger.error("Error in getOrAdduser:", error);
    return null;
  }
};

module.exports = {
  getAuth,
  createAuth,
  verifyOTP,
  generateMagicLink,
  verifyMagicToken,
  generateOTP,
  getOrAdduser,
  responseFormatterForAuth,
  createUser,
  handleOrganizationForNewUser,
  findOrganizationByDomain,
  addUserToOrganization,
  getOrganizationNameFromDomain
};
