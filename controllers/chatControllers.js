const asyncHandler = require("express-async-handler");
const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const mongoose = require('mongoose');
const cache = require("../redisClient/cacheHelper");
const TTL = require("../redisClient/cacheTTL");
const { getIo } = require("../utils/socketManger");

const accessChat = asyncHandler(async (req, res) => {
  const { userId } = req.body;

  try {
    if (!userId) {
      return res.sendStatus(400);
    }

    // Self-chat (Saved Messages / Notes to self)
    if (String(userId) === String(req.user._id)) {
      let selfChat = await Chat.findOne({
        isGroupChat: false,
        users: { $size: 1, $all: [req.user._id] },
      }).populate({ path: 'users', select: 'public_user_name username user_bio user_job_role user_job_experience user_current_company_name user_public_location avatar_config user_public_profile_pic' })
        .populate('latestMessage');

      if (!selfChat) {
        const created = await Chat.create({
          chatName: 'Saved Messages',
          isGroupChat: false,
          users: [req.user._id],
          status: 'accepted',
        });
        selfChat = await Chat.findById(created._id)
          .populate({ path: 'users', select: 'public_user_name username user_bio user_job_role user_job_experience user_current_company_name user_public_location avatar_config user_public_profile_pic' });
        await cache.del(cache.generateKey('chats', 'user', req.user._id));
      }

      return res.status(200).json(selfChat);
    }

    // Check if chat already exists
    let isChat = await Chat.find({
      isGroupChat: false,
      $and: [
        { users: { $elemMatch: { $eq: req.user._id } } },
        { users: { $elemMatch: { $eq: userId } } },
      ],
    }).populate({ path: "users", select: "public_user_name username user_bio user_job_role user_job_experience user_current_company_name user_public_location avatar_config user_public_profile_pic" })
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

    // Notify the recipient immediately so their sidebar updates without a manual refresh
    try {
      const io = getIo();
      io.to(String(userId)).emit('new_chat', { chatId: createdChat._id });
    } catch { }

    return res.status(200).json(FullChat);
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

const fetchChats = asyncHandler(async (req, res) => {
  try {
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
        { status: 'rejected' },
        { users: { $size: 1 } },  // self-chat
      ],
    })
      .populate({
        path: "users",
        select: "public_user_name username user_bio user_job_role user_job_experience user_current_company_name user_public_location avatar_config user_public_profile_pic"
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

      await cache.set(cacheKey, results, TTL.CHATS_LIST);
      return res.status(200).send({ status: "Success", message: "chats found for the user.", result: results });
    } else {
      return res.status(200).send({ status: "Success", message: "No chats found for the user.", result: results });
    }
  } catch (error) {
    console.log({ error });
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

    // Auto-accept pending requests where both users now follow each other
    if (requests.length > 0) {
      const currentUser = await User.findById(req.user._id).select('followings');
      const myFollowings = new Set((currentUser?.followings || []).map(String));

      const otherUserIds = requests.map(chat =>
        chat.users.find(u => u._id.toString() !== req.user._id.toString())?._id
      ).filter(Boolean);

      const otherUsers = await User.find({ _id: { $in: otherUserIds } }).select('followings');
      const otherFollowMap = new Map(otherUsers.map(u => [u._id.toString(), new Set((u.followings || []).map(String))]));

      const toAccept = [];
      for (const chat of requests) {
        const otherId = chat.users.find(u => u._id.toString() !== req.user._id.toString())?._id?.toString();
        if (otherId && myFollowings.has(otherId) && otherFollowMap.get(otherId)?.has(req.user._id.toString())) {
          toAccept.push(chat._id);
        }
      }

      if (toAccept.length > 0) {
        await Chat.updateMany({ _id: { $in: toAccept } }, { status: 'accepted' });
        // Invalidate cache for both sides so the accepted chats appear in fetchChats
        const requesterIds = toAccept.map(chatId =>
          requests.find(c => c._id.toString() === chatId.toString())?.requestedBy
        ).filter(Boolean);
        await Promise.all([
          cache.del(cache.generateKey('chats', 'user', req.user._id)),
          ...requesterIds.map(id => cache.del(cache.generateKey('chats', 'user', id))),
        ]);
      }

      // Return only the non-auto-accepted requests
      const acceptedIds = new Set(toAccept.map(String));
      const remaining = requests.filter(c => !acceptedIds.has(c._id.toString()));
      return res.status(200).json({ status: 'Success', result: remaining });
    }

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
    .populate({ path: "users", select: "public_user_name username user_bio user_job_role user_job_experience user_current_company_name user_public_location avatar_config user_public_profile_pic" })
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

const blockUser = asyncHandler(async (req, res) => {
  const { userId, chatId } = req.body;
  if (!userId) return res.sendStatus(400);
  if (String(userId) === String(req.user._id)) {
    return res.status(400).json({ message: 'You cannot block yourself.' });
  }

  await Promise.all([
    // User level — global block list
    User.findByIdAndUpdate(req.user._id, { $addToSet: { blockedUsers: userId } }),
    // Chat level — mark which side blocked within this chat
    chatId
      ? Chat.findByIdAndUpdate(chatId, { $addToSet: { blockedBy: req.user._id } })
      : Promise.resolve(),
  ]);

  if (chatId) {
    await cache.del(
      cache.generateKey('chats', 'user', req.user._id),
      cache.generateKey('chats', 'user', userId)
    );
  }

  return res.status(200).json({ status: 'Success', message: 'User blocked.' });
});

const unblockUser = asyncHandler(async (req, res) => {
  const { userId, chatId } = req.body;
  if (!userId) return res.sendStatus(400);

  await Promise.all([
    User.findByIdAndUpdate(req.user._id, { $pull: { blockedUsers: userId } }),
    chatId
      ? Chat.findByIdAndUpdate(chatId, { $pull: { blockedBy: req.user._id } })
      : Promise.resolve(),
  ]);

  if (chatId) {
    await cache.del(
      cache.generateKey('chats', 'user', req.user._id),
      cache.generateKey('chats', 'user', userId)
    );
  }

  return res.status(200).json({ status: 'Success', message: 'User unblocked.' });
});

const getBlockStatus = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const chat = await Chat.findById(chatId).select('blockedBy users');
  if (!chat) return res.status(404).json({ message: 'Chat not found' });

  const blockedBy = (chat.blockedBy || []).map(String);
  const currentId = String(req.user._id);
  const otherId = chat.users.map(String).find(id => id !== currentId);

  return res.status(200).json({
    iBlockedThem: blockedBy.includes(currentId),
    theyBlockedMe: otherId ? blockedBy.includes(otherId) : false,
  });
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
  blockUser,
  unblockUser,
  getBlockStatus,
};
