const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    title: { type: String, required: true },
    desc: { type: String, required: true },
    classification: { type: String, default: 'Showcase' },
    audience: { type: String, default: 'Open to All' },
    techStack: { type: String, default: '' },
    projectUrl: { type: String, default: '' },
    img: { type: String, default: '' },
    author: { type: mongoose.Schema.Types.Mixed, default: 'Student' },
    rating: { type: Number, default: 0 },
    ratingsCount: { type: Number, default: 0 },
    reactions: {
        like: { type: Number, default: 0 },
        love: { type: Number, default: 0 },
        rocket: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Project', projectSchema);
