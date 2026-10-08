const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    location: { type: String, required: true },
    date: { type: Date, default: Date.now },
    visibility: { type: String, default: 'public' },
    ticketType: { type: String, default: 'free' },
    price: { type: Number, default: 0 },
    campusUsername: { type: String },
    campusPassword: { type: String },
    author: { type: String, default: 'Student' },
    attendees: [{
        ticketId: String,
        username: String,
        verified: { type: Boolean, default: false },
        registeredAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);