const mongoose = require('mongoose');
const { Schema } = mongoose;

const ItemSchema = new Schema(
    {
        title: { type: String, required: true },
        description: { type: String, default: '' },
        embedding: { type: [Number], default: [] },
        popularity_score: { type: Number, default: 0 },
        published: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Item', ItemSchema);
