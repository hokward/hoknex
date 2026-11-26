const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: { type: String, default: 'System', index: true },
    recipient: { type: String, required: true, index: true },
    text: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    mediaType: { type: String, default: 'text' }, // 'text', 'audio', 'image', 'sticker'
    isRead: { type: Boolean, default: false, index: true },
    reactions: [{ user: String, emoji: String }],
    createdAt: { type: Date, default: Date.now, index: 1 }
});

// Compound index for fast DM conversation loading & unread receipt updates
messageSchema.index({ sender: 1, recipient: 1, createdAt: 1 });

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);
