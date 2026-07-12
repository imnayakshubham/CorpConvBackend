const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Chat = require("../models/chatModel");
const Message = require("../models/messageModel");
const ConversationMembership = require("../models/conversationMembershipModel");
const User = require("../models/userModel");
const escapeRegex = require("../utils/escapeRegex");
const { getIo } = require("../utils/socketManger");
const { encryptCodes, verifyPin } = require("../utils/pinCrypto");

// Public persona fields only — a member's real name/email is never exposed in a channel.
const PUBLIC_USER_SELECT = "public_user_name username avatar_config user_public_profile_pic user_job_role user_current_company_name lastActiveAt";

// Count messages a member hasn't seen yet: newer than their read pointer and not their own.
async function unreadCountFor(conversationId, userId, lastReadAt) {
  return Message.countDocuments({
    chat: conversationId,
    threadRoot: null,
    createdAt: { $gt: lastReadAt || new Date(0) },
    sender: { $ne: userId },
  });
}

const createRoom = asyncHandler(async (req, res) => {
  const { name, description, roomType = 'public', visibility, pin_enabled, pins } = req.body;
  const owner = req.user._id;

  // Town halls always scope to the creator's active workspace.
  const isTownhall = roomType === 'workspace_townhall';
  const resolvedVisibility = isTownhall
    ? 'workspace'
    : (visibility || (roomType === 'private' ? 'logged_in' : 'public'));
  const workspace_id = resolvedVisibility === 'workspace' ? (req.activeOrganizationId || null) : null;

  if (isTownhall && !workspace_id) {
    return res.status(400).json({ status: 'Failed', message: 'Select a workspace to create a town hall.' });
  }

  const room = new Chat({
    type: 'room',
    name,
    description: description || '',
    roomType,
    visibility: resolvedVisibility,
    workspace_id,
    groupAdmin: owner,
    pin_enabled: !!pin_enabled,
    pins: pin_enabled ? encryptCodes(Array.isArray(pins) ? pins : []) : [],
  });
  await room.save();

  await ConversationMembership.create({
    conversation: room._id,
    user: owner,
    role: 'owner',
    status: 'active',
  });

  const populated = await Chat.findById(room._id).populate('groupAdmin', PUBLIC_USER_SELECT).lean();
  delete populated.pins;

  return res.status(201).json({ status: 'Success', data: populated, message: 'Channel created' });
});

const browseRooms = asyncHandler(async (req, res) => {
  const activeOrg = req.activeOrganizationId || null;

  // Only discoverable channels: public ones, plus town halls of the user's active workspace.
  // Private channels are never listed here.
  const match = { type: 'room', access: true, status: { $ne: 'archived' } };
  if (activeOrg) {
    match.$or = [
      { roomType: 'public', visibility: 'public' },
      { visibility: 'workspace', workspace_id: new mongoose.Types.ObjectId(activeOrg) },
    ];
  } else {
    match.roomType = 'public';
    match.visibility = 'public';
  }

  const rooms = await Chat.find(match)
    .select('name description slug roomType visibility pin_enabled latestMessage updatedAt')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

  return res.status(200).json({ status: 'Success', data: rooms });
});

const myConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // DMs / group chats — same shape as fetchChats, restricted to non-room conversations.
  const dms = await Chat.find({
    type: { $ne: 'room' },
    access: true,
    users: { $elemMatch: { $eq: userId } },
    $or: [
      { status: 'accepted' },
      { status: 'pending', requestedBy: userId },
      { status: 'rejected' },
      { users: { $size: 1 } },
    ],
  })
    .populate({ path: 'users', select: PUBLIC_USER_SELECT })
    .populate('groupAdmin')
    .populate('latestMessage')
    .sort({ updatedAt: -1 })
    .lean();
  await User.populate(dms, { path: 'latestMessage.sender', select: PUBLIC_USER_SELECT });

  // Channels the user actively belongs to, each with a cheap unread count.
  const memberships = await ConversationMembership.find({ user: userId, status: 'active', access: true }).lean();
  const membershipByRoom = new Map(memberships.map((m) => [m.conversation.toString(), m]));

  const rooms = await Chat.find({
    _id: { $in: memberships.map((m) => m.conversation) },
    access: true,
    status: { $ne: 'archived' },
  })
    .populate('latestMessage')
    .sort({ updatedAt: -1 })
    .lean();
  await User.populate(rooms, { path: 'latestMessage.sender', select: PUBLIC_USER_SELECT });

  const starred = new Set((req.user.starred_conversations || []).map((id) => id.toString()));

  const dmsWithStar = dms.map((dm) => ({ ...dm, isStarred: starred.has(dm._id.toString()) }));

  const roomsWithUnread = await Promise.all(rooms.map(async (room) => {
    const mem = membershipByRoom.get(room._id.toString());
    return {
      ...room,
      unreadCount: await unreadCountFor(room._id, userId, mem?.lastReadAt),
      myRole: mem?.role,
      isStarred: starred.has(room._id.toString()),
    };
  }));

  return res.status(200).json({ status: 'Success', data: { dms: dmsWithStar, rooms: roomsWithUnread } });
});

const joinRoom = asyncHandler(async (req, res) => {
  const room = await Chat.findById(req.params.id).select('+pins');
  if (!room || room.type !== 'room' || !room.access) {
    return res.status(404).json({ status: 'Failed', message: 'Channel not found' });
  }

  const existing = await ConversationMembership.findOne({ conversation: room._id, user: req.user._id });
  if (existing?.status === 'banned') {
    return res.status(403).json({ status: 'Failed', message: 'You are banned from this channel.' });
  }

  // Access ladder mirrors the poll gate: workspace scope, invite-only, then PIN.
  if (room.visibility === 'workspace') {
    const activeOrg = req.activeOrganizationId;
    if (!activeOrg || activeOrg.toString() !== room.workspace_id?.toString()) {
      return res.status(403).json({ status: 'Failed', message: 'Access restricted to workspace members' });
    }
  }
  if (room.roomType === 'private' && existing?.status !== 'invited') {
    return res.status(403).json({ status: 'Failed', message: 'This channel is invite-only.' });
  }
  if (room.pin_enabled) {
    const { pin } = req.body || {};
    if (!pin || !(await verifyPin(pin, { pins: room.pins }))) {
      return res.status(401).json({ status: 'Failed', message: 'Valid PIN required' });
    }
  }

  const membership = existing
    ? await ConversationMembership.findByIdAndUpdate(
        existing._id,
        { status: 'active', access: true },
        { new: true },
      )
    : await ConversationMembership.create({
        conversation: room._id,
        user: req.user._id,
        role: 'member',
        status: 'active',
      });

  return res.status(200).json({ status: 'Success', data: { conversationId: room._id, membership } });
});

const leaveRoom = asyncHandler(async (req, res) => {
  const room = await Chat.findById(req.params.id).select('type groupAdmin');
  if (!room || room.type !== 'room') {
    return res.status(404).json({ status: 'Failed', message: 'Channel not found' });
  }
  if (room.groupAdmin?.toString() === req.user._id.toString()) {
    return res.status(400).json({ status: 'Failed', message: 'The owner cannot leave their own channel.' });
  }

  // Leaving soft-deletes the membership; rejoining flips access back to true.
  await ConversationMembership.updateOne(
    { conversation: room._id, user: req.user._id },
    { access: false },
  );

  return res.status(200).json({ status: 'Success', message: 'Left channel' });
});

// Roster of a channel's active members (any active member may view).
const getRoomMembers = asyncHandler(async (req, res) => {
  const room = await Chat.findById(req.params.id).select('type');
  if (!room || room.type !== 'room') {
    return res.status(404).json({ status: 'Failed', message: 'Channel not found' });
  }
  const me = await ConversationMembership.findOne({ conversation: room._id, user: req.user._id, access: true, status: 'active' });
  if (!me) return res.status(403).json({ status: 'Failed', message: 'Join this channel to view members.' });

  const memberships = await ConversationMembership
    .find({ conversation: room._id, status: 'active', access: true })
    .populate('user', PUBLIC_USER_SELECT)
    .lean();

  const members = memberships
    .filter((m) => m.user)
    .map((m) => ({ ...m.user, role: m.role }));

  return res.status(200).json({ status: 'Success', data: members });
});

// Owner/moderator removes (bans) a member: they can't rejoin until re-invited.
const banMember = asyncHandler(async (req, res) => {
  const room = await Chat.findById(req.params.id).select('type groupAdmin moderators');
  if (!room || room.type !== 'room') {
    return res.status(404).json({ status: 'Failed', message: 'Channel not found' });
  }

  const uid = req.user._id.toString();
  const isOwner = room.groupAdmin?.toString() === uid;
  const isMod = isOwner || (room.moderators || []).some((m) => m.toString() === uid);
  if (!isMod) {
    return res.status(403).json({ status: 'Failed', message: 'Only the owner or moderators can remove members.' });
  }

  const { userId } = req.body;
  if (userId === room.groupAdmin?.toString()) {
    return res.status(400).json({ status: 'Failed', message: 'The channel owner cannot be removed.' });
  }
  if (userId === uid) {
    return res.status(400).json({ status: 'Failed', message: 'You cannot remove yourself. Use Leave instead.' });
  }

  await ConversationMembership.updateOne({ conversation: room._id, user: userId }, { status: 'banned' });
  await Chat.updateOne({ _id: room._id }, { $addToSet: { bannedUsers: userId } });

  try {
    const io = getIo();
    if (io) {
      io.to(userId).emit('conversation_removed', { conversationId: room._id.toString() });
      io.to(room._id.toString()).emit('member_banned', { conversationId: room._id.toString(), userId });
    }
  } catch { /* socket optional */ }

  return res.status(200).json({ status: 'Success', message: 'Member removed' });
});

// Owner/moderator edits a channel (name/description); owner may archive it.
const updateRoom = asyncHandler(async (req, res) => {
  const room = await Chat.findById(req.params.id);
  if (!room || room.type !== 'room' || !room.access) {
    return res.status(404).json({ status: 'Failed', message: 'Channel not found' });
  }

  const uid = req.user._id.toString();
  const isOwner = room.groupAdmin?.toString() === uid;
  const isMod = isOwner || (room.moderators || []).some((m) => m.toString() === uid);
  if (!isMod) {
    return res.status(403).json({ status: 'Failed', message: 'Only the owner or moderators can manage this channel.' });
  }

  const { name, description, archived } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (archived !== undefined) {
    if (!isOwner) return res.status(403).json({ status: 'Failed', message: 'Only the owner can archive this channel.' });
    updates.status = archived ? 'archived' : 'accepted';
  }

  const updated = await Chat.findByIdAndUpdate(room._id, updates, { new: true })
    .populate('groupAdmin', PUBLIC_USER_SELECT)
    .lean();
  delete updated.pins;

  return res.status(200).json({ status: 'Success', data: updated });
});

// Owner/moderator invites a user to a channel (primarily private ones): upserts an
// 'invited' membership so joinRoom will admit them.
const inviteToRoom = asyncHandler(async (req, res) => {
  const room = await Chat.findById(req.params.id).select('type groupAdmin moderators');
  if (!room || room.type !== 'room') {
    return res.status(404).json({ status: 'Failed', message: 'Channel not found' });
  }

  const uid = req.user._id.toString();
  const isMod = room.groupAdmin?.toString() === uid || (room.moderators || []).some((m) => m.toString() === uid);
  if (!isMod) {
    return res.status(403).json({ status: 'Failed', message: 'Only the owner or moderators can invite people.' });
  }

  const { userId } = req.body;
  const target = await User.exists({ _id: userId, access: true });
  if (!target) return res.status(404).json({ status: 'Failed', message: 'User not found' });

  const existing = await ConversationMembership.findOne({ conversation: room._id, user: userId });
  if (existing && existing.status === 'active' && existing.access) {
    return res.status(200).json({ status: 'Success', message: 'Already a member' });
  }

  if (existing) {
    await ConversationMembership.updateOne({ _id: existing._id }, { status: 'invited', access: true });
  } else {
    await ConversationMembership.create({ conversation: room._id, user: userId, role: 'member', status: 'invited' });
  }

  return res.status(200).json({ status: 'Success', message: 'Invitation sent' });
});

// Grouped search across the user's DMs and discoverable/joined channels. Cursor-paginated
// on `_id` (mirrors getChatUsers) by merge-sorting the two sources; the frontend groups by type.
const searchConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const activeOrg = req.activeOrganizationId || null;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const cursor = req.query.cursor?.trim();
  const q = req.query.q?.trim();

  if (!q) {
    return res.status(200).json({ status: 'Success', data: [], nextCursor: null, hasMore: false });
  }

  const re = new RegExp(escapeRegex(q), 'i');
  const cursorMatch = cursor ? { _id: { $lt: new mongoose.Types.ObjectId(cursor) } } : {};

  // Channels: discoverable (public / this workspace) or ones the user already belongs to.
  const myRoomIds = (await ConversationMembership
    .find({ user: userId, status: 'active', access: true })
    .select('conversation')
    .lean()).map((m) => m.conversation);

  const channelDocs = await Chat.find({
    ...cursorMatch,
    type: 'room',
    access: true,
    status: { $ne: 'archived' },
    name: re,
    $or: [
      { roomType: 'public', visibility: 'public' },
      ...(activeOrg ? [{ visibility: 'workspace', workspace_id: new mongoose.Types.ObjectId(activeOrg) }] : []),
      { _id: { $in: myRoomIds } },
    ],
  })
    .select('type name description slug roomType visibility pin_enabled latestMessage updatedAt')
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  // DMs/groups the user is in, matched by a counterpart's public name.
  const dmDocs = await Chat.aggregate([
    { $match: { ...cursorMatch, type: { $in: ['dm', 'group', 'self'] }, access: true, users: userId } },
    {
      $lookup: {
        from: 'users',
        localField: 'users',
        foreignField: '_id',
        as: 'usersInfo',
        pipeline: [{ $project: { public_user_name: 1, username: 1, avatar_config: 1, user_public_profile_pic: 1, lastActiveAt: 1 } }],
      },
    },
    { $match: { usersInfo: { $elemMatch: { _id: { $ne: userId }, public_user_name: re } } } },
    { $project: { type: 1, isGroupChat: 1, chatName: 1, latestMessage: 1, updatedAt: 1, users: '$usersInfo' } },
    { $sort: { _id: -1 } },
    { $limit: limit + 1 },
  ]);

  const merged = [...channelDocs, ...dmDocs]
    .sort((a, b) => String(b._id).localeCompare(String(a._id)));

  const hasMore = merged.length > limit;
  const data = hasMore ? merged.slice(0, limit) : merged;
  const nextCursor = hasMore ? data[data.length - 1]._id : null;

  return res.status(200).json({ status: 'Success', data, nextCursor, hasMore });
});

// Toggle a conversation (DM or channel) in the user's starred set.
const toggleStar = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await Chat.exists({ _id: id, access: true });
  if (!exists) return res.status(404).json({ status: 'Failed', message: 'Conversation not found' });

  const user = await User.findById(req.user._id).select('starred_conversations');
  const already = (user.starred_conversations || []).some((c) => c.toString() === id);

  await User.updateOne(
    { _id: req.user._id },
    already ? { $pull: { starred_conversations: id } } : { $addToSet: { starred_conversations: id } },
  );

  return res.status(200).json({ status: 'Success', data: { starred: !already } });
});

module.exports = { createRoom, browseRooms, myConversations, joinRoom, leaveRoom, searchConversations, toggleStar, inviteToRoom, updateRoom, getRoomMembers, banMember };
