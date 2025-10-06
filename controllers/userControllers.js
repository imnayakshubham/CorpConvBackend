const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const ProfileDetails = require("../models/profileDetailsModel.js");

const Company = require("../models/companySchema");
const { toTitleCase, keepOnlyNumbers, generateToken } = require("../utils/utils.js");
const { default: mongoose } = require("mongoose");
const { getIo } = require("../utils/socketManger");
const Notifications = require("../models/notificationModel");
const getRedisInstance = require("../redisClient/redisClient.js");
const { tokenkeyName, cookieOptions, isProd } = require("../constants/index.js");
const { addOrUpdateCachedDataInRedis, enqueueEmbeddingJob } = require("../redisClient/redisUtils.js");
const Item = require("../models/Item.js");
const userEmbedding = require("../models/userEmbedding.js");
const { recommendationQueue } = require("../queues/index.js");
const Recommendation = require("../models/Recommendation.js");
const { generateSingleEmbedding } = require("../services/computeEmbedding.js");
const logger = require("../utils/logger.js");
const { verifyFirebaseToken, getFirebaseUser } = require("../services/firebaseAdmin");
const { decryptUserData } = require("../utils/encryption");
const { getAuth } = require("../config/auth.js");


const projection = {
  user_job_role: 1,
  is_anonymous: 1,
  is_email_verified: 1,
  user_bio: 1,
  user_current_company_name: 1,
  user_id: 1,
  user_job_experience: 1,
  user_location: 1,
  public_user_name: 1,
  followings: 1,
  followers: 1,
  avatar: 1,
  user_public_profile_pic: 1,
  pending_followings: 1,
  profile_details: 1,
};


// userId: string,
//   options?: {
//     projection?: unknown;
//     populateOptions?: Parameters<typeof User.prototype.populate>[0];
//     profileItemsFilter?: (item: any) => boolean;
//   }

async function getUserWithFlatProfileDetails({
  userId,
  access = true,
  options,
}) {
  // Destructure options with defaults
  const { projection = null, populateOptions = {}, profileItemsFilter } = options || {};
  logger.info("id", userId)
  // Fetch user with populated profile_details document
  const userDoc = await User.findById(userId, projection).where({ access }).populate({
    path: 'profile_details',
    ...populateOptions,
  });

  if (!userDoc) return null;

  // Convert mongoose doc to plain object
  const userObj = userDoc.toObject();


  // Extract profile items array
  let profileItems = {
    layouts: userObj.profile_details?.layouts || {},
    items: userObj.profile_details?.items || []
  }

  // Return user with flattened, optionally filtered profile items
  return {
    ...userObj,
    profile_details: profileItems,
  };
}


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
    logger.error("error ==>", error)
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
  // For anonymous app - only send public, non-sensitive data to frontend
  // Sensitive data (email, actual name, phone) stays on backend only
  const decrypted = decryptUserData(result);

  return {
    // Core identity (non-sensitive)
    _id: decrypted._id,
    public_user_name: decrypted.public_user_name,  // Public display name only
    user_public_profile_pic: decrypted.user_public_profile_pic,
    is_anonymous: decrypted.is_anonymous,

    // Public profile information
    user_bio: decrypted.user_bio,
    user_job_role: decrypted.user_job_role,
    user_job_experience: decrypted.user_job_experience,
    user_current_company_name: decrypted.user_current_company_name,

    // Account status flags
    is_email_verified: decrypted.is_email_verified,
    isAdmin: decrypted.isAdmin,

    // Premium subscription
    has_premium: decrypted.has_premium || false,
    premium_expires_at: decrypted.premium_expires_at || null,
    premium_plan: decrypted.premium_plan || 'free'
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
          result: { ...responseFormatterForAuth(result), _id: result._id }
        });
      }
    }
  } catch (error) {
    console.log({ error })
    return res.status(200).json({ message: error, status: "Failed" });
  }
};

/**
 * Logout
 * POST /api/auth/logout
 */
const logout = async (req, res) => {
  try {
    const updateOperation = {
      $set: {
        'token': null,
      },
    };
    const updatedData = await User.updateOne({ token: req.user.token }, updateOperation)

    if (updatedData) {
      res.clearCookie(tokenkeyName);
      return res.status(200).json({ message: "Logged Out", status: "Success" })
    } else {
      return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
    }
  } catch (error) {
    logger.error("error ==>", error)

    return res.status(200).json({ message: "Something went Wrong", status: "Failed", })

  }
}

const updateUserProfile = async (req, res) => {

  const userId = req.body._id ?? req.user._id;

  if (!userId) {
    return res.status(400).json({
      message: "User ID is required",
      status: "Failed",
      result: [],
    });
  }

  try {
    const userInfo = await User.findOne({ _id: req.body._id ?? req.user._id })
    if (!userInfo) {
      return res.status(200).json({ message: "No User Exist", status: "Failed", })
    }
    const profession = req.body.profession

    let role = null
    let suffix = null

    let updateFields = {
      ...req.body,
    }

    if (profession) {
      role = profession === "student" ? req.body.field_of_study : profession === "homemaker" ? `Anything & Everything` : req.body.user_job_role
      suffix = profession === "homemaker" ? profession : req.body.user_current_company_name ? req.body.user_current_company_name : userInfo.user_current_company_name
      updateFields = {
        ...updateFields,
        public_user_name: `${toTitleCase(role)} @ ${toTitleCase(suffix)}`,
        user_job_experience: Number(req.body.user_job_experience)
      }
    }


    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      { $set: updateFields },
      { new: true, projection }
    );
    if (updatedUser) {
      const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${userId}`

      addOrUpdateCachedDataInRedis(userInfoRedisKey, updatedUser)


      const textToEmbed = `Public Name: ${user.public_user_name || ''}
          Profession: ${user.profession || ''}
          Hobbies: ${(user.hobbies ?? [])?.join(', ')}
          Bio: ${user.user_bio || ''}
          Academic level: ${user.academic_level || ''}
          Field of study: ${user.field_of_study || ''}
        `

      const { embedding } = await generateSingleEmbedding(userId, textToEmbed)


      // Upsert embedding document to keep in sync
      await userEmbedding.findOneAndUpdate(
        { userId },
        { embedding, lastUpdated: new Date() },
        { upsert: true, new: true }
      );

      return res.status(200).json({
        message: "Your Profile has been Updated Successfully", status: "Success", result: updatedUser
      })
    } else {
      return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
    }
  } catch (error) {
    logger.error("error ==>", error)
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
  }
}



const updateUserProfileDetails = async (req, res) => {

  const userId = req.body._id ?? req.user._id;

  if (!userId) {
    return res.status(400).json({
      message: "User ID is required",
      status: "Failed",
      result: [],
    });
  }

  try {
    const userInfo = await User.findOne({ _id: req.body._id ?? req.user._id })
    if (!userInfo) {
      return res.status(200).json({ message: "No User Exist", status: "Failed", })
    }
    const profession = req.body.profession

    let role = null
    let suffix = null

    let updateFields = {
      ...req.body,
    }

    if (profession) {
      role = profession === "student" ? req.body.field_of_study : profession === "homemaker" ? `Anything & Everything` : req.body.user_job_role
      suffix = profession === "homemaker" ? profession : req.body.user_current_company_name ? req.body.user_current_company_name : userInfo.user_current_company_name
      updateFields = {
        ...updateFields,
        public_user_name: `${toTitleCase(role)} @ ${toTitleCase(suffix)}`,
        user_job_experience: Number(req.body.user_job_experience)
      }
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      { $set: updateFields },
      { new: true, projection }
    ).populate("project_details");
    if (updatedUser) {
      const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${userId}`

      addOrUpdateCachedDataInRedis(userInfoRedisKey, updatedUser)
      return res.status(200).json({
        message: "Your Profile has been Updated Successfully", status: "Success", result: updatedUser
      })
    } else {
      return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
    }
  } catch (error) {
    logger.error("error ==>", error)
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
  }
}

const getUserInfo = async (req, res) => {
  try {
    logger.info("req.params", req.params)
    const userId = req.params?.id
    if (!userId) {
      return res.status(200).json({ message: "Unable to find User...", status: "Failed", })
    }

    const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${userId}`
    const redis = getRedisInstance()
    const cachedData = await redis.get(userInfoRedisKey)

    if (cachedData) {
      const parsedCachedData = JSON.parse(cachedData)
      if (parsedCachedData) {
        return res.status(200).json({ message: "User Profile Found (Cached)", status: "Success", result: parsedCachedData })
      } else {
        return res.status(404).json({ message: "Sorry, it appears this user doesn't exist. (Cached)", status: "Failed", result: parsedCachedData })
      }
    }

    const user = await getUserWithFlatProfileDetails({ userId, options: { projection } })

    if (user) {
      await redis.set(userInfoRedisKey, JSON.stringify(user), 'EX', 21600);
      return res.status(200).json({ message: "User Profile Found", status: "Success", result: user })
    } else {
      return res.status(404).json({ message: "Sorry, it appears this user doesn't exist.", status: "Failed", result: null })
    }

  } catch (error) {
    logger.error("error ==>", error)
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
    const userLoggedId = payload?._id ?? req.user?._id

    const keysToRetrieve = ["is_anonymous", "is_email_verified", "user_bio", "user_current_company_name", "user_id", "user_job_experience", "user_location", "public_user_name", "is_email_verified", "avatar", "user_public_profile_pic", ...(!!userLoggedId ? ["pending_followings", "followings", "followers"] : [])]
    const projection = keysToRetrieve.reduce((acc, key) => {
      acc[`${key}`] = 1;
      return acc;
    }, {});

    if (payload.type === "all_users") {
      const currentUser = await User.findOne({ _id: payload?._id ?? userLoggedId }).select("followings pending_followings followers");

      const ignoredIds = [
        ...(currentUser?.followings ?? []),
        ...(currentUser?.pending_followings ?? []),
        ...(currentUser?.followers ?? []),
        ...(userLoggedId ? [userLoggedId] : []),
      ];


      let usersList = []

      const limitParam = req.body.limit;

      if (limitParam !== undefined) {
        const limitNum = parseInt(limitParam, 10);
        if (!isNaN(limitNum) && limitNum > 0) {
          usersList = await User.find(
            {
              access: true,
              _id: { $nin: ignoredIds },
              public_user_name: { $ne: null }
            },
            { public_user_name: 1, avatar: 1, user_bio: 1, user_public_profile_pic: 1 }
          ).limit(limitNum)
        }
      } else {
        usersList = await User.find(
          {
            access: true,
            _id: { $nin: ignoredIds },
          },
          { ...projection }
        ).sort({ createdAt: -1 });
      }

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
    logger.error("error ==>", error)
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", result: [] })
  }
}


// ----------------------------------------------------------
const sendFollowRequest = async (req, res) => {
  const { senderId, receiverId } = req.body;
  if (!senderId || !receiverId) {
    return res.status(400).json({
      message: "Missing senderId or receiverId",
      status: "Failed",
      result: []
    });
  }

  const redis = getRedisInstance();

  try {
    const [senderUser, receiverUser] = await Promise.all([
      User.findById(senderId).select(projection).lean(),
      User.findById(receiverId).select(projection).lean()
    ]);

    if (!senderUser || !receiverUser) {
      return res.status(404).json({
        message: "Sender or receiver not found",
        status: "Failed",
        result: []
      });
    }

    const isWithdrawal = receiverUser.pending_followings?.includes(senderId);
    let updatedSender = null;

    if (isWithdrawal) {
      updatedSender = await User.findByIdAndUpdate(
        senderId,
        { $pull: { followings: receiverId } },
        { new: true, projection, lean: true }
      );
      await User.findByIdAndUpdate(
        receiverId,
        { $pull: { pending_followings: senderId } },
        { new: true, projection, lean: true }
      );
    } else {
      updatedSender = await User.findByIdAndUpdate(
        senderId,
        { $addToSet: { followings: receiverId } },
        { new: true, projection, lean: true }
      );
      const updatedReceiver = await User.findByIdAndUpdate(
        receiverId,
        { $addToSet: { pending_followings: senderId } },
        { new: true, projection, lean: true }
      );

      const notification = await Notifications.create({
        content: `${senderUser.public_user_name} sent you a follow request`,
        receiverId
      });
      if (notification) {
        getIo().to(receiverId).emit("follow_request_send_notification", notification);
      }

      // Optionally cache receiver's updated info too:
      const receiverKey = `${process.env.APP_ENV}_user_info_${receiverId}`;
      await redis.set(receiverKey, JSON.stringify(updatedReceiver), 'EX', 21600);
    }


    // Cache the updated sender data
    if (updatedSender) {
      const senderKey = `${process.env.APP_ENV}_user_info_${senderId}`;
      await redis.set(senderKey, JSON.stringify(updatedSender), 'EX', 21600);
    }

    return res.status(200).json({
      message: "User info updated",
      status: "Success",
      result: updatedSender || []
    });
  } catch (error) {
    console.error("Error processing follow request:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      status: "Failed",
      result: []
    });
  }
};

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


function assertSelf(userId, authedId) {
  if (!userId || !authedId || userId.toString() !== authedId.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
}

function sanitizeItemPayload(payload, userId) {
  const { type, content, name, img_url, link } = payload || {};
  if (!['title', 'text', 'image', 'links', 'socialLink'].includes(type)) {
    const err = new Error('Invalid type');
    err.status = 400;
    throw err;
  }
  return {
    type, content: content ?? null, name: name ?? null,
    img_url: img_url ?? null, link: link ?? null,
    created_by: userId,
    ...payload
  };
}

// GET /users/:user_id/

const getProfile = async (req, res) => {
  try {
    const { user_id } = req.params;
    const user = await User.findById(user_id).select('profile_details').lean();
    if (!user) return res.status(404).json({ status: 'Failed', message: 'User not found' });
    const profile = user.profile_details
      ? await ProfileDetails.findById(user.profile_details).lean()
      : null;
    return res.json({ status: 'Success', result: profile ?? { layouts: {}, items: [] } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ status: 'Error', message: e.message });
  }
};

// POST /users/:user_id/profile/items  (add item)
const addProfileItem = async (req, res) => {
  const authedId = req.user?._id;
  const { user_id } = req.params;

  try {
    assertSelf(user_id, authedId);
    const sanitized = sanitizeItemPayload(req.body, authedId);
    console.log({ sanitized })

    const session = await mongoose.startSession();
    let createdItem;
    await session.withTransaction(async () => {
      // ensure user & profile
      let user = await User.findOne({ _id: user_id, access: true }).select(projection).session(session);
      if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
      console.log({ user })
      let profile;
      if (!user.profile_details) {
        profile = await ProfileDetails.create([{ created_by: authedId, layouts: {}, items: [] }], { session });
        console.log({ profile })
        user.profile_details = profile[0]._id;
        await user.save({ session });
        profile = profile[0];
      } else {
        profile = await ProfileDetails.findById(user.profile_details).session(session);
        if (!profile) throw Object.assign(new Error('Profile not found'), { status: 404 });
      }

      profile.items.push(sanitized);
      await profile.save({ session });

      user = {
        ...user.toObject(),
        profile_details: profile
      }

      if (user) {
        const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${user_id}`;
        await addOrUpdateCachedDataInRedis(userInfoRedisKey, user);
      }

      createdItem = profile.items[profile.items.length - 1];
    });

    return res.status(201).json({
      status: 'Success',
      message: 'Item created',
      result: createdItem
    });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ status: 'Error', message: e.message });
  }
};

// PUT /users/:user_id/profile/items/:item_id  (update item metadata)
const updateProfileItem = async (req, res) => {
  const authedId = req.user?._id;
  const { user_id, item_id } = req.params;

  try {
    assertSelf(user_id, authedId);
    // whitelist updatable fields
    const { content, name, img_url, link, access } = req.body || {};
    const updates = {};
    if (content !== undefined) updates.content = content;
    if (name !== undefined) updates.name = name;
    if (img_url !== undefined) updates.img_url = img_url;
    if (link !== undefined) updates.link = link;
    if (access !== undefined) updates.access = !!access;

    const user = await User.findById(user_id).select('profile_details').lean();
    if (!user || !user.profile_details) return res.status(404).json({ status: 'Failed', message: 'Profile not found' });

    const result = await ProfileDetails.findOneAndUpdate(
      { _id: user.profile_details, 'items._id': item_id },
      { $set: Object.fromEntries(Object.entries(updates).map(([k, v]) => [`items.$.${k}`, v])) },
      { new: true, projection: { items: { $elemMatch: { _id: item_id } } } }
    );

    if (!result || !result.items?.length) return res.status(404).json({ status: 'Failed', message: 'Item not found' });
    return res.json({ status: 'Success', message: 'Item updated', result: result.items[0] });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ status: 'Error', message: e.message });
  }
};

// DELETE (soft) /users/:user_id/profile/items/:item_id
// Also remove the item id from all breakpoints in layouts to prevent rendering "dangling" ids.
const deleteProfileItem = async (req, res) => {
  const authedId = req.user?._id;
  const { user_id, item_id } = req.params;

  try {
    assertSelf(user_id, authedId);

    const session = await mongoose.startSession();
    let updated;
    await session.withTransaction(async () => {
      const user = await User.findById(user_id).select('profile_details').session(session);
      if (!user || !user.profile_details) throw Object.assign(new Error('Profile not found'), { status: 404 });

      const profile = await ProfileDetails.findById(user.profile_details).session(session);
      if (!profile) throw Object.assign(new Error('Profile not found'), { status: 404 });

      // soft delete
      const item = profile.items.id(item_id);
      if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
      item.access = false;

      // prune from layouts
      const bps = ['lg', 'md', 'sm', 'xs', 'xxs'];
      for (const bp of bps) {
        profile.layouts[bp] = (profile.layouts[bp] || []).filter(li => li.i !== String(item_id));
      }

      updated = await profile.save({ session });
    });

    return res.json({ status: 'Success', message: 'Item soft-deleted and removed from layouts' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ status: 'Failed', message: e.message });
  }
};

// PUT /users/:user_id/profile/layouts  (save responsive layouts)
const updateLayouts = async (req, res) => {
  const authedId = req.user?._id;
  const { user_id } = req.params;
  const layouts = req.body?.layouts;

  try {
    assertSelf(user_id, authedId);

    // Minimal shape validation: ensure keys are arrays of layout items with required fields
    const bps = ['lg', 'md', 'sm', 'xs', 'xxs'];
    for (const bp of bps) {
      if (layouts[bp] && !Array.isArray(layouts[bp])) {
        const err = new Error(`layouts.${bp} must be an array`);
        err.status = 400; throw err;
      }
      (layouts[bp] || []).forEach(li => {
        ['i', 'x', 'y', 'w', 'h'].forEach(k => {
          if (li[k] === undefined) {
            const err = new Error(`layouts.${bp}[].${k} is required`);
            err.status = 400; throw err;
          }
        });
      });
    }


    const user = await User.findById(user_id, { access: true }).select('profile_details').lean();

    if (!user) return res.status(404).json({ status: 'Failed', message: 'Profile not found' });

    const updated = await ProfileDetails.findByIdAndUpdate(
      user.profile_details,
      { $set: { layouts } },
      { new: true, projection: { layouts: 1 } }
    );

    return res.json({ status: 'Success', message: 'Layouts updated', result: updated?.layouts });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ status: 'Failed', message: e.message });
  }
};


// '/recommend/:userId'
function paginate(list, limit) {
  const hasMore = list.length > limit;
  const results = hasMore ? list.slice(0, limit) : list;
  const nextCursor = hasMore ? list[limit]._id.toString() : null;
  return { results, nextCursor };
}

const getUserRecommendations = async (req, res) => {
  console.log("user_id",)

  try {
    const { user_id = null } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const cursor = req.query.cursor || null;
    const filter = cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {};

    // List all users if user_id is "users"
    if (!user_id) {
      const users = await User.find(filter, { ...projection })
        .sort({ _id: 1 })
        .limit(limit + 1)
        .lean();

      const { results: records, nextCursor } = paginate(users, limit);
      return res.success({
        status: "Success",
        message: "Users fetched",
        result: { data: records, nextCursor }
      });
    }

    // Personalized recommendations for specific user_id
    const user = await User.findById(user_id, { ...projection }).lean();
    if (!user) {
      return res.error({ status: "Error", message: "User not found", code: 404 });
    }

    // Fetch recommendations document for user
    const recDoc = await Recommendation.findOne({ user_id }).lean();


    // If no recommendations exist, enqueue background computation and fallback to users list
    if (!recDoc || !recDoc.items || recDoc.items.length === 0) {
      // Assuming recommendationQueue is correctly initialized and imported elsewhere
      recommendationQueue.add(
        'compute',
        { user_id, limit: 500 },
        { removeOnComplete: true, removeOnFail: true }
      );

      // Fallback: get all users except current user, paginate and return
      const fallbackUsers = await User.find({ _id: { $ne: user._id } }, { ...projection })
        .sort({ _id: 1 })
        .limit(limit + 1)
        .lean();

      const { results, nextCursor } = paginate(fallbackUsers, limit);

      return res.json({
        status: "Success",
        message: "Fallback users fetched",
        result: { data: results, nextCursor }
      });
    }

    // If recommendations exist, we merge with user data and add recommendation_value key
    // Apply pagination on recommendations
    let recommendationItems = recDoc.items;

    // If cursor is provided, find index of cursor in the items list
    if (cursor) {
      const cursorIndex = recommendationItems.findIndex(item => item.user_id.toString() === cursor);
      if (cursorIndex >= 0) {
        // slice from next element after cursor
        recommendationItems = recommendationItems.slice(cursorIndex + 1);
      }
    }

    // Limit the recommendation items to requested limit + 1 for nextCursor calculation
    const limitedItems = recommendationItems.slice(0, limit + 1);

    // Extract user ids from recommendation items
    const recommendedUserIds = limitedItems.map(item => item.user_id.toString());

    // Fetch full user details for these recommended users
    const recommendedUsers = await User.find({ _id: { $in: recommendedUserIds, $ne: user_id } }, { ...projection })
      .lean();

    // Map user details by _id string for quick lookup
    const userMap = new Map(recommendedUsers.map(u => [u._id.toString(), u]));

    // Compose final results with recommendation_value added
    const results = limitedItems.map(item => {
      const user = userMap.get(item.user_id.toString());
      return user ? { ...user, recommendation_value: item.recommendation_value } : null;
    }) // filter out nulls if any
    // Determine nextCursor for pagination
    const nextCursor = limitedItems.length > limit ? limitedItems[limit].user_id.toString() : null;

    return res.json({
      status: 'Success',
      message: 'Recommendations fetched',
      result: {
        data: results,
        nextCursor
      },
    });
  } catch (err) {
    logger.error("error ==>", err)
    return res.error({
      status: "Failed",
      message: "Internal server error",
      error: process.env.NODE_ENV === 'production' ? null : err.message,
      code: 500
    });
  }
};


/**
 * Generate JWT tokens for authentication
 * @param {string} userId - User ID
 * @returns {Object} - Access and refresh tokens
 */
const generateTokens = (userId) => {
  const accessToken = generateToken(userId, '7d'); // 7 days (extended from 15m)
  const refreshToken = generateToken(userId, '30d'); // 30 days (extended from 7d)
  return { accessToken, refreshToken };
}

/**
 * Set authentication cookies
 * @param {Object} res - Express response object
 * @param {string} accessToken - JWT access token
 * @param {string} refreshToken - JWT refresh token
 */
const setAuthCookies = (res, accessToken, refreshToken) => {
  // Main auth token (httpOnly for security)
  res.cookie(tokenkeyName, accessToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (extended from 15 minutes)
  });

  // Refresh token (httpOnly, longer expiry)
  res.cookie(`${tokenkeyName}:refresh`, refreshToken, {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days (extended from 7 days)
  });

  // Client-readable auth status (not httpOnly) - matches access token expiry
  res.cookie('isAuthenticated', 'true', {
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    httpOnly: false, // Must be readable by client JavaScript
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (extended from 15 minutes)
    path: '/',
    domain: isProd ? undefined : 'localhost'
  });
}

/**
 * Clear authentication cookies
 * @param {Object} res - Express response object
 */
const clearAuthCookies = (res) => {
  const clearOptions = {
    ...cookieOptions,
    maxAge: 0
  };

  res.clearCookie(tokenkeyName, clearOptions);
  res.clearCookie(`${tokenkeyName}:refresh`, clearOptions);
  res.clearCookie('isAuthenticated', {
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    domain: isProd ? undefined : 'localhost'
  });
}

/**
 * Firebase Google Authentication
 * POST /api/user/firebase-google
 *
 * SECURITY: This endpoint only uses Firebase token for UID verification.
 * User data is fetched from Firebase Admin SDK (not from the token payload)
 * to prevent client-side tampering and ensure data integrity.
 *
 * NOTE: Route moved from /api/auth/firebase-google to /api/user/firebase-google
 * to avoid conflict with Better Auth handler at /api/auth/*
 */
const firebaseGoogleAuth = asyncHandler(async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({
      success: false,
      error: "Firebase ID token is required"
    });
  }

  try {
    // SECURITY: Verify Firebase token and extract ONLY uid
    const firebaseResult = await verifyFirebaseToken(idToken);

    if (!firebaseResult.success) {
      return res.status(401).json({
        success: false,
        error: "Invalid Firebase token",
        detail: firebaseResult.error
      });
    }

    const firebaseUid = firebaseResult.uid;

    // SECURITY: Fetch user data from Firebase Admin SDK (server-side, trusted source)
    // Instead of using data from the ID token (which contains user info from client)
    const firebaseUserResult = await getFirebaseUser(firebaseUid);

    if (!firebaseUserResult.success) {
      return res.status(401).json({
        success: false,
        error: "Failed to fetch user data from Firebase",
        detail: firebaseUserResult.error
      });
    }

    console.log(firebaseResult)

    const firebaseUserRecord = firebaseUserResult.user;
    const firebaseEmail = firebaseUserRecord.email;
    const firebaseDisplayName = firebaseUserRecord.displayName;
    const firebasePhotoURL = firebaseUserRecord.photoURL;
    const firebaseEmailVerified = firebaseUserRecord.emailVerified;

    // Check if user exists in our database
    let userData = await User.findOne({
      $or: [
        { user_email_id: firebaseEmail },
        { secondary_email_id: firebaseEmail },
        { firebaseUid: firebaseUid }
      ]
    });

    if (userData) {
      // Update existing user with Firebase UID if not set
      if (!userData.firebaseUid) {
        userData.firebaseUid = firebaseUid;
        await userData.save();
      }

      // Generate minimal JWT tokens (only contains user ID)
      const { accessToken, refreshToken } = generateTokens(userData._id);
      setAuthCookies(res, accessToken, refreshToken);

      logger.info(`User logged in: ${userData.user_email_id}`);

      return res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          user: responseFormatterForAuth(userData._doc),
          token: accessToken  // JWT contains only { id: userId }
        }
      });

    } else {
      // Create new user from Firebase Admin SDK data (trusted source)
      const emailSplit = firebaseEmail.split("@");
      const domain = emailSplit[1].split(".")[0];
      const companyExist = await Company.findOne({ company_name: toTitleCase(domain) });
      const companyId = companyExist?.company_id || new mongoose.Types.ObjectId();
      const companyName = companyExist?.company_name || toTitleCase(domain);

      // Create company if it doesn't exist
      if (!companyExist) {
        const company = new Company({
          company_id: companyId,
          company_name: companyName
        });
        await company.save();
      }

      const user_current_company_name = !["example", "gmail", "outlook"].includes(domain)
        ? toTitleCase(domain)
        : "Somewhere";

      const newUserData = {
        user_email_id: firebaseEmail,
        public_user_name: firebaseDisplayName || firebaseEmail.split('@')[0],
        is_email_verified: firebaseEmailVerified,
        is_anonymous: false,
        user_current_company_name,
        user_company_id: companyId,
        user_past_company_history: [companyId],
        primary_email_domain: emailSplit[1],
        firebaseUid: firebaseUid,
        user_public_profile_pic: firebasePhotoURL || null,
        access: true
      };

      const newUser = new User(newUserData);
      await newUser.save();

      // Generate minimal JWT tokens (only contains user ID)
      const { accessToken, refreshToken } = generateTokens(newUser._id);
      setAuthCookies(res, accessToken, refreshToken);

      logger.info(`New user created: ${newUser.user_email_id} (Data from Firebase Admin SDK)`);

      return res.status(201).json({
        success: true,
        message: "User created and logged in successfully",
        data: {
          user: responseFormatterForAuth(newUser._doc),
          token: accessToken  // JWT contains only { id: userId }
        }
      });
    }

  } catch (error) {
    logger.error("Firebase Google auth error:", error);
    return res.status(500).json({
      success: false,
      error: "Authentication failed",
      detail: error.message
    });
  }
});

/**
 * Token Refresh
 * POST /api/auth/refresh
 */
const refreshToken = asyncHandler(async (req, res) => {
  const refreshTokenCookie = req.cookies?.[`${tokenkeyName}:refresh`];

  if (!refreshTokenCookie) {
    return res.status(401).json({
      success: false,
      error: "Refresh token not found"
    });
  }

  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(refreshTokenCookie, process.env.JWT_SECRET_KEY);

    // Check if user still exists and has access
    const user = await User.findOne({ _id: decoded.id, access: true });

    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: "User not found or access revoked"
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);
    setAuthCookies(res, accessToken, newRefreshToken);

    return res.status(200).json({
      success: true,
      message: "Tokens refreshed successfully",
      data: {
        user: responseFormatterForAuth(user._doc),
        token: accessToken
      }
    });

  } catch (error) {
    clearAuthCookies(res);
    return res.status(401).json({
      success: false,
      error: "Invalid refresh token"
    });
  }
});

/**
 * Get Current User
 * GET /api/auth/me
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user: responseFormatterForAuth(user._doc)
      }
    });

  } catch (error) {
    logger.error("Get current user error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user data"
    });
  }
});



/**
 * Send Magic Link (Better-auth Email OTP)
 * POST /api/auth/send-magic-link
 */
const sendMagicLink = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email is required"
    });
  }

  console.log({ email })
  try {
    // Check if email credentials are configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      logger.error("Email credentials not configured (EMAIL_USER or EMAIL_PASS missing)");
      return res.status(500).json({
        success: false,
        error: "Email service not configured. Please contact support."
      });
    }

    // Use better-auth's email OTP functionality
    // This will trigger the sendOTP function configured in config/auth.js
    const result = await generateMagicLink(email);
    console.log({ result })
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to send magic link"
      });
    }

    // Send the magic link via email
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"${process.env.APP_NAME || 'Hushwork'}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Magic Link",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Sign in to ${process.env.APP_NAME || 'Hushwork'}</h2>
          <p>Click the button below to sign in to your account:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${result.url}"
               style="background: #007bff; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Sign In
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${result.url}">${result.url}</a>
          </p>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 15 minutes for security reasons.
          </p>
        </div>
      `
    });

    logger.info(`Magic link sent to ${email}`);

    return res.status(200).json({
      success: true,
      message: "Magic link sent successfully"
    });

  } catch (error) {
    logger.error("Send magic link error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to send magic link"
    });
  }
});

/**
 * Verify Magic Link or OTP
 * POST /api/auth/verify
 */
const verifyAuth = asyncHandler(async (req, res) => {
  const { email, otp, token, type } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email is required"
    });
  }

  try {
    let verificationResult;

    if (type === 'magic-link' && token) {
      // Verify magic link token
      verificationResult = verifyMagicToken(email, token);
    } else if (type === 'otp' && otp) {
      // Verify OTP
      verificationResult = verifyOTPHelper(email, otp);
    } else {
      return res.status(400).json({
        success: false,
        error: "Invalid verification type or missing credentials"
      });
    }

    if (!verificationResult.success) {
      return res.status(400).json({
        success: false,
        error: verificationResult.error
      });
    }

    // Find or create user
    let user = await User.findOne({ user_email_id: email });

    if (!user) {
      // Create new user
      const emailSplit = email.split("@");
      const domain = emailSplit[1].split(".")[0];
      const companyExist = await Company.findOne({ company_name: toTitleCase(domain) });
      const companyId = companyExist?.company_id || new mongoose.Types.ObjectId();

      if (!companyExist) {
        const company = new Company({
          company_id: companyId,
          company_name: toTitleCase(domain)
        });
        await company.save();
      }

      const user_current_company_name = !["example", "gmail", "outlook"].includes(domain)
        ? toTitleCase(domain)
        : "Somewhere";

      user = new User({
        user_email_id: email,
        public_user_name: email.split('@')[0],
        is_email_verified: true,
        is_anonymous: false,
        user_current_company_name,
        user_company_id: companyId,
        user_past_company_history: [companyId],
        primary_email_domain: emailSplit[1],
        access: true
      });

      await user.save();
      logger.info(`New user created via ${type}: ${email}`);
    }

    // Generate tokens and set cookies
    const { accessToken, refreshToken } = generateTokens(user._id);
    setAuthCookies(res, accessToken, refreshToken);

    logger.info(`User verified via ${type}: ${email}`);

    return res.status(200).json({
      success: true,
      message: "Authentication successful",
      data: {
        user: responseFormatterForAuth(user._doc),
        token: accessToken
      }
    });

  } catch (error) {
    logger.error("Verify auth error:", error);
    return res.status(500).json({
      success: false,
      error: "Verification failed"
    });
  }
});


// Update premium status
const updatePremiumStatus = asyncHandler(async (req, res) => {
  const { has_premium, premium_plan, premium_expires_at } = req.body;

  // Validate input
  if (typeof has_premium !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: "has_premium must be a boolean"
    });
  }

  const validPlans = ["free", "monthly", "yearly", "lifetime"];
  if (premium_plan && !validPlans.includes(premium_plan)) {
    return res.status(400).json({
      success: false,
      error: `premium_plan must be one of: ${validPlans.join(", ")}`
    });
  }

  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Update premium status
    user.has_premium = has_premium;

    if (premium_plan) {
      user.premium_plan = premium_plan;
    }

    if (premium_expires_at) {
      user.premium_expires_at = new Date(premium_expires_at);
    } else if (has_premium && premium_plan === "lifetime") {
      user.premium_expires_at = null; // null means lifetime
    } else if (!has_premium) {
      user.premium_plan = "free";
      user.premium_expires_at = null;
    }

    // Check if premium has expired
    if (user.has_premium && user.premium_expires_at && new Date() > user.premium_expires_at) {
      user.has_premium = false;
      user.premium_plan = "free";
    }

    await user.save();

    logger.info(`Premium status updated for user ${user.user_email_id}: ${has_premium} (${user.premium_plan})`);

    // Return decrypted user data
    const decryptedUser = decryptUserData(user._doc);

    return res.status(200).json({
      success: true,
      message: "Premium status updated successfully",
      data: {
        user: responseFormatterForAuth(decryptedUser)
      }
    });

  } catch (error) {
    logger.error("Update premium status error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update premium status"
    });
  }
});


module.exports = {
  allUsers, authUser, logout, updateUserProfile, fetchUsers, rejectFollowRequest, acceptFollowRequest, sendFollowRequest, getfollowersList, getUserInfo, updateUserProfileDetails, getProfile, addProfileItem, deleteProfileItem, updateProfileItem, updateLayouts, getUserRecommendations, firebaseGoogleAuth,
  refreshToken,
  getCurrentUser,
  updatePremiumStatus,
  sendMagicLink,
  verifyAuth
};
