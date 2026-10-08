const mongoose = require('mongoose');

const SupportSchema = new mongoose.Schema({
  username: { type: String, default: 'Anonymous Student' },
  description: { type: String, required: true },
  screenshotUrl: { type: String, default: '' },
  reply: { type: String, default: '' },
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Support', SupportSchema);