const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
  content: { type: String, required: true },
  imageUrl: { type: String, default: '' },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  likes: { type: Number, default: 0 },
  likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reposts: { type: Number, default: 0 },
  repostedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  replies: [{
    text: String,
    authorName: String,
    createdAt: { type: Date, default: Date.now }
  }],
  // ADD THIS POLL SCHEMA FIELD:
  poll: {
    question: String,
    options: [{
      text: String,
      votes: { type: Number, default: 0 }
    }]
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', PostSchema);
