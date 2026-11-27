const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    desc: { type: String, required: true, trim: true },
    classification: {
        type: String,
        enum: ['Showcase', 'Collaboration', 'Corporate Challenge', 'Open Source'],
        default: 'Showcase',
        index: true
    },
    stage: {
        type: String,
        enum: ['Idea / Concept', 'Prototype', 'MVP', 'Live', 'Scaling'],
        default: 'Prototype'
    },
    openRoles: { type: [String], default: [] },
    audience: { type: String, default: 'Open to All' },
    techStack: { type: String, default: '' },
    projectUrl: { type: String, default: '' },
    demoUrl: { type: String, default: '' },
    img: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    author: { type: mongoose.Schema.Types.Mixed, default: 'Student', index: true },
    boosts: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    ratingsCount: { type: Number, default: 0 },
    reactions: {
        like: { type: Number, default: 0 },
        love: { type: Number, default: 0 },
        rocket: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now, index: -1 }
});

// Sync `img` and `imageUrl`, normalize tags, and optimize Cloudinary URLs
projectSchema.pre('save', function (next) {
    let url = (this.imageUrl || this.img || '').trim();
    if (url.includes('cloudinary.com') && url.includes('/upload/') && !url.includes('q_auto')) {
        url = url.replace('/upload/', '/upload/q_auto,f_auto/');
    }
    if (url) {
        this.img = url;
        this.imageUrl = url;
    }
    next();
});

module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);
