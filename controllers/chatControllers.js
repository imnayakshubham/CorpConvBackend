const asyncHandler = require("express-async-handler");
const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const mongoose = require('mongoose');
const cache = require("../redisClient/cacheHelper");
const TTL = require("../redisClient/cacheTTL");

const accessChat = asyncHandler(async (req, res) => {
  const { userId } = req.body;

  try {
    if (!userId) {
      return res.sendStatus(400);
    }

    // Check if chat already exists
    let isChat = await Chat.find({
      isGroupChat: false,
      $and: [
        { users: { $elemMatch: { $eq: req.user._id } } },
        { users: { $elemMatch: { $eq: userId } } },
      ],
    }).populate({ path: "users", select: "public_user_name username user_job_experience user_current_company_name" })
      .populate("latestMessage");

    isChat = await User.populate(isChat, {
      path: "latestMessage.sender",
      select: "public_user_name user_job_experience",
    });

    if (isChat.length > 0) {
      const existing = isChat[0];
      // Block if this user was previously rejected by the other person
      if (existing.status === 'rejected' && existing.requestedBy?.toString() === req.user._id.toString()) {
        return res.status(403).json({ status: 'rejected', message: 'This user has declined your message request.' });
      }
      return res.send(existing);
    }

    // Check mutual follow to decide status
    const [currentUser, targetUser] = await Promise.all([
      User.findById(req.user._id).select('followings'),
      User.findById(userId).select('followings'),
    ]);
    const currentFollowsTarget = currentUser?.followings?.map(String).includes(String(userId));
    const targetFollowsCurrent = targetUser?.followings?.map(String).includes(String(req.user._id));
    const isMutual = currentFollowsTarget && targetFollowsCurrent;

    const chatData = {
      chatName: "sender",
      isGroupChat: false,
      users: [req.user._id, userId],
      status: isMutual ? 'accepted' : 'pending',
      requestedBy: isMutual ? null : req.user._id,
    };

    const createdChat = await Chat.create(chatData);

    const currentUserChatsKey = cache.generateKey('chats', 'user', req.user._id);
    const otherUserChatsKey = cache.generateKey('chats', 'user', userId);
    await cache.del(currentUserChatsKey, otherUserChatsKey);

    const FullChat = await Chat.findOne({ _id: createdChat._id }).populate("users", "-token");
    return res.status(200).json(FullChat);
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

const fetchChats = asyncHandler(async (req, res) => {
  try {
    // Try to get from cache
    const cacheKey = cache.generateKey('chats', 'user', req.user._id);
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.status(200).send({ status: "Success", message: "chats found for the user. (Cached)", result: cached });
    }

    const results = await Chat.find({
      users: { $elemMatch: { $eq: req.user._id } },
      $or: [
        { status: 'accepted' },
        { status: 'pending', requestedBy: req.user._id },
        { status: 'rejected', requestedBy: req.user._id },
      ],
    })
      .populate({
        path: "users",
        select: "public_user_name username user_job_experience user_current_company_name"
      })
      .populate("groupAdmin")
      .populate("latestMessage")
      .sort({ updatedAt: -1 })
      .exec();



    if (results.length > 0) {
      await User.populate(results, {
        path: "latestMessage.sender",
        select: "public_user_name username user_job_experience user_current_company_name",
      });

      // Cache the results
      await cache.set(cacheKey, results, TTL.CHATS_LIST);

      return res.status(200).send({ status: "Success", message: "chats found for the user.", result: results });

    } else {
      return res.status(200).send({ status: "Success", message: "No chats found for the user.", result: results });
    }
  } catch (error) {
    console.log({ error })
    return res.status(200).send({ status: "Failed", message: "Something went Wrong", result: [] });
  }
});

//@description     Create New Group Chat
//@route           POST /api/chat/group
//@access          Protected
const createGroupChat = asyncHandler(async (req, res) => {
  if (!req.body.users || !req.body.name) {
    return res.status(400).send({ message: "Please Fill all the feilds" });
  }

  let users;
  try {
    users = JSON.parse(req.body.users);
  } catch {
    return res.status(400).json({ status: 'Failed', message: 'Invalid users format', data: null });
  }

  if (users.length < 2) {
    return res
      .status(400)
      .send("More than 2 users are required to form a group chat");
  }

  users.push(req.user);

  try {
    const groupChat = await Chat.create({
      chatName: req.body.name,
      users: users,
      isGroupChat: true,
      groupAdmin: req.user,
    });

    // Invalidate chats cache for all users in the group
    const cacheKeysToDelete = users.map(user =>
      cache.generateKey('chats', 'user', user._id || user)
    );
    await cache.del(cacheKeysToDelete);

    const fullGroupChat = await Chat.findOne({ _id: groupChat._id })
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    res.status(200).json(fullGroupChat);
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

// @desc    Rename Group
// @route   PUT /api/chat/rename
// @access  Protected
const renameGroup = asyncHandler(async (req, res) => {
  const { chatId, chatName } = req.body;

  const updatedChat = await Chat.findByIdAndUpdate(
    chatId,
    {
      chatName: chatName,
    },
    {
      new: true,
    }
  )
    .populate("users", "-password")
    .populate("groupAdmin", "-password");

  if (!updatedChat) {
    res.status(404);
    throw new Error("Chat Not Found");
  } else {
    // Invalidate chats cache for all users in the group
    const cacheKeysToDelete = updatedChat.users.map(user =>
      cache.generateKey('chats', 'user', user._id)
    );
    await cache.del(cacheKeysToDelete);

    res.json(updatedChat);
  }
});

// @desc    Remove user from Group
// @route   PUT /api/chat/groupremove
// @access  Protected
const removeFromGroup = asyncHandler(async (req, res) => {
  const { chatId, userId } = req.body;

  // check if the requester is admin

  const removed = await Chat.findByIdAndUpdate(
    chatId,
    {
      $pull: { users: userId },
    },
    {
      new: true,
    }
  )
    .populate("users", "-password")
    .populate("groupAdmin", "-password");

  if (!removed) {
    res.status(404);
    throw new Error("Chat Not Found");
  } else {
    // Invalidate chats cache for all users including removed user
    const cacheKeysToDelete = [
      ...removed.users.map(user => cache.generateKey('chats', 'user', user._id)),
      cache.generateKey('chats', 'user', userId)
    ];
    await cache.del(cacheKeysToDelete);

    res.json(removed);
  }
});

// @desc    Add user to Group / Leave
// @route   PUT /api/chat/groupadd
// @access  Protected
const addToGroup = asyncHandler(async (req, res) => {
  const { chatId, userId } = req.body;

  // check if the requester is admin

  const added = await Chat.findByIdAndUpdate(
    chatId,
    {
      $push: { users: userId },
    },
    {
      new: true,
    }
  )
    .populate("users", "-password")
    .populate("groupAdmin", "-password");

  if (!added) {
    res.status(404);
    throw new Error("Chat Not Found");
  } else {
    // Invalidate chats cache for all users in the group
    const cacheKeysToDelete = added.users.map(user =>
      cache.generateKey('chats', 'user', user._id)
    );
    await cache.del(cacheKeysToDelete);

    res.json(added);
  }
});

const fetchMessageRequests = asyncHandler(async (req, res) => {
  try {
    const requests = await Chat.find({
      users: { $elemMatch: { $eq: req.user._id } },
      status: 'pending',
      requestedBy: { $ne: req.user._id },
    }).populate({ path: "users", select: "public_user_name user_job_experience user_current_company_name avatar_config user_public_profile_pic" })
      .populate("latestMessage")
      .sort({ updatedAt: -1 });

    await User.populate(requests, {
      path: "latestMessage.sender",
      select: "public_user_name",
    });

    return res.status(200).json({ status: 'Success', result: requests });
  } catch (error) {
    return res.status(500).json({ status: 'Failed', result: [] });
  }
});

const acceptRequest = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat) return res.status(404).json({ message: 'Chat not found' });
  if (chat.requestedBy?.toString() === req.user._id.toString()) {
    return res.status(403).json({ message: 'Only the recipient can accept this request.' });
  }
  const updated = await Chat.findByIdAndUpdate(req.params.chatId, { status: 'accepted' }, { new: true })
    .populate({ path: "users", select: "public_user_name username user_job_experience user_current_company_name" })
    .populate("latestMessage");
  await cache.del(
    cache.generateKey('chats', 'user', req.user._id),
    cache.generateKey('chats', 'user', chat.requestedBy)
  );
  return res.status(200).json({ status: 'Success', result: updated });
});

const rejectRequest = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat) return res.status(404).json({ message: 'Chat not found' });
  if (chat.requestedBy?.toString() === req.user._id.toString()) {
    return res.status(403).json({ message: 'Only the recipient can reject this request.' });
  }
  const updated = await Chat.findByIdAndUpdate(req.params.chatId, { status: 'rejected' }, { new: true });
  await cache.del(
    cache.generateKey('chats', 'user', req.user._id),
    cache.generateKey('chats', 'user', chat.requestedBy)
  );
  return res.status(200).json({ status: 'Success', result: updated });
});

module.exports = {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  fetchMessageRequests,
  acceptRequest,
  rejectRequest,
};
