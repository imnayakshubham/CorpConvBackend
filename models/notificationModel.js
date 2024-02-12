const mongoose = require("mongoose");

const notificationSchema = mongoose.Schema({
    content: { type: String, trim: true },
    isRead: { type: Boolean, default: false },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
},
    { timestamps: true }
);

const Notifications = mongoose.model("Notifications", notificationSchema);

module.exports = Notifications;