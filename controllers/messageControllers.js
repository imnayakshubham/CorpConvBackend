const asyncHandler = require("express-async-handler");
const Message = require("../models/messageModel");
const User = require("../models/userModel");
const Chat = require("../models/chatModel");
const ActivityEvent = require("../models/activityEventModel");
const notificationService = require("../utils/notificationService");
const { getIo } = require("../utils/socketManger");
const cache = require("../redisClient/cacheHelper");

const SENDER_SELECT = "public_user_name username user_job_experience user_current_company_name avatar_config user_public_profile_pic";

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
    await Message.updateMany(
      { chat: req.params.chatId, readBy: { $nin: [req.user._id] } },
      { $addToSet: { readBy: req.user._id } }
    );

    const messages = await Message.find({ chat: req.params.chatId })
      .populate("sender", SENDER_SELECT)
      .populate({ path: "replyTo", select: "content sender isDeleted", populate: { path: "sender", select: "public_user_name" } })
      .populate("chat");

    const updateChatData = await Chat.findByIdAndUpdate(
      { _id: req.params.chatId },
      { unreadMessage: [] },
      { new: true }
    )
      .populate({ path: "users", select: SENDER_SELECT })
      .populate("groupAdmin")
      .populate("latestMessage");

    await User.populate(updateChatData, { path: "latestMessage.sender", select: SENDER_SELECT });

    res.status(200).send({ status: "Success", message: "chats found for the user.", result: { messages, chatData: updateChatData } });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

const sendMessage = asyncHandler(async (req, res) => {
  const { content, chatId, replyTo } = req.body;
  if (!content || !chatId) {
    return res.sendStatus(400);
  }

  try {
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

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
    });

    message = await populateMessage(message);

    ActivityEvent.create({ userId: req.user._id, eventType: 'message_sent' }).catch(() => {});
    await Chat.findByIdAndUpdate(chatId, { latestMessage: message });
    // Clear cached chat lists for all members so latestMessage appears immediately
    const cacheKeys = chat.users.map(uid => cache.generateKey('chats', 'user', uid));
    await cache.del(...cacheKeys).catch(() => {});
    await Chat.findByIdAndUpdate(
      chatId,
      { $addToSet: { unreadMessage: { messageId: message._id, readBy: [req.user._id] } } },
      { new: true }
    );

    // Notify all other chat members
    const otherMembers = chat.users.filter(id => id.toString() !== req.user._id.toString());
    otherMembers.forEach(receiverId => {
      notificationService.createAndEmit({
        actorId: req.user._id,
        receiverId,
        type: 'MESSAGE',
        targetId: chatId,
        targetType: 'chat',
      }).catch(() => {});
    });

    res.json(message);
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

const editMessage = asyncHandler(async (req, res) => {
  const { content } = req.body;
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
  if (message.sender.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Only the sender can delete this message.' });
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

const markDelivered = asyncHandler(async (req, res) => {
  const { chatId } = req.body;
  const userId = req.user._id;

  await Message.updateMany(
    { chat: chatId, deliveredTo: { $nin: [userId] }, sender: { $ne: userId } },
    { $addToSet: { deliveredTo: userId } }
  );

  return res.json({ status: 'Success' });
});

module.exports = { allMessages, sendMessage, editMessage, deleteMessage, addReaction, markDelivered };
