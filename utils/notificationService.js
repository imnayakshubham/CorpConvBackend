const Notification = require("../models/notificationModel");
const User = require("../models/userModel");
const { getIo } = require("./socketManger");

const TYPE_PRIORITY = {
  FOLLOW_REQUEST: "high",
  FOLLOW_ACCEPT: "high",
  MESSAGE: "high",
  REPLY: "medium",
  COMMENT: "medium",
  REACTION: "low",
};

const CONTENT_TEMPLATES = {
  REPLY_answer: (name) => `${name} replied to your question`,
  REPLY_comment: (name) => `${name} replied to your comment`,
  COMMENT_post: (name) => `${name} commented on your post`,
  FOLLOW_REQUEST_user: (name) => `${name} sent you a follow request`,
  FOLLOW_ACCEPT_user: (name) => `${name} accepted your follow request`,
  REACTION_post: (name) => `${name} upvoted your post`,
  REACTION_question: (name) => `${name} liked your question`,
  MESSAGE_chat: (name) => `${name} sent you a message`,
};

function buildContent(type, targetType, displayName) {
  const key = `${type}_${targetType}`;
  const template = CONTENT_TEMPLATES[key];
  return template ? template(displayName) : `${displayName} interacted with your content`;
}

function getActorDisplayName(actor) {
  if (actor.username) return `@${actor.username}`;
  if (actor.public_user_name && actor.public_user_name !== "Someone") {
    return actor.public_user_name;
  }
  return "Someone";
}

/**
 * Creates a notification in the DB and emits it via Socket.io to the receiver.
 * Silently skips self-notifications and swallows errors to avoid interrupting
 * the main request flow.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.actorId    - User who triggered the action
 * @param {string|ObjectId} params.receiverId - User who receives the notification
 * @param {string}          params.type       - REPLY | COMMENT | FOLLOW_REQUEST | FOLLOW_ACCEPT | REACTION
 * @param {string|ObjectId} params.targetId   - ID of the relevant content/user
 * @param {string}          params.targetType - question | answer | post | comment | user
 */
async function createAndEmit({ actorId, receiverId, type, targetId, targetType }) {
  try {
    if (!actorId || !receiverId) return;
    if (actorId.toString() === receiverId.toString()) return;

    const actor = await User.findById(actorId).select("username public_user_name").lean();
    if (!actor) return;

    const displayName = getActorDisplayName(actor);
    const content = buildContent(type, targetType, displayName);
    const priority = TYPE_PRIORITY[type] || "medium";

    const notification = await Notification.create({
      type,
      actorId,
      receiverId,
      targetId,
      targetType,
      content,
      priority,
    });

    const populated = await Notification.findById(notification._id).populate(
      "actorId",
      "username public_user_name avatar_config user_public_profile_pic"
    );

    const io = getIo();
    if (io) {
      io.to(receiverId.toString()).emit("new_notification", populated);
    }
  } catch (err) {
    console.error("[notificationService] Failed to create/emit notification:", err.message);
  }
}

module.exports = { createAndEmit };
