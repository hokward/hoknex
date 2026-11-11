const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 300 },
    createdAt: { type: Date, default: Date.now }
});

const reelSchema = new mongoose.Schema({
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cloudinaryPublicId: { type: String, required: true },
    hlsUrl: { type: String, required: true }, // .m3u8 stream URL from Cloudinary
    fallbackMp4Url: { type: String, required: true },
    thumbnailUrl: { type: String, required: true },
    duration: { type: Number, default: 0 },
    caption: { type: String, maxlength: 300, default: '' },
    tags: [{ type: String, index: true }],
    audioTrack: {
        name: { type: String, default: 'Original Audio' },
        artist: { type: String, default: 'Hoknex Creator' },
        externalLink: { type: String, default: '' }
    },
    views: { type: Number, default: 0 },
    likesCount: { type: Number, default: 0 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    commentsCount: { type: Number, default: 0 },
    comments: [commentSchema],
    sharesCount: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 100, index: true }
}, { timestamps: true });

// High-performance compound index for cursor-based pagination
reelSchema.index({ engagementScore: -1, _id: -1 });

const Reel = mongoose.models.Reel || mongoose.model('Reel', reelSchema);
module.exports = Reel;
