const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const ProfileDetails = require("../models/profileDetailsModel.js");

const Company = require("../models/companySchema");
const { toTitleCase, keepOnlyNumbers, generateToken } = require("../utils/utils.js");
const { default: mongoose } = require("mongoose");
const { getIo } = require("../utils/socketManger");
const Notifications = require("../models/notificationModel");
const getRedisInstance = require("../redisClient/redisClient.js");
const { tokenkeyName, cookieOptions } = require("../constants/index.js");
const { addOrupdateCachedDataInRedis } = require("../redisClient/redisUtils.js");


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
  profile_details: 1
};


// userId: string,
//   options?: {
//     projection?: any;
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

  // Fetch user with populated profile_details document
  const userDoc = await User.findOne({ _id: userId, access }, projection).populate({
    path: 'profile_details',
    ...populateOptions,
  });

  if (!userDoc) return null;

  // Convert mongoose doc to plain object
  const userObj = userDoc.toObject();
  console.log({ userDoc })
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

    console.log(req.user, keyword)
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

      addOrupdateCachedDataInRedis(userInfoRedisKey, updatedUser)
      return res.status(200).json({
        message: "Your Profile has been Updated Successfully", status: "Success", result: updatedUser
      })
    } else {
      return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
    }
  } catch (error) {
    console.log("error", error)
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

      addOrupdateCachedDataInRedis(userInfoRedisKey, updatedUser)
      return res.status(200).json({
        message: "Your Profile has been Updated Successfully", status: "Success", result: updatedUser
      })
    } else {
      return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
    }
  } catch (error) {
    console.log("error", error)
    return res.status(200).json({ message: "Something went Wrong", status: "Failed", })
  }
}

const getUserInfo = async (req, res) => {
  try {
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
    console.log({ error })
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
        await addOrupdateCachedDataInRedis(userInfoRedisKey, user);
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
    return res.status(e.status || 500).json({ status: 'Error', message: e.message });
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
    return res.status(e.status || 500).json({ status: 'Error', message: e.message });
  }
};

module.exports = { allUsers, authUser, logout, updateUserProfile, fetchUsers, rejectFollowRequest, acceptFollowRequest, sendFollowRequest, getfollowersList, getUserInfo, updateUserProfileDetails, getProfile, addProfileItem, deleteProfileItem, updateProfileItem, updateLayouts };
