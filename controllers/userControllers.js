const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Company = require("../models/companySchema");
const { toTitleCase, generateUserId, keepOnlyNumbers, generateToken } = require("../utils/utils.js");
const { default: mongoose } = require("mongoose");
const { getIo } = require("../utils/socketManger");
const Notifications = require("../models/notificationModel");
const getRedisInstance = require("../redisClient/redisClient.js");
const { tokenkeyName, cookieOptions } = require("../constants/index.js");




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

    const redis = getRedisInstance()
    const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${req.body._id}`
    const result = await redis.del(userInfoRedisKey);
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
    };

    const user = await User.findOne({ _id: userId, access: true }, projection)
    await redis.set(userInfoRedisKey, JSON.stringify(user), 'EX', 21600);

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

module.exports = { allUsers, authUser, logout, updateUserProfile, fetchUsers, rejectFollowRequest, acceptFollowRequest, sendFollowRequest, getfollowersList, getUserInfo };
