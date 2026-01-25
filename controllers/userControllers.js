const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Company = require("../models/companySchema");
const { toTitleCase, generateUserId, keepOnlyNumbers, generateToken } = require("../utils/utils.js");
const { default: mongoose } = require("mongoose");
const { getIo } = require("../utils/socketManger");
const Notifications = require("../models/notificationModel");
const cache = require("../redisClient/cacheHelper");
const TTL = require("../redisClient/cacheTTL");
const { tokenkeyName, cookieOptions, projection } = require("../constants/index.js");




const allUsers = asyncHandler(async (req, res) => {
  try {
    const keyword = req.query.search ? {
      $or: [
        { public_user_name: { $regex: req.query.search, $options: "i" } },
        { user_current_company_name: { $regex: req.query.search, $options: "i" } }
      ],
    }
      : {};
    const users = await User.find({ ...keyword, _id: { $ne: req.user._id } }, { public_user_name: 1, user_job_experience: 1 });
    return res.status(200).json({ message: "Filtered User List", status: "Success", result: users })

  } catch (error) {
    console.log({ error })
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
  }
});

const getfollowersList = async (req, res) => {
  try {
    const searchTerm = req.query.search;
    const userId = req.user._id;

    if (!searchTerm) {
      const user = await User.findById(userId, { followers: 1 })
        .populate({
          path: "followers",
          select: "public_user_name user_job_experience"
        });

      const followers = user?.followers || [];
      return res.status(200).json({ message: "All Followers", status: "Success", result: followers });
    }
    const followerIds = (await User.findById(userId, { followers: 1 })).followers || [];
    const followersMatchingSearch = await User.find({
      _id: { $in: followerIds },
      $or: [
        { "public_user_name": { $regex: new RegExp(searchTerm, "i") } },
        { "user_current_company_name": { $regex: new RegExp(searchTerm, "i") } }
      ]
    }, { public_user_name: 1, user_current_company_name: 1 });

    return res.status(200).json({ message: "Filtered User List", status: "Success", result: followersMatchingSearch });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong", status: "Failed" });
  }
};

const responseFormatterForAuth = (result) => {
  return {
    is_email_verified: result.is_email_verified,
    user_job_role: result.user_job_role,
    user_job_experience: result.user_job_experience,
    user_bio: result.user_bio,
    isAdmin: result.isAdmin,
    is_anonymous: result.is_anonymous,
    token: result?.token,
    user_current_company_name: result.user_current_company_name,
    user_email_id: result.user_email_id,
    _id: result._id,
    secondary_email_id: result.secondary_email_id,
    is_secondary_email_id_verified: result.is_secondary_email_id_verified,
    public_user_name: result.public_user_name,
    is_secondary_email_id_verified: result.is_secondary_email_id_verified,
    user_public_profile_pic: result.user_public_profile_pic,
    avatar_config: result.avatar_config,
    qr_config: result.qr_config,
  }
}

const authUser = async (req, res) => {
  const { user_email_id } = req.body;
  try {

    if (!user_email_id) {
      return res.status(200).json({ message: "Please Fill all the details", status: "Failed" });
    }
    const userData = await User.findOne({
      $or: [
        { user_email_id },
        { secondary_email_id: user_email_id }
      ]
    });

    if (userData) {

      const token = generateToken(userData._id)

      res.cookie(tokenkeyName, token, cookieOptions);

      const result = {
        ...userData._doc,
        token: token
      }

      return res.status(200).json({ message: "email already exists!", status: "Success", result: responseFormatterForAuth(result) });

    } else {
      const emailSplit = user_email_id.split("@")
      const domain = emailSplit[1].split(".")[0]
      const companyExist = await Company.findOne({ company_name: toTitleCase(domain) });
      const companyId = companyExist && companyExist?.company_id ? companyExist?.company_id : new mongoose.Types.ObjectId()
      const companyName = companyExist && companyExist?.company_name ? companyExist?.company_name : toTitleCase(domain)
      if (!companyExist) {
        const company = await new Company({
          company_id: companyId,
          company_name: companyName
        })
        await company.save()
      }
      const user_current_company_name = !["example", "gmail", "outlook"].includes(domain) ? toTitleCase(domain) : "Somewhere"
      const data = {
        ...req.body,
        is_email_verified: !["example", "gmail", "outlook"].includes(domain) ? true : false,
        is_anonymous: true,
        user_current_company_name,
        user_phone_number: req.body.user_phone_number ? keepOnlyNumbers(req.body.user_phone_number) : null,
        user_company_id: companyId,
        user_past_company_history: [companyId],
        primary_email_domain: emailSplit[1],
      }
      const user = await new User(data);
      const result = await user.save();
      const token = generateToken(result._id)

      res.cookie(tokenkeyName, token, cookieOptions);
      if (result) {
        return res.status(200).json({
          message: "Registration Successfully. Welcome!!",
          status: "Success",
          result: { ...responseFormatterForAuth(result), token: token, _id: result._id }
        });
      }
    }
  } catch (error) {
    console.log({ error })
    return res.status(200).json({ message: error, status: "Failed" });
  }
};

const logout = async (req, res) => {
  try {
    const updateOperation = {
      $set: {
        'token': null,
      },
    };
    const updatedData = await User.updateOne({ token: req.user.token }, updateOperation)

    if (updatedData) {
      res.clearCookie(tokenkeyName, cookieOptions);
      return res.status(200).json({ message: "Logged Out", status: "Success" })
    } else {
      return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
    }
  } catch (error) {
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", })

  }
}

const updateUserProfile = async (req, res) => {
  try {

    const UserInfo = await User.findOne({ _id: req.body._id })
    if (!UserInfo) {
      return res.status(200).json({ message: "No User Exist", status: "Failed", })
    }


    const updateOperation = {
      $set: {
        ...req.body,
        public_user_name: `${toTitleCase(req.body.user_job_role)} @ ${UserInfo.user_current_company_name}`
      },
    };

    // Invalidate user cache
    const userInfoCacheKey = cache.generateKey('user', 'info', req.body._id);
    await cache.del(userInfoCacheKey);

    const updatedData = await User.updateOne({ _id: req.body._id }, updateOperation)
    if (updatedData) {
      return res.status(200).json({
        message: "Your Profile has been Updated Successfully", status: "Success", result: updateOperation["$set"]
      })
    } else {
      return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
    }
  } catch (error) {
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
  }
}

const getUserInfo = async (req, res) => {
  try {
    const userId = req.params?.id
    if (!userId) {
      return res.status(200).json({ message: "Unable to find User...", status: "Failed", })
    }

    // Try to get from cache
    const cacheKey = cache.generateKey('user', 'info', userId);
    const cachedData = await cache.get(cacheKey);

    if (cachedData) {
      if (cachedData) {
        return res.status(200).json({ message: "User Profile Found (Cached)", status: "Success", result: cachedData })
      } else {
        return res.status(404).json({ message: "Sorry, it appears this user doesn't exist. (Cached)", status: "Failed", result: cachedData })
      }
    }

    const user = await User.findOne({ _id: userId, access: true }, projection)

    // Cache the result
    await cache.set(cacheKey, user, TTL.USER_PROFILE);

    if (user) {
      return res.status(200).json({ message: "User Profile Found", status: "Success", result: user })
    } else {
      return res.status(404).json({ message: "Sorry, it appears this user doesn't exist.", status: "Failed", result: null })
    }

  } catch (error) {
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
  }
}

const fetchUsersPayloadFormatter = (type, data) => {
  return {
    [type]: data
  }
}

const fetchUsers = async (req, res) => {
  try {
    const payload = req.body
    const userLoggedIn = req.body.loggedIn

    const keysToRetrieve = ["is_anonymous", "is_email_verified", "user_bio", "user_current_company_name", "user_id", "user_job_experience", "user_location", "public_user_name", "is_email_verified", ...(userLoggedIn ? ["pending_followings", "followings", "followers"] : [])]
    const projection = keysToRetrieve.reduce((acc, key) => {
      acc[`${key}`] = 1;
      return acc;
    }, {});

    if (payload.type === "all_users") {
      const currentUser = await User.findOne({ _id: payload?._id }).select("followings pending_followings followers");

      const ignoredIds = [
        ...(currentUser?.followings ?? []),
        ...(currentUser?.pending_followings ?? []),
        ...(currentUser?.followers ?? []),
        ...([payload?._id] ?? []),
      ];

      const usersList = await User.find(
        {
          access: true,
          _id: { $nin: ignoredIds },
        },
        { ...projection }
      );
      return res.status(200).json({
        message: "Users  Fetched SuccessFully", status: "Success", result: fetchUsersPayloadFormatter(payload.type, usersList)
      })
    } else if (payload.type === "followers") {
      const followers = await User.findOne({ _id: payload?._id })
        .select({ [payload.type]: 1, _id: 0 })
        .populate({
          path: payload.type,
          select: { ...projection }
        });
      return res.status(200).json({ message: "Followers are  Fetched SuccessFully", status: "Success", result: fetchUsersPayloadFormatter(payload.type, followers?.[payload.type]) })

    } else if (payload.type === "pending_followings") {

      const pendingFollowers = await User.findOne({ _id: payload?._id })
        .select({ [payload.type]: 1, _id: 0 })
        .populate({
          path: payload.type,
          select: { ...projection }
        });

      return res.status(200).json({ message: "Invitations Fetched SuccessFully", status: "Success", result: fetchUsersPayloadFormatter(payload.type, pendingFollowers?.[payload.type]) })
    } else if (payload.type === "followings") {
      const followings = await User.findOne({ _id: payload?._id })
        .select({ [payload.type]: 1, _id: 0 })
        .populate({
          path: payload.type,
          select: { ...projection }
        });
      return res.status(200).json({ message: "Invitations Fetched SuccessFully", status: "Success", result: fetchUsersPayloadFormatter(payload.type, followings?.[payload.type] ?? []) })
    } else {
      return res.status(200).json({ message: "Invalid Operations", status: "Failed", result: fetchUsersPayloadFormatter(payload.type, []) })
    }

  } catch (error) {
    console.log({ error })
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", result: [] })
  }
}


// ----------------------------------------------------------
const sendFollowRequest = async (req, res) => {
  const { senderId, receiverId } = req.body;

  try {
    const receiverUser = await User.findById(receiverId);
    // Check if the receiverId is in the pending_followings of senderId
    const isRequestWithdrawal = receiverUser.pending_followings.includes(senderId);

    if (isRequestWithdrawal) {
      // Withdraw request
      const result = await User.findByIdAndUpdate(senderId, {
        $pull: { followings: receiverId },
      }, { upsert: true, new: true });
      if (result) {
        await User.findByIdAndUpdate(receiverId, {
          $pull: { pending_followings: senderId },
        });
      }

    } else {
      // Send request
      const recieverData = await User.findByIdAndUpdate(receiverId, { $addToSet: { pending_followings: senderId }, }, { upsert: true, new: true });
      if (recieverData) {
        const senderData = await User.findByIdAndUpdate(senderId, {
          $addToSet: { followings: receiverId },
        }, { upsert: true, new: true });

        const notification = await Notifications.create({ content: `${senderData.public_user_name} Sent you a Follow Request`, receiverId })
        if (notification) {
          const io = getIo()
          io.to(receiverId).emit('follow_request_send_notication', notification);

        }

      }
    }

    // const result = await User.findById(senderId, { _id: 1, followings: 1, pending_followings: 1, followers: 1 });

    res.status(200).json({ message: "Updated User Info ", status: "Success", result: [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}


const acceptFollowRequest = async (req, res) => {
  const { userId, requesterId } = req.body;


  try {
    await User.findByIdAndUpdate(userId, {
      $pull: { pending_followings: requesterId },
      $addToSet: { followers: requesterId },
    }, { upsert: true, new: true });

    await User.findByIdAndUpdate(requesterId, {
      $pull: { followings: userId },
      $addToSet: { followers: userId },
    }, { upsert: true, new: true });

    const result = await User.findById(userId, { _id: 1, followings: 1, pending_followings: 1, followers: 1 });

    res.status(200).json({ message: "Updated User Info ", status: "Success", result: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// API 3: Reject Connection Request
const rejectFollowRequest = async (req, res) => {
  const { userId, requesterId } = req.body;
  try {
    await User.findByIdAndUpdate(userId, {
      $pull: { pending_followings: requesterId },
    }, { upsert: true, new: true });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}

// Session Management
const listUserSessions = async (req, res) => {
  try {
    const { getAuth } = require("../utils/auth");
    const auth = getAuth();

    const sessions = await auth.api.listSessions({
      headers: req.headers,
    });

    if (sessions) {
      return res.status(200).json({
        message: "Sessions retrieved successfully",
        status: "Success",
        result: sessions,
      });
    }

    return res.status(200).json({
      message: "No sessions found",
      status: "Success",
      result: [],
    });
  } catch (error) {
    console.error("List sessions error:", error);
    return res.status(500).json({
      message: "Failed to retrieve sessions",
      status: "Failed",
    });
  }
};

const revokeSession = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        message: "Session token is required",
        status: "Failed",
      });
    }

    const { getAuth } = require("../utils/auth");
    const auth = getAuth();

    await auth.api.revokeSession({
      headers: req.headers,
      body: { token },
    });

    return res.status(200).json({
      message: "Session revoked successfully",
      status: "Success",
    });
  } catch (error) {
    console.error("Revoke session error:", error);
    return res.status(500).json({
      message: "Failed to revoke session",
      status: "Failed",
    });
  }
};

const revokeAllSessions = async (req, res) => {
  try {
    const { exceptCurrent } = req.body;
    const { getAuth } = require("../utils/auth");
    const auth = getAuth();

    if (exceptCurrent) {
      await auth.api.revokeOtherSessions({
        headers: req.headers,
      });
    } else {
      await auth.api.revokeSessions({
        headers: req.headers,
      });
    }

    return res.status(200).json({
      message: exceptCurrent
        ? "All other sessions revoked successfully"
        : "All sessions revoked successfully",
      status: "Success",
    });
  } catch (error) {
    console.error("Revoke all sessions error:", error);
    return res.status(500).json({
      message: "Failed to revoke sessions",
      status: "Failed",
    });
  }
};

const updateAvatarConfig = async (req, res) => {
  try {
    const { _id, avatar_config } = req.body;

    if (!_id || !avatar_config) {
      return res.status(400).json({ message: "User ID and avatar config are required", status: "Failed" });
    }

    const validStyles = ['avataaars', 'bottts', 'lorelei', 'notionists', 'adventurer', 'fun-emoji', 'personas', 'big-smile', 'micah', 'thumbs'];
    if (avatar_config.style && !validStyles.includes(avatar_config.style)) {
      return res.status(400).json({ message: "Invalid avatar style", status: "Failed" });
    }

    // Validate transform options if present
    if (avatar_config.options) {
      const { scale, radius, rotate } = avatar_config.options;

      if (scale !== undefined && (typeof scale !== 'number' || scale < 0 || scale > 200)) {
        return res.status(400).json({ message: "Invalid scale value (must be 0-200)", status: "Failed" });
      }

      if (radius !== undefined && (typeof radius !== 'number' || radius < 0 || radius > 50)) {
        return res.status(400).json({ message: "Invalid radius value (must be 0-50)", status: "Failed" });
      }

      if (rotate !== undefined && ![0, 90, 180, 270].includes(rotate)) {
        return res.status(400).json({ message: "Invalid rotate value (must be 0, 90, 180, or 270)", status: "Failed" });
      }
    }

    const updateOperation = {
      $set: { avatar_config }
    };

    // Invalidate user cache
    const userInfoCacheKey = cache.generateKey('user', 'info', _id);
    await cache.del(userInfoCacheKey);

    const updatedData = await User.findByIdAndUpdate(_id, updateOperation, { new: true });

    if (updatedData) {
      return res.status(200).json({
        message: "Avatar configuration updated successfully",
        status: "Success",
        result: { avatar_config: updatedData.avatar_config }
      });
    } else {
      return res.status(404).json({ message: "User not found", status: "Failed" });
    }
  } catch (error) {
    console.error("Update avatar config error:", error);
    return res.status(500).json({ message: "Something went wrong", status: "Failed" });
  }
};

const updateQRConfig = async (req, res) => {
  try {
    const { _id, qr_config } = req.body;

    if (!_id || !qr_config) {
      return res.status(400).json({ message: "User ID and QR config are required", status: "Failed" });
    }

    // Validate dot types
    const validDotTypes = ['rounded', 'dots', 'classy', 'classy-rounded', 'square', 'extra-rounded'];
    const validCornerSquareTypes = ['dot', 'square', 'extra-rounded'];
    const validCornerDotTypes = ['dot', 'square'];
    const validErrorLevels = ['L', 'M', 'Q', 'H'];
    const validShapes = ['square', 'circle'];

    // Validate shape
    if (qr_config.shape && !validShapes.includes(qr_config.shape)) {
      return res.status(400).json({ message: "Invalid QR shape", status: "Failed" });
    }

    // Validate dotsOptions
    if (qr_config.dotsOptions?.type && !validDotTypes.includes(qr_config.dotsOptions.type)) {
      return res.status(400).json({ message: "Invalid dots type", status: "Failed" });
    }

    // Validate cornersSquareOptions
    if (qr_config.cornersSquareOptions?.type && !validCornerSquareTypes.includes(qr_config.cornersSquareOptions.type)) {
      return res.status(400).json({ message: "Invalid corner square type", status: "Failed" });
    }

    // Validate cornersDotOptions
    if (qr_config.cornersDotOptions?.type && !validCornerDotTypes.includes(qr_config.cornersDotOptions.type)) {
      return res.status(400).json({ message: "Invalid corner dot type", status: "Failed" });
    }

    // Validate error correction level
    if (qr_config.qrOptions?.errorCorrectionLevel && !validErrorLevels.includes(qr_config.qrOptions.errorCorrectionLevel)) {
      return res.status(400).json({ message: "Invalid QR error correction level", status: "Failed" });
    }

    // Validate margin
    if (qr_config.margin !== undefined && (typeof qr_config.margin !== 'number' || qr_config.margin < 0 || qr_config.margin > 100)) {
      return res.status(400).json({ message: "Invalid margin value (must be 0-100)", status: "Failed" });
    }

    // Validate gradient structure if present
    const validateGradient = (gradient, fieldName) => {
      if (!gradient) return null;
      if (gradient.type && !['linear', 'radial'].includes(gradient.type)) {
        return `Invalid ${fieldName} gradient type`;
      }
      if (gradient.colorStops && !Array.isArray(gradient.colorStops)) {
        return `Invalid ${fieldName} gradient colorStops`;
      }
      return null;
    };

    const gradientErrors = [
      validateGradient(qr_config.dotsOptions?.gradient, 'dots'),
      validateGradient(qr_config.cornersSquareOptions?.gradient, 'cornerSquare'),
      validateGradient(qr_config.cornersDotOptions?.gradient, 'cornerDot'),
      validateGradient(qr_config.backgroundOptions?.gradient, 'background'),
    ].filter(Boolean);

    if (gradientErrors.length > 0) {
      return res.status(400).json({ message: gradientErrors[0], status: "Failed" });
    }

    // Validate imageOptions if present
    if (qr_config.imageOptions) {
      const { imageSize, margin } = qr_config.imageOptions;
      if (imageSize !== undefined && (typeof imageSize !== 'number' || imageSize < 0.1 || imageSize > 0.5)) {
        return res.status(400).json({ message: "Invalid logo image size (must be 0.1-0.5)", status: "Failed" });
      }
      if (margin !== undefined && (typeof margin !== 'number' || margin < 0 || margin > 50)) {
        return res.status(400).json({ message: "Invalid logo margin (must be 0-50)", status: "Failed" });
      }
    }

    const updateOperation = {
      $set: { qr_config }
    };

    // Invalidate user cache
    const userInfoCacheKey = cache.generateKey('user', 'info', _id);
    await cache.del(userInfoCacheKey);

    const updatedData = await User.findByIdAndUpdate(_id, updateOperation, { new: true });

    if (updatedData) {
      return res.status(200).json({
        message: "QR code configuration updated successfully",
        status: "Success",
        result: { qr_config: updatedData.qr_config }
      });
    } else {
      return res.status(404).json({ message: "User not found", status: "Failed" });
    }
  } catch (error) {
    console.error("Update QR config error:", error);
    return res.status(500).json({ message: "Something went wrong", status: "Failed" });
  }
};

// Track profile view (increment profile_views, skip self-views)
const trackProfileView = async (req, res) => {
  try {
    const profileUserId = req.params.id;
    const viewerUserId = req.user?._id?.toString();

    // Skip self-views
    if (viewerUserId && viewerUserId === profileUserId) {
      return res.status(200).json({
        status: 'Success',
        data: null,
        message: 'Self-view not tracked'
      });
    }

    const user = await User.findByIdAndUpdate(
      profileUserId,
      { $inc: { profile_views: 1 } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        status: 'Failed',
        message: 'User not found',
        data: null
      });
    }

    return res.status(200).json({
      status: 'Success',
      data: { profile_views: user.profile_views },
      message: 'Profile view tracked successfully'
    });
  } catch (error) {
    console.error('Track profile view error:', error);
    return res.status(500).json({
      status: 'Failed',
      message: 'Failed to track profile view',
      data: null
    });
  }
};

// Get comprehensive user analytics (engagement across posts, links, surveys)
const getUserAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    const Post = require('../models/postModel');
    const Link = require('../models/linkModel');
    const { Survey, Submission } = require('../models/surveyModel');

    // Get user profile views
    const user = await User.findById(userId, { profile_views: 1, followers: 1, followings: 1, createdAt: 1 });

    // Get posts analytics
    const posts = await Post.find({ posted_by: userId });
    const totalPostUpvotes = posts.reduce((sum, post) => sum + (post.upvoted_by?.length || 0), 0);
    const totalPostComments = posts.reduce((sum, post) => sum + (post.comments?.length || 0), 0);

    // Get links analytics
    const links = await Link.find({ posted_by: userId, access: true });
    const totalLinkViews = links.reduce((sum, link) => sum + (link.view_count || 0), 0);
    const totalLinkClicks = links.reduce((sum, link) => sum + (link.click_count || 0), 0);
    const totalLinkLikes = links.reduce((sum, link) => sum + (link.liked_by?.length || 0), 0);
    const totalLinkBookmarks = links.reduce((sum, link) => sum + (link.bookmarked_by?.length || 0), 0);

    // Get surveys analytics
    const surveys = await Survey.find({ created_by: userId, access: true });
    const totalSurveyViews = surveys.reduce((sum, survey) => sum + (survey.view_count || 0), 0);
    const totalSurveyResponses = surveys.reduce((sum, survey) => sum + (survey.submissions?.length || 0), 0);

    // Calculate engagement scores
    const totalEngagement = totalPostUpvotes + totalPostComments + totalLinkLikes + totalLinkBookmarks + totalSurveyResponses;
    const totalReach = (user.profile_views || 0) + totalLinkViews + totalSurveyViews;

    return res.status(200).json({
      status: 'Success',
      data: {
        profile: {
          profile_views: user.profile_views || 0,
          followers_count: user.followers?.length || 0,
          following_count: user.followings?.length || 0,
          member_since: user.createdAt
        },
        posts: {
          total_posts: posts.length,
          total_upvotes: totalPostUpvotes,
          total_comments: totalPostComments
        },
        links: {
          total_links: links.length,
          total_views: totalLinkViews,
          total_clicks: totalLinkClicks,
          total_likes: totalLinkLikes,
          total_bookmarks: totalLinkBookmarks,
          click_through_rate: totalLinkViews > 0 ? ((totalLinkClicks / totalLinkViews) * 100).toFixed(2) : 0
        },
        surveys: {
          total_surveys: surveys.length,
          total_views: totalSurveyViews,
          total_responses: totalSurveyResponses,
          completion_rate: totalSurveyViews > 0 ? ((totalSurveyResponses / totalSurveyViews) * 100).toFixed(2) : 0
        },
        summary: {
          total_engagement: totalEngagement,
          total_reach: totalReach,
          engagement_rate: totalReach > 0 ? ((totalEngagement / totalReach) * 100).toFixed(2) : 0
        }
      },
      message: 'User analytics fetched successfully'
    });
  } catch (error) {
    console.error('User analytics error:', error);
    return res.status(500).json({
      status: 'Failed',
      message: 'Failed to fetch analytics',
      data: null
    });
  }
};

module.exports = { allUsers, authUser, logout, updateUserProfile, fetchUsers, rejectFollowRequest, acceptFollowRequest, sendFollowRequest, getfollowersList, getUserInfo, listUserSessions, revokeSession, revokeAllSessions, updateAvatarConfig, updateQRConfig, trackProfileView, getUserAnalytics };
