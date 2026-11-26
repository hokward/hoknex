const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
    emoji: { type: String, required: true },
    users: [{ type: String }]
}, { _id: false });

const threadReplySchema = new mongoose.Schema({
    senderName: { type: String, required: true },
    senderUsername: { type: String, default: '' },
    senderDp: { type: String, default: '' },
    text: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    senderName: { type: String, required: true },
    senderUsername: { type: String, default: '' },
    senderDp: { type: String, default: '' },
    activityStatus: { type: String, default: '🟢 Active' },
    text: { type: String, default: '' },
    reactions: [reactionSchema],
    threadReplies: [threadReplySchema],
    createdAt: { type: Date, default: Date.now }
});

const channelSchema = new mongoose.Schema({
    name: { type: String, required: true },
    topic: { type: String, default: 'Hoknex live channel' },
    messages: [messageSchema]
});

const roleAssignmentSchema = new mongoose.Schema({
    username: { type: String, required: true },
    role: { type: String, default: 'Member' },
    powers: [{ type: String }]
}, { _id: false });

const modApplicationSchema = new mongoose.Schema({
    username: { type: String, required: true },
    experience: { type: String, default: '' },
    whyMod: { type: String, default: '' },
    hoursPerWeek: { type: String, default: '5-10 hrs/wk' },
    status: { type: String, default: 'Pending' },
    appliedAt: { type: Date, default: Date.now }
});

const ClubSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    description: String,
    dpUrl: { type: String, default: '' },
    inviteCode: { type: String, default: '' },
    category: String,
    color: String,
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    joinRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    roles: [roleAssignmentSchema],
    modApplications: [modApplicationSchema],
    channels: [channelSchema]
}, { timestamps: true });

module.exports = mongoose.models.Club || mongoose.model('Club', ClubSchema);
