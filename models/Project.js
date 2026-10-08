const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    title: { type: String, required: true },
    desc: { type: String, required: true },
    classification: { type: String, default: 'Showcase' },
    audience: { type: String, default: 'Open to All' },
    techStack: { type: String, default: '' },
    img: { type: String, default: '' },
    projectUrl: { type: String, default: '' },
    author: { type: String, default: 'Student' },
    verified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);