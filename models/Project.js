const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    desc: { type: String, required: true, trim: true },
    classification: { type: String, default: 'Showcase', index: true },
    audience: { type: String, default: 'Open to All' },
    techStack: { type: String, default: '' },
    projectUrl: { type: String, default: '' },
    img: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    author: { type: mongoose.Schema.Types.Mixed, default: 'Student', index: true },
    rating: { type: Number, default: 0 },
    ratingsCount: { type: Number, default: 0 },
    reactions: {
        like: { type: Number, default: 0 },
        love: { type: Number, default: 0 },
        rocket: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now, index: -1 }
});

// Keep `img` and `imageUrl` in sync and optimize Cloudinary URLs for faster loading
projectSchema.pre('save', function (next) {
    let url = (this.img || this.imageUrl || '').trim();
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
