const Notification = require("../models/notificationModel");

const getNotifications = async (req, res) => {
  try {
    const receiverId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ receiverId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("actorId", "username public_user_name avatar_config user_public_profile_pic")
        .lean(),
      Notification.countDocuments({ receiverId }),
      Notification.countDocuments({ receiverId, isRead: false }),
    ]);

    return res.status(200).json({
      status: "Success",
      data: notifications,
      total,
      unreadCount,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: "Failed", message: "Failed to fetch notifications" });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      receiverId: req.user._id,
      isRead: false,
    });
    return res.status(200).json({ status: "Success", count });
  } catch (error) {
    return res.status(500).json({ status: "Failed", message: "Failed to get unread count" });
  }
};

const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, receiverId: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ status: "Failed", message: "Notification not found" });
    }

    return res.status(200).json({ status: "Success", data: notification });
  } catch (error) {
    return res.status(500).json({ status: "Failed", message: "Failed to mark as read" });
  }
};

const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { receiverId: req.user._id, isRead: false },
      { isRead: true }
    );
    return res.status(200).json({ status: "Success", message: "All notifications marked as read" });
  } catch (error) {
    return res.status(500).json({ status: "Failed", message: "Failed to mark all as read" });
  }
};

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllRead };
