const asyncHandler = require("express-async-handler");
const Message = require("../models/messageModel");
const User = require("../models/userModel");
const Chat = require("../models/chatModel");
const ConversationMembership = require("../models/conversationMembershipModel");
const ActivityEvent = require("../models/activityEventModel");
const notificationService = require("../utils/notificationService");
const { getIo } = require("../utils/socketManger");
const { sanitizeRichText } = require("../utils/sanitize");
const cache = require("../redisClient/cacheHelper");
const { fetchLinkMetadata } = require("../utils/fetchLinkMetadata");

const URL_REGEX = /https?:\/\/[^\s<>'"]+/g;

function extractUrls(text) {
  const matches = text.match(URL_REGEX) || [];
  return [...new Set(matches)].slice(0, 3);
}

const SENDER_SELECT = "public_user_name username user_bio user_job_role user_job_experience user_current_company_name user_public_location avatar_config user_public_profile_pic lastActiveAt";
// Room message sender projection — the identity seam. v1 reuses the public-persona
// fields above (never actual name/email); swap this to an alias projection later
// without touching any room read path.
const ROOM_SENDER_SELECT = SENDER_SELECT;
const MESSAGE_PAGE_SIZE = 20;

// A room's owner is stored on `groupAdmin`; extra moderators live in `moderators[]`.
function isRoomModerator(chat, userId) {
  const uid = userId.toString();
  if (chat.groupAdmin?.toString() === uid) return true;
  return (chat.moderators || []).some((m) => m.toString() === uid);
}

async function populateMessage(msg) {
  msg = await msg.populate("sender", SENDER_SELECT);
  msg = await msg.populate("chat");
  msg = await User.populate(msg, { path: "chat.users", select: SENDER_SELECT });
  if (msg.replyTo) {
    msg = await msg.populate({ path: "replyTo", select: "content sender isDeleted", populate: { path: "sender", select: "public_user_name" } });
  }
  return msg;
}

const allMessages = asyncHandler(async (req, res) => {
  try {
    const { before, limit } = req.query;
    const parsedLimit = Math.min(parseInt(limit, 10) || MESSAGE_PAGE_SIZE, 100);
    const isPaginating = !!before;
    const chatId = req.params.chatId;

    const conv = await Chat.findById(chatId).select('type');
    const isRoom = conv?.type === 'room';

    if (isRoom) {
      // Channels require active membership to read; no per-message readBy (doesn't scale).
      const mem = await ConversationMembership.findOne({ conversation: chatId, user: req.user._id, access: true });
      if (!mem || mem.status !== 'active') {
        return res.status(403).send({ status: "Failed", message: "Join this channel to view messages." });
      }
    } else {
      // DM/group: mark all unread as read (idempotent) — unchanged behavior.
      await Message.updateMany(
        { chat: chatId, readBy: { $nin: [req.user._id] } },
        { $addToSet: { readBy: req.user._id } }
      );
    }

    // `threadRoot: null` keeps thread replies out of the main list; it also matches
    // every existing message where the field is absent, so DM behavior is unchanged.
    const filter = { chat: chatId, threadRoot: null };
    if (before) {
      const cursorMsg = await Message.findById(before, 'createdAt').lean();
      if (cursorMsg) filter.createdAt = { $lt: cursorMsg.createdAt };
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(parsedLimit)
      .populate("sender", isRoom ? ROOM_SENDER_SELECT : SENDER_SELECT)
      .populate({ path: "replyTo", select: "content sender isDeleted", populate: { path: "sender", select: "public_user_name" } })
      .populate("chat");

    // Reverse to chronological order (oldest first) for display
    messages.reverse();

    const hasMore = messages.length === parsedLimit;

    // Only fetch chatData on initial load (no cursor) to avoid redundant DB work
    let chatData = null;
    if (!isPaginating) {
      if (isRoom) {
        // Bump this member's read pointer instead of per-user unread reset.
        await ConversationMembership.updateOne(
          { conversation: chatId, user: req.user._id },
          { lastReadAt: new Date() }
        );
        chatData = await Chat.findById(chatId)
          .populate("groupAdmin", ROOM_SENDER_SELECT)
          .populate("latestMessage");
        await User.populate(chatData, { path: "latestMessage.sender", select: ROOM_SENDER_SELECT });
      } else {
        chatData = await Chat.findByIdAndUpdate(
          { _id: chatId },
          { unreadMessage: [], $set: { [`unreadCounts.${req.user._id}`]: 0 } },
          { new: true }
        )
          .populate({ path: "users", select: SENDER_SELECT })
          .populate("groupAdmin")
          .populate("latestMessage");

        await User.populate(chatData, { path: "latestMessage.sender", select: SENDER_SELECT });
        await cache.del(cache.generateKey('chats', 'user', req.user._id));
      }
    }

    res.status(200).send({ status: "Success", message: "chats found for the user.", result: { messages, chatData, hasMore } });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

async function sendRoomMessage(req, res, chat, { content, replyTo, threadRoot }) {
  const chatId = chat._id.toString();

  if (chat.status === 'archived') {
    return res.status(403).json({ message: 'This channel is archived.' });
  }

  const mem = await ConversationMembership.findOne({ conversation: chat._id, user: req.user._id, access: true });
  if (!mem || mem.status !== 'active') {
    return res.status(403).json({ message: 'Join this channel to send messages.' });
  }

  let message = await Message.create({
    sender: req.user._id,
    content,
    chat: chat._id,
    replyTo: replyTo || null,
    threadRoot: threadRoot || null,
  });

  message = await message.populate('sender', ROOM_SENDER_SELECT);
  message = await message.populate('chat');
  if (message.replyTo) {
    message = await message.populate({ path: 'replyTo', select: 'content sender isDeleted', populate: { path: 'sender', select: 'public_user_name' } });
  }

  ActivityEvent.create({ userId: req.user._id, eventType: 'message_sent' }).catch(() => {});

  if (threadRoot) {
    await Message.findByIdAndUpdate(threadRoot, { $inc: { replyCount: 1 }, lastReplyAt: new Date() });
  } else {
    await Chat.findByIdAndUpdate(chat._id, { latestMessage: message._id });
  }

  const io = getIo();
  if (io) {
    if (threadRoot) {
      io.to(chatId).emit('thread_reply', { threadRoot, message });
      io.to(chatId).emit('message_thread_updated', { messageId: threadRoot });
    } else {
      io.to(chatId).emit('message recieved', message);
    }
  }

  res.json(message);

  const urls = extractUrls(content);
  if (urls.length > 0) {
    (async () => {
      try {
        const settled = await Promise.allSettled(urls.map((url) => fetchLinkMetadata(url)));
        const links = settled.filter((r) => r.status === 'fulfilled' && r.value?.url).map((r) => r.value);
        if (links.length === 0) return;
        await Message.findByIdAndUpdate(message._id, { links });
        if (io) io.to(chatId).emit('message_links_updated', { messageId: message._id, links });
      } catch (_) { /* ignore */ }
    })();
  }
}

const sendMessage = asyncHandler(async (req, res) => {
  const { chatId, replyTo, threadRoot } = req.body;
  // Messages may contain rich-text HTML from the composer — sanitize to a safe subset.
  const content = sanitizeRichText(req.body.content);
  if (!content || !chatId) {
    return res.sendStatus(400);
  }

  try {
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    if (chat.type === 'room') {
      return await sendRoomMessage(req, res, chat, { content, replyTo, threadRoot });
    }

    if (chat.status === 'rejected' && chat.requestedBy?.toString() === req.user._id.toString()) {
      return res.status(403).json({ message: 'This user has declined your message request.' });
    }

    if (chat.status === 'pending' && chat.requestedBy?.toString() !== req.user._id.toString()) {
      await Chat.findByIdAndUpdate(chatId, { status: 'accepted' });
    }

    let message = await Message.create({
      sender: req.user._id,
      content,
      chat: chatId,
      readBy: [req.user._id],
      deliveredTo: [req.user._id],
      replyTo: replyTo || null,
      threadRoot: threadRoot || null,
    });

    message = await populateMessage(message);

    ActivityEvent.create({ userId: req.user._id, eventType: 'message_sent' }).catch(() => {});

    if (threadRoot) {
      // Thread replies bump the root's counters; they don't touch the conversation's
      // latestMessage, unread counts, or notifications.
      await Message.findByIdAndUpdate(threadRoot, { $inc: { replyCount: 1 }, lastReplyAt: new Date() });
    } else {
      await Chat.findByIdAndUpdate(chatId, { latestMessage: message });
      // Clear cached chat lists for all members so latestMessage appears immediately
      const cacheKeys = chat.users.map(uid => cache.generateKey('chats', 'user', uid));
      await cache.del(...cacheKeys).catch(() => {});

      // Increment per-user unread count for everyone except the sender
      const otherMembers = chat.users.filter(id => id.toString() !== req.user._id.toString());
      const unreadIncrements = {};
      otherMembers.forEach(uid => { unreadIncrements[`unreadCounts.${uid}`] = 1; });
      if (Object.keys(unreadIncrements).length) {
        await Chat.findByIdAndUpdate(chatId, { $inc: unreadIncrements });
      }

      // Notify all other chat members
      otherMembers.forEach(receiverId => {
        notificationService.createAndEmit({
          actorId: req.user._id,
          receiverId,
          type: 'MESSAGE',
          targetId: chatId,
          targetType: 'chat',
        }).catch(() => {});
      });
    }

    res.json(message);

    // Fire-and-forget: extract URLs and fetch OG metadata without blocking the response.
    const urls = extractUrls(content);
    if (urls.length > 0) {
      (async () => {
        try {
          const settled = await Promise.allSettled(urls.map(url => fetchLinkMetadata(url)));
          const links = settled
            .filter(r => r.status === 'fulfilled' && r.value?.url)
            .map(r => r.value);
          if (links.length === 0) return;
          await Message.findByIdAndUpdate(message._id, { links });
          const io = getIo();
          if (io) {
            io.to(chatId).emit('message_links_updated', { messageId: message._id, links });
          }
        } catch (_) { /* silently ignore */ }
      })();
    }
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

const editMessage = asyncHandler(async (req, res) => {
  const content = sanitizeRichText(req.body.content);
  const message = await Message.findById(req.params.id);

  if (!message) return res.status(404).json({ message: 'Message not found' });
  if (message.sender.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Only the sender can edit this message.' });
  }
  if (message.isDeleted) return res.status(400).json({ message: 'Cannot edit a deleted message.' });

  const EDIT_WINDOW_MS = 15 * 60 * 1000;
  if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
    return res.status(400).json({ message: 'Edit window has expired (15 minutes).' });
  }

  const updated = await Message.findByIdAndUpdate(
    req.params.id,
    { content, isEdited: true, editedAt: new Date() },
    { new: true }
  ).populate("sender", SENDER_SELECT);

  const io = getIo();
  if (io) {
    io.to(message.chat.toString()).emit('message_edited', {
      messageId: updated._id,
      content: updated.content,
      editedAt: updated.editedAt,
    });
  }

  return res.json({ status: 'Success', result: updated });
});

const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) return res.status(404).json({ message: 'Message not found' });

  const isSender = message.sender.toString() === req.user._id.toString();
  if (!isSender) {
    // In a channel, the owner and moderators can also delete others' messages.
    const chat = await Chat.findById(message.chat).select('type groupAdmin moderators');
    if (!(chat?.type === 'room' && isRoomModerator(chat, req.user._id))) {
      return res.status(403).json({ message: 'Only the sender can delete this message.' });
    }
  }

  const updated = await Message.findByIdAndUpdate(
    req.params.id,
    { isDeleted: true, content: '' },
    { new: true }
  );

  const io = getIo();
  if (io) {
    io.to(message.chat.toString()).emit('message_deleted', {
      messageId: updated._id,
      chatId: message.chat.toString(),
    });
  }

  return res.json({ status: 'Success', result: updated });
});

const addReaction = asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  const message = await Message.findById(req.params.id);
  if (!message) return res.status(404).json({ message: 'Message not found' });
  if (message.isDeleted) return res.status(400).json({ message: 'Cannot react to a deleted message.' });

  const userId = req.user._id;
  const existingIdx = message.reactions.findIndex(
    r => r.emoji === emoji && r.userId.toString() === userId.toString()
  );

  if (existingIdx !== -1) {
    message.reactions.splice(existingIdx, 1);
  } else {
    message.reactions.push({ emoji, userId });
  }

  await message.save();

  const io = getIo();
  if (io) {
    io.to(message.chat.toString()).emit('message_reacted', {
      messageId: message._id,
      reactions: message.reactions,
    });
  }

  return res.json({ status: 'Success', result: message.reactions });
});

const getThreadMessages = asyncHandler(async (req, res) => {
  const root = await Message.findById(req.params.id).populate('sender', SENDER_SELECT);
  if (!root) return res.status(404).json({ status: 'Failed', message: 'Message not found' });

  const chat = await Chat.findById(root.chat).select('type users');
  if (!chat) return res.status(404).json({ status: 'Failed', message: 'Conversation not found' });

  if (chat.type === 'room') {
    const mem = await ConversationMembership.findOne({ conversation: chat._id, user: req.user._id, access: true });
    if (!mem || mem.status !== 'active') {
      return res.status(403).json({ status: 'Failed', message: 'Join this channel to view the thread.' });
    }
  } else if (!chat.users.some((u) => u.toString() === req.user._id.toString())) {
    return res.status(403).json({ status: 'Failed', message: 'Not a participant of this conversation.' });
  }

  const senderSelect = chat.type === 'room' ? ROOM_SENDER_SELECT : SENDER_SELECT;
  const replies = await Message.find({ threadRoot: root._id })
    .sort({ createdAt: 1 })
    .populate('sender', senderSelect)
    .lean();

  return res.status(200).json({ status: 'Success', result: { root: root.toObject(), replies } });
});

const markDelivered = asyncHandler(async (req, res) => {
  const { chatId } = req.body;
  const userId = req.user._id;

  await Message.updateMany(
    { chat: chatId, deliveredTo: { $nin: [userId] }, sender: { $ne: userId } },
    { $addToSet: { deliveredTo: userId } }
  );

  return res.json({ status: 'Success' });
});

const markRead = asyncHandler(async (req, res) => {
  const { chatId } = req.body;
  const userId = req.user._id;

  await Chat.findByIdAndUpdate(chatId, {
    $set: { [`unreadCounts.${userId}`]: 0 },
    unreadMessage: [],
  });

  await cache.del(cache.generateKey('chats', 'user', userId));

  return res.json({ status: 'Success' });
});

module.exports = { allMessages, sendMessage, editMessage, deleteMessage, addReaction, markDelivered, markRead, getThreadMessages };
