const mongoose = require('mongoose');

const UserEmbeddingSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    embedding: { type: [Number], required: true },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
UserEmbeddingSchema.index({ user_id: 1 });
module.exports = mongoose.model('UserEmbedding', UserEmbeddingSchema);
