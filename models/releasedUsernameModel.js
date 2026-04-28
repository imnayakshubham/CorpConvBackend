const mongoose = require("mongoose");

const releasedUsernameSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  releasedAt: { type: Date, default: Date.now },
  releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  // TTL index auto-deletes document when expiresAt is reached
  expiresAt: { type: Date, required: true },
});

// TTL index  - MongoDB deletes documents automatically once expiresAt passes
releasedUsernameSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ReleasedUsername = mongoose.model("ReleasedUsername", releasedUsernameSchema);
module.exports = ReleasedUsername;
