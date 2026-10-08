const mongoose = require('mongoose');

const OrganizerAppSchema = new mongoose.Schema({
    username: { type: String, required: true },
    organization: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String, default: 'pending' }, // Can be 'pending', 'approved', or 'rejected'
    appliedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('OrganizerApp', OrganizerAppSchema);