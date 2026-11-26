const mongoose = require('mongoose');

const attendeeSchema = new mongoose.Schema({
    ticketId: { type: String, required: true },
    username: { type: String, required: true },
    verified: { type: Boolean, default: false },
    registeredAt: { type: Date, default: Date.now }
}, { _id: false });

const eventSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    image: { type: String, default: '' },
    date: { type: Date, default: Date.now, index: 1 },
    visibility: { type: String, default: 'public' },
    ticketType: { type: String, default: 'free' },
    price: { type: Number, default: 0 },
    campusUsername: { type: String, default: '' },
    campusPassword: { type: String, default: '' },
    author: { type: String, default: 'Student' },
    attendees: [attendeeSchema]
}, { timestamps: true });

module.exports = mongoose.models.Event || mongoose.model('Event', eventSchema);
