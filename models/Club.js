const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
    name: { type: String, required: true },
    messages: [{
        senderName: String,
        senderUsername: String,
        text: String,
        createdAt: { type: Date, default: Date.now }
    }]
});

const ClubSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    description: String,
    category: String,
    color: String,
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    joinRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    channels: [channelSchema]
}, { timestamps: true });

module.exports = mongoose.model('Club', ClubSchema);