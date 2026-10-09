require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const OrganizerApp = require('./models/OrganizerApp');
const User = require('./models/User');
const Post = require('./models/Post');
const Project = require('./models/Project');
const Club = require('./models/Club');
const Event = require('./models/Event');
const Support = require('./models/Support');
const Message = require('./models/Message');

const app = express();
app.use(express.static("public"));

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// 1. Secure HTTP headers safely without blocking local assets
app.use(helmet({
    contentSecurityPolicy: false, // Disables strict CSP that blocks local scripts/tools
    crossOriginResourcePolicy: false
}));

// 2. Rate Limiter to prevent spam
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Ensure large payload limit is set at the very top for base64 images and rich project data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static('public'));
// This tells Express to allow the frontend to view images inside the 'uploads' folder
app.use('/uploads', express.static('uploads'));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + safeName);
  }
});
const upload = multer({ storage: storage });

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully to Hoknex DB'))
  .catch(err => console.error('MongoDB connection error:', err));

app.post('/api/register', async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) return res.status(400).json({ error: 'Username or email already exists' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ name, username, email, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: 'User registered successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
    // 1. Log the exact data coming from the frontend (helpful for debugging)
    

    // 2. Catch EVERY possible label your frontend might be using for the first box
    const identifier = req.body.username || req.body.email || req.body.identifier || req.body.usernameOrEmail || req.body.loginId || '';
    const password = req.body.password;

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Please provide credentials' });
    }

    // 3. Clean the input (remove @ if it's a username, leave it if it's an email)
    let cleanIdentifier = identifier;
    if (!identifier.includes('.com') && !identifier.includes('.in') && !identifier.includes('.edu')) {
         cleanIdentifier = identifier.replace('@', '');
    }

    try {
        // Find the user by username or email FIRST (do not check the password yet)
        const user = await User.findOne({
            $or: [
                { username: cleanIdentifier },
                { email: identifier }
            ]
        });

        if (!user) {
            return res.status(400).json({ error: 'User not found or incorrect password' });
        }
        
        // Compare the typed password with the encrypted database password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'User not found or incorrect password' });
        }
        
        res.json({ success: true, message: 'Login successful', username: user.username });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

app.get('/api/users/:username', async (req, res) => {
  try {
    const cleanUsername = req.params.username.replace('@', '');
    const user = await User.findOne({ username: cleanUsername }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:username', upload.fields([{ name: 'dp', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), async (req, res) => {
  try {
    const tokenUsername = req.headers['x-username'];
    const targetUsername = req.params.username;
    if (!tokenUsername || tokenUsername !== targetUsername) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const { name, bio, department, skills } = req.body;
    const updateData = { name, bio, department };
    
    if (skills) {
      updateData.skills = skills.split(',').map(s => s.trim()).filter(Boolean);
    }

    if (req.files) {
      if (req.files['dp'] && req.files['dp'][0]) updateData.dpUrl = `/uploads/${req.files['dp'][0].filename}`;
      if (req.files['banner'] && req.files['banner'][0]) updateData.bannerUrl = `/uploads/${req.files['banner'][0].filename}`;
    }
    const updatedUser = await User.findOneAndUpdate({ username: targetUsername }, updateData, { new: true }).select('-password');
    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const peopleCount = await User.countDocuments();
    const postsCount = await Post.countDocuments();
    const clubsCount = await Club.countDocuments();
    res.json({ people: peopleCount || 1, posts: postsCount, clubs: clubsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const search = req.query.search || '';
    const queryFilter = search ? {
      $or: [{ name: new RegExp(search, 'i') }, { username: new RegExp(search, 'i') }, { department: new RegExp(search, 'i') }]
    } : {};
    const users = await User.find(queryFilter).select('name username department year skills dpUrl bannerUrl followers following followRequests');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/follow', async (req, res) => {
    try {
        const { currentUserId, targetUserId, note } = req.body;
        
        let requester = await User.findOne({ $or: [{ username: currentUserId }, { _id: mongoose.Types.ObjectId.isValid(currentUserId) ? currentUserId : null }] });
        let targetUser = await User.findOne({ $or: [{ username: targetUserId }, { _id: mongoose.Types.ObjectId.isValid(targetUserId) ? targetUserId : null }] });

        if (!requester || !targetUser) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Just push the requester's ID directly, and store the note in a separate message payload if needed, 
        // or update using a simple addToSet to avoid any schema validation crash.
        await User.updateOne(
            { _id: targetUser._id },
            { $addToSet: { followRequests: requester._id } }
        );

        res.status(200).json({ success: true, message: 'Request sent successfully' });
    } catch (err) {
        console.error("Follow request error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/send-request-note', async (req, res) => {
    try {
        const { senderUsername, recipientUsername, note } = req.body;
        
        let sender = await User.findOne({ username: senderUsername });
        let recipient = await User.findOne({ username: recipientUsername });

        if (!recipient) {
            return res.status(404).json({ error: 'Recipient not found.' });
        }

        // Save it directly as a Message in the inbox database
        const newMessage = new Message({
            sender: sender ? sender._id : null,
            recipient: recipient._id,
            text: `🚀 [Request Note from @${senderUsername}]: "${note}"`
        });

        await newMessage.save();
        res.status(200).json({ success: true, message: 'Note sent to inbox!' });
    } catch (err) {
        console.error("Note route error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users/accept-request', async (req, res) => {
  try {
    const { currentUserId, requesterId } = req.body;
    let currentUser = await User.findById(currentUserId);
    let requester = await User.findById(requesterId);
    await User.findByIdAndUpdate(currentUser._id, { $pull: { followRequests: requester._id },$addToSet: { followers: requester._id } });
    await User.findByIdAndUpdate(requester._id, { $addToSet: { following: currentUser._id } });
    res.json({ message: 'Follow request accepted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/requests/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).populate({ path: 'followRequests', select: 'name username dpUrl department' });
    res.json(user ? user.followRequests || [] : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/reject-request', async (req, res) => {
  try {
    const { currentUserId, requesterId } = req.body;
    await User.findByIdAndUpdate(currentUserId, { $pull: { followRequests: requesterId } });
    res.json({ message: 'Rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/unfollow', async (req, res) => {
  try {
    const { currentUserId, targetUserId } = req.body;
    await User.findByIdAndUpdate(currentUserId, { $pull: { following: targetUserId } });
    await User.findByIdAndUpdate(targetUserId, { $pull: { followers: currentUserId } });
    res.json({ message: 'Unfollowed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/cancel-request', async (req, res) => {
  try {
    const { currentUserId, targetUserId } = req.body;
    await User.findByIdAndUpdate(targetUserId, { $pull: { followRequests: currentUserId } });
    res.json({ message: 'Follow request canceled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notifications/:username', async (req, res) => {
  try {
    const username = req.params.username;
    const user = await User.findOne({ username }).populate({
      path: 'followRequests',
      select: '_id name username dpUrl department'
    });
    if (!user) return res.json([]);

    const notifications = [];

   (user.followRequests || []).forEach(reqUser => {
    notifications.push({
        id: reqUser._id,
        type: 'follow_request',
        icon: '👤',
        text: `<strong>${reqUser.name}</strong> (@${reqUser.username}) requested to follow you`,
        note: reqUser.note || '', // <-- Paste/add this line right here!
        time: 'Pending request',
        actionData: { requesterId: reqUser._id }
    });
});

    const ownedClubs = await Club.find({ owner: user._id }).populate({
      path: 'joinRequests',
      select: '_id name username',
      options: { strictPopulate: false }
    });
    ownedClubs.forEach(club => {
      (club.joinRequests || []).forEach(reqUser => {
        notifications.push({
          id: reqUser._id,
          type: 'club_request',
          icon: '🔥',
          text: `<strong>${reqUser.name}</strong> requested to join <strong>${club.name}</strong>`,
          note: reqUser.note || '',
          time: 'Club request'
        });
      });
    });

    const myPosts = await Post.find({ author: user._id }).sort({ createdAt: -1 }).limit(10);
    myPosts.forEach(post => {
      if (post.likes > 0) {
        notifications.push({
          id: post._id + '_like',
          type: 'like',
          icon: '❤️',
          text: `Your post <em>"${post.content.slice(0, 30)}..."</em> has ${post.likes} like(s)!`,
          time: 'Activity'
        });
      }
      (post.replies || []).slice(-3).forEach(reply => {
        notifications.push({
          id: reply._id || Math.random(),
          type: 'reply',
          icon: '💬',
          text: `<strong>${reply.authorName}</strong> replied: "${reply.text.slice(0, 30)}..."`,
          time: 'Reply'
        });
      });
    });

    const myTickets = await Support.find({ username }).sort({ createdAt: -1 }).limit(5);
    myTickets.forEach(ticket => {
      if (ticket.reply) {
        notifications.push({
          id: ticket._id,
          type: 'support_reply',
          icon: '🎫',
          text: `Team replied to query #${ticket._id.toString().slice(-4)}: "${ticket.reply.slice(0, 35)}..."`,
          time: ticket.status || 'Resolved'
        });
      }
    });

    res.json(notifications);
  } catch (err) {
    console.error('Notification fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { senderId, recipientId, text } = req.body;
    const newMessage = new Message({ sender: new mongoose.Types.ObjectId(senderId), recipient: new mongoose.Types.ObjectId(recipientId), text });
    await newMessage.save();
    res.status(201).json(newMessage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const u1 = new mongoose.Types.ObjectId(req.params.user1);
    const u2 = new mongoose.Types.ObjectId(req.params.user2);
    const messages = await Message.find({ $or: [{ sender: u1, recipient: u2 }, { sender: u2, recipient: u1 }] }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().populate('author', 'name username dpUrl').sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts', upload.single('image'), async (req, res) => {
  try {
    const { content, username, poll } = req.body;
    let imageUrl = req.file ? `/uploads/${req.file.filename}` : '';
    let user = username ? await User.findOne({ username: username.trim() }) : null;
    
    let parsedPoll = null;
    if (poll) {
      try {
        parsedPoll = typeof poll === 'string' ? JSON.parse(poll) : poll;
      } catch (e) {
        console.error('Error parsing poll:', e);
      }
    }

    const newPost = new Post({ 
      content: content || '', 
      imageUrl, 
      poll: parsedPoll, 
      author: user ? user._id : null 
    });

    await newPost.save();
    const populated = await Post.findById(newPost._id).populate('author', 'name username dpUrl');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Post creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/posts/:id', async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/like', async (req, res) => {
  try {
    let { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID or username required' });

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const foundUser = await User.findOne({ username: userId });
      if (foundUser) userId = foundUser._id.toString();
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (!post.likedBy) post.likedBy = [];
    const idx = post.likedBy.map(id => id.toString()).indexOf(userId.toString());
    
    if (idx > -1) {
      post.likedBy.splice(idx, 1);
    } else {
      post.likedBy.push(new mongoose.Types.ObjectId(userId));
    }
    
    post.likes = post.likedBy.length;
    await post.save();
    const updated = await Post.findById(req.params.id).populate('author', 'name username dpUrl');
    res.json(updated);
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/repost', async (req, res) => {
  try {
    let { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID or username required' });

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const foundUser = await User.findOne({ username: userId });
      if (foundUser) userId = foundUser._id.toString();
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (!post.repostedBy) post.repostedBy = [];
    const idx = post.repostedBy.map(id => id.toString()).indexOf(userId.toString());
    
    if (idx > -1) {
      post.repostedBy.splice(idx, 1);
    } else {
      post.repostedBy.push(new mongoose.Types.ObjectId(userId));
    }
    
    post.reposts = post.repostedBy.length;
    await post.save();
    const updated = await Post.findById(req.params.id).populate('author', 'name username dpUrl');
    res.json(updated);
  } catch (err) {
    console.error('Repost error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/reply', async (req, res) => {
  try {
    const { text, username } = req.body;
    const post = await Post.findById(req.params.id);
    let user = username ? await User.findOne({ username }) : null;
    if (!post.replies) post.replies = [];
    post.replies.push({ text, authorName: user ? user.name : (username || 'User') });
    await post.save();
    const updated = await Post.findById(req.params.id).populate('author', 'name username dpUrl');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user-posts/:username', async (req, res) => {
  try {
    const targetUser = await User.findOne({ username: decodeURIComponent(req.params.username) });
    const viewerUsername = req.query.viewer;
    if (!targetUser) return res.json([]);

    if (targetUser.username !== viewerUsername) {
      const viewer = await User.findOne({ username: viewerUsername });
      const isFollower = viewer && (targetUser.followers || []).map(id => id.toString()).includes(viewer._id.toString());
      if (!isFollower) {
        return res.status(403).json({ error: 'Private profile. You must follow this user to view posts.' });
      }
    }

    const posts = await Post.find({ author: targetUser._id }).populate('author', 'name username dpUrl').sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user-reposts/:username', async (req, res) => {
  try {
    const targetUser = await User.findOne({ username: decodeURIComponent(req.params.username) });
    const viewerUsername = req.query.viewer;
    if (!targetUser) return res.json([]);

    if (targetUser.username !== viewerUsername) {
      const viewer = await User.findOne({ username: viewerUsername });
      const isFollower = viewer && (targetUser.followers || []).map(id => id.toString()).includes(viewer._id.toString());
      if (!isFollower) {
        return res.status(403).json({ error: 'Private profile. You must follow this user to view reposts.' });
      }
    }

    const posts = await Post.find({ repostedBy: targetUser._id }).populate('author', 'name username dpUrl').sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- UPDATED PROJECTS ENDPOINTS & SCHEMA ---
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Added upload.single('image') to parse FormData and handle file uploads
app.post('/api/projects', upload.single('image'), async (req, res) => {
  try {
    const body = req.body || {};
    const { title, description, classification, audience, techStack, projectUrl, author } = body;

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required.' });
    }

    const newProj = new Project({
      title,
      desc: description, // Maps frontend 'description' to database 'desc'
      classification: classification || 'Showcase',
      audience: audience || 'Open to All',
      techStack: techStack || '',
      img: req.file ? `/uploads/${req.file.filename}` : '', // Saves uploaded image path
      projectUrl: projectUrl || '',
      author: author || 'Student'
    });

    await newProj.save();
    res.status(201).json(newProj);
  } catch (err) {
    console.error('Project creation error:', err);
    res.status(500).json({ error: err.message });
  }
});



app.get('/api/clubs', async (req, res) => {
  try {
    const clubs = await Club.find()
      .populate('owner', '_id name username')
      .populate('members', '_id name username dpUrl')
      .populate({
        path: 'joinRequests',
        select: '_id name username department dpUrl',
        options: { strictPopulate: false }
      });
    res.json(clubs || []);
  } catch (err) {
    console.error('Get clubs error:', err);
    res.json([]);
  }
});

app.post('/api/clubs', async (req, res) => {
  try {
    const { name, description, username } = req.body;
    let user = await User.findOne({ username });
    const newClub = new Club({ 
      name, 
      description: description || '', 
      owner: user ? user._id : null,
      members: user ? [user._id] : [],
      channels: [{ name: 'general', messages: [] }]
    });
    await newClub.save();
    res.status(201).json(newClub);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/join', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const club = await Club.findById(req.params.id);
    if (!club.members.includes(user._id)) {
      club.members.push(user._id);
      await club.save();
    }
    res.json(club);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/request-join', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    if (!club.members) club.members = [];
    if (!club.joinRequests) club.joinRequests = [];

    if (club.members.map(m => m.toString()).includes(user._id.toString())) {
      return res.status(400).json({ error: 'Already a member' });
    }
    
    const existingRequests = club.joinRequests.map(id => (id._id ? id._id.toString() : id.toString()));
    if (existingRequests.includes(user._id.toString())) {
      return res.status(400).json({ error: 'Join request already pending approval' });
    }

    club.joinRequests.push(user._id);
    await club.save();
    res.json({ message: 'Join request sent to server admin for approval!' });
  } catch (err) {
    console.error('Request join error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/handle-request', async (req, res) => {
  try {
    const { adminUsername, userId, action } = req.body;
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    club.joinRequests = club.joinRequests.filter(reqId => {
      const idStr = reqId._id ? reqId._id.toString() : reqId.toString();
      return idStr !== userId.toString();
    });

    if (action === 'accept') {
      const memberStrList = (club.members || []).map(m => m.toString());
      if (!memberStrList.includes(userId.toString())) {
        club.members.push(userId);
      }
    }

    await club.save();
    res.json({ message: `Request ${action}ed successfully`, club });
  } catch (err) {
    console.error('Handle request error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/channels', async (req, res) => {
  try {
    const { channelName } = req.body;
    const club = await Club.findById(req.params.id);
    club.channels.push({ name: channelName.toLowerCase().replace(/\s+/g, '-'), messages: [] });
    await club.save();
    res.json(club);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:clubId/channels/:channelId/messages', upload.single('media'), async (req, res) => {
  try {
    const { text, username } = req.body;
    const user = await User.findOne({ username });
    let messageText = text || '';
    if (req.file) messageText += ` [Media]: /uploads/${req.file.filename}`;
    const club = await Club.findById(req.params.clubId);
    const channel = club.channels.id(req.params.channelId);
    channel.messages.push({ senderName: user ? user.name : username || 'Member', senderUsername: user ? user.username : username || '', text: messageText, createdAt: new Date() });
    await club.save();
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/leave', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({ username });
    const club = await Club.findById(req.params.id);
    club.members = club.members.filter(m => m.toString() !== user._id.toString());
    await club.save();
    res.json({ message: 'Left server successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/request-deletion', async (req, res) => {
  try {
    const { username, reason } = req.body;
    const club = await Club.findById(req.params.id);
    const ticketDesc = `[SERVER DELETION REQUEST]: Admin @${username} requested deletion/freeze for server "${club.name}". Reason: ${reason}`;
    const newTicket = new Support({ description: ticketDesc, username, status: 'Pending' });
    await newTicket.save();
    res.json({ message: 'Server deletion request submitted to Hoknex Support Team!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/support/delete-server-by-ticket/:ticketId', async (req, res) => {
  try {
    const ticket = await Support.findById(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const desc = ticket.description;
    const match = desc.match(/for server "([^"]+)"/);
    
    if (match && match[1]) {
      const serverName = match[1];
      await Club.findOneAndDelete({ name: serverName });
    }

    await Support.findByIdAndDelete(req.params.ticketId);
    res.json({ message: 'Server and ticket deleted successfully!' });
  } catch (err) {
    console.error('Server deletion error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/support', async (req, res) => {
    const body = req.body || {};
    console.log("SUPPORT TICKET RECEIVED:", body);

    try {
        let safeUsername = 'Anonymous';
        if (body.username && typeof body.username === 'string') {
            safeUsername = body.username.replace('@', '');
        }

        const queryText = body.query || body.message || body.ticket || body.text || body.content;

        if (!queryText) {
            return res.status(400).json({ error: 'Please enter a query before submitting.' });
        }

        const newTicket = new Support({
            username: safeUsername,
            description: queryText, // <-- THIS IS THE FIX! Changed 'query' to 'description'
            status: 'Pending',
            createdAt: new Date()
        });

        await newTicket.save();
        res.json({ success: true, message: 'Ticket submitted successfully!' });
        
    } catch (error) {
        console.error("Support Ticket DB Error:", error);
        res.status(500).json({ error: 'Failed to save ticket to database.' });
    }
});

// Fetch all support tickets to display on the user and admin dashboards
app.get('/api/support', async (req, res) => {
    try {
        // Find all tickets and sort them so the newest appear at the top
        const tickets = await Support.find().sort({ createdAt: -1 });
        res.json(tickets);
    } catch (error) {
        console.error("Error fetching tickets:", error);
        res.status(500).json({ error: 'Failed to load tickets.' });
    }
});

// Get all events
app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find().sort({ date: 1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events', async (req, res) => {
    try {
        const { title, location, visibility, ticketType, price, campusUsername, campusPassword, author, date, description, image } = req.body;
        
        if (!title || !location) {
            return res.status(400).json({ error: 'Title and location are required.' });
        }

        const newEvent = new Event(req.body);
        await newEvent.save();
        res.status(201).json(newEvent);
    } catch (err) {
        console.error("Event creation error:", err);
        res.status(400).json({ error: err.message });
    }
});

// RSVP to an Event (Secure Version)
app.post('/api/events/:id/rsvp', async (req, res) => {
    try {
        const { username, campusUser, campusPass } = req.body;
        const event = await Event.findById(req.params.id);

        if (!event) return res.status(404).json({ error: 'Event not found' });

        if (event.visibility === 'internal') {
            if (event.campusUsername !== campusUser || event.campusPassword !== campusPass) {
                return res.status(401).json({ error: 'Incorrect Event Username or Password!' });
            }
        }

        // Check if user already has a ticket
        let attendee = (event.attendees || []).find(a => a.username === username);
        let ticketId;

        if (attendee) {
            ticketId = attendee.ticketId; // Reuse existing ticket if already RSVP'd
        } else {
            // Generate official server-side ticket ID
            ticketId = 'TKT-' + Math.random().toString(36).substr(2, 6).toUpperCase();
            if (!event.attendees) event.attendees = [];
            
            attendee = {
                ticketId: ticketId,
                username: username,
                verified: false,
                registeredAt: new Date()
            };
            event.attendees.push(attendee);
            await event.save();
        }

        // Send back the event along with the exact ticketId
        res.json({ event, ticketId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// RSVP to an Event (Tracks ticket sales)
app.post('/api/events/:id/rsvp', async (req, res) => {
    try {
        const { username } = req.body;
        const event = await Event.findByIdAndUpdate(
            req.params.id,
            { $addToSet: { attendees: username } }, // Adds user without duplicates
            { new: true }
        );
        res.json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete an Event
app.delete('/api/events/:id', async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.json({ message: 'Event deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit Organizer Application
app.post('/api/applications', async (req, res) => {
    try {
        const newApp = new OrganizerApp(req.body);
        await newApp.save();
        res.status(201).json({ message: 'Application submitted successfully!' });
    } catch (err) {
        console.error("Application Error:", err);
        res.status(400).json({ error: err.message });
    }
});

// Export Attendance for an Event

app.get('/api/events/:id/export-attendance', async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ error: 'Event not found' });

        // Filter only verified attendees
        const verifiedAttendees = (event.attendees || []).filter(a => a.verified);

        let csv = 'Ticket ID,Username,Check-in Time\n';
        verifiedAttendees.forEach(a => {
            csv += `${a.ticketId},@${a.username},${a.registeredAt}\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${event.title}-attendance.csv`);
        res.status(200).send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1. Get all applications for the Admin Panel
app.get('/api/applications', async (req, res) => {
    try {
        const apps = await OrganizerApp.find().sort({ appliedAt: -1 });
        res.json(apps);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Approve an application
app.put('/api/applications/:id/approve', async (req, res) => {
    try {
        const application = await OrganizerApp.findByIdAndUpdate(
            req.params.id, 
            { status: 'approved' }, 
            { new: true }
        );
        res.json(application);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Get a list of all approved usernames
app.get('/api/organizers', async (req, res) => {
    try {
        const approvedApps = await OrganizerApp.find({ status: 'approved' });
        const approvedUsernames = approvedApps.map(app => app.username.toLowerCase());
        res.json(approvedUsernames);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ensure multer is imported at the top of server.js:
// const multer = require('multer');
// const upload = multer({ dest: 'uploads/' });

app.post('/api/support', upload.single('screenshot'), async (req, res) => {
    // req.body perfectly catches the text regardless of which website form sent it
    const body = req.body || {};
    
    try {
        let safeUsername = 'Anonymous';
        if (body.username && typeof body.username === 'string') {
            safeUsername = body.username.replace('@', '');
        }

        // Catch the text whether it was labeled 'query' or 'description'
        const queryText = body.query || body.description || body.text;

        if (!queryText) {
            return res.status(400).json({ error: 'Please enter a query before submitting.' });
        }

        const newTicket = new Support({
            username: safeUsername,
            description: queryText,
            status: 'Pending',
            // If multer caught a photo, save its path. If no photo, leave it blank.
            screenshot: req.file ? `/uploads/${req.file.filename}` : '', 
            createdAt: new Date()
        });

        await newTicket.save();
        res.json({ success: true, message: 'Ticket submitted successfully!' });
        
    } catch (error) {
        console.error("Support Ticket DB Error:", error);
        res.status(500).json({ error: 'Failed to save ticket to database.' });
    }
});

// --- MONGODB PIN SCHEMA & ROUTES ---
const pinSchema = new mongoose.Schema({
    title: { type: String, required: true },
    desc: { type: String, default: 'No description provided.' },
    img: { type: String, required: true },
    author: { type: String, default: 'Student' },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
});
const Pin = mongoose.models.Pin || mongoose.model('Pin', pinSchema);

app.get('/api/pins', async (req, res) => {
    try {
        const pins = await Pin.find().sort({ createdAt: -1 });
        res.json(pins);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch pins' });
    }
});

app.post('/api/pins', async (req, res) => {
    try {
        const { title, desc, img, author } = req.body;
        if (!title || !img) return res.status(400).json({ error: 'Title and image required' });
        
        const newPin = new Pin({
            title,
            desc: desc || 'No description provided.',
            img,
            author: author || 'Student',
            likes: 0
        });
        await newPin.save();
        res.status(201).json(newPin);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create pin' });
    }
});

app.post('/api/pins/:id/like', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username required' });

        let query = mongoose.Types.ObjectId.isValid(req.params.id) ? { _id: req.params.id } : { id: req.params.id };
        const pin = await Pin.findOne(query);
        if (!pin) return res.status(404).json({ error: 'Pin not found' });

        if (!pin.likedBy) pin.likedBy = [];

        const userIndex = pin.likedBy.indexOf(username);
        if (userIndex > -1) {
            pin.likedBy.splice(userIndex, 1);
            pin.likes = Math.max(0, pin.likes - 1);
        } else {
            pin.likedBy.push(username);
            pin.likes = (pin.likes || 0) + 1;
        }

        await pin.save();
        res.json(pin);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update like status' });
    }
});

app.delete('/api/pins/:id', async (req, res) => {
    try {
        let query = mongoose.Types.ObjectId.isValid(req.params.id) ? { _id: req.params.id } : { id: req.params.id };
        await Pin.deleteOne(query);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete pin' });
    }
});
app.post('/api/events/verify-ticket', async (req, res) => {
    try {
        const { ticketId, organizerUsername } = req.body;
        console.log("🔍 Looking for Ticket ID:", ticketId, "Organizer:", organizerUsername);

        // Find event containing this ticket ID in the attendees array
        const event = await Event.findOne({ 'attendees.ticketId': ticketId });
        if (!event) {
            console.log("❌ No matching event found for ticket:", ticketId);
            return res.status(404).json({ error: 'Invalid Ticket! No matching reservation found.' });
        }

        console.log("✅ Found event:", event.title);

        const attendee = event.attendees.find(a => a.ticketId === ticketId);
        if (attendee.verified) {
            return res.status(400).json({ error: '⚠️ Ticket ALREADY USED!' });
        }

        attendee.verified = true;
        await event.save();

        res.json({
            success: true,
            message: 'Entry Approved! Valid ticket.',
            attendee,
            eventTitle: event.title
        });
    } catch (err) {
        console.error("Server error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- LOST & FOUND BACKEND ROUTES ---

// 1. Define the Database Schema for Lost & Found
const lostFoundSchema = new mongoose.Schema({
    id: String,
    title: String,
    desc: String,
    type: String, // 'Lost' or 'Found'
    dropBox: String,
    author: String,
    createdAt: { type: Date, default: Date.now }
});

// Create the MongoDB Model
const LostFound = mongoose.models.LostFound || mongoose.model('LostFound', lostFoundSchema);

// 2. GET Route: Fetch all items for everyone's feed
app.get('/api/lostfound', async (req, res) => {
    try {
        // Fetch all items from the database, newest first
        const items = await LostFound.find().sort({ createdAt: -1 });
        res.json(items);
    } catch (err) {
        console.error("Error fetching Lost & Found items:", err);
        res.status(500).json({ error: 'Failed to load items' });
    }
});

// 3. POST Route: Save a new report to the database globally
app.post('/api/lostfound', async (req, res) => {
    try {
        const newItem = new LostFound(req.body);
        await newItem.save();
        res.status(201).json(newItem);
    } catch (err) {
        console.error("Error saving Lost & Found item:", err);
        res.status(500).json({ error: 'Failed to publish report' });
    }
});

// --- LOST & FOUND CHAT BACKEND ---

const lnfChatSchema = new mongoose.Schema({
    itemId: String,
    sender: String,
    text: String,
    imageUrl: String,
    time: String
});
const LnfChat = mongoose.models.LnfChat || mongoose.model('LnfChat', lnfChatSchema);

// GET: Fetch all messages for a specific item's chat room
app.get('/api/lnf-chat/:itemId', async (req, res) => {
    try {
        const messages = await LnfChat.find({ itemId: req.params.itemId });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load chat' });
    }
});

// POST: Save a new message to the room
app.post('/api/lnf-chat', async (req, res) => {
    try {
        const newMsg = new LnfChat(req.body);
        await newMsg.save();
        res.status(201).json(newMsg);
    } catch (err) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// DELETE Route: Remove an item from the global database
app.delete('/api/lostfound/:id', async (req, res) => {
    try {
        await LostFound.findOneAndDelete({ id: req.params.id });
        res.status(200).json({ message: 'Item deleted successfully' });
    } catch (err) {
        console.error("Error deleting item:", err);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

// --- CAMPUS HUB MONGODB SCHEMAS & ROUTES ---


const whisperSchema = new mongoose.Schema({
    id: String,
    content: String,
    time: String,
    createdAt: { type: Date, default: Date.now }
});
const Whisper = mongoose.model('Whisper', whisperSchema);

const marketSchema = new mongoose.Schema({
    id: String,
    title: String,
    price: String,
    contact: String,
    author: String,
    createdAt: String
});
const MarketItem = mongoose.model('MarketItem', marketSchema);

const studySchema = new mongoose.Schema({
    username: { type: String, unique: true },
    hours: Number
});
const StudyUser = mongoose.model('StudyUser', studySchema);

// 1. Whispers Routes
app.get('/api/whispers', async (req, res) => {
    try {
        const whispers = await Whisper.find().sort({ createdAt: -1 });
        res.json(whispers);
    } catch(e) { res.status(500).json({ error: 'Failed to fetch whispers' }); }
});

app.post('/api/whispers', async (req, res) => {
    try {
        const newW = new Whisper({ id: Date.now().toString(), content: req.body.content, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        await newW.save();
        res.json(newW);
    } catch(e) { res.status(500).json({ error: 'Failed to post whisper' }); }
});

// 2. Marketplace Routes
app.get('/api/market', async (req, res) => {
    try {
        const items = await MarketItem.find().sort({ _id: -1 });
        res.json(items);
    } catch(e) { res.status(500).json({ error: 'Failed to fetch market items' }); }
});

app.post('/api/market', async (req, res) => {
    try {
        const newItem = new MarketItem({ id: Date.now().toString(), ...req.body, createdAt: new Date().toLocaleDateString() });
        await newItem.save();
        res.json(newItem);
    } catch(e) { res.status(500).json({ error: 'Failed to post item' }); }
});

// 3. Study Leaderboard Routes
app.get('/api/study', async (req, res) => {
    try {
        const board = await StudyUser.find().sort({ hours: -1 });
        res.json(board);
    } catch(e) { res.status(500).json({ error: 'Failed to fetch leaderboard' }); }
});

app.post('/api/study', async (req, res) => {
    try {
        const { username, hours } = req.body;
        let user = await StudyUser.findOne({ username });
        if (user) {
            user.hours += Number(hours);
            await user.save();
        } else {
            user = new StudyUser({ username, hours: Number(hours) });
            await user.save();
        }
        res.json(user);
    } catch(e) { res.status(500).json({ error: 'Failed to log hours' }); }
});


const nodemailer = require('nodemailer');

// Temporary storage for OTPs (expires after a few minutes)
const otpStore = {}; 

// Setup the email sender
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER, // This reads line 5 from your .env
        pass: process.env.EMAIL_PASS  // This reads line 6 from your .env
    },
    tls: {
        rejectUnauthorized: false
    }
});

// 2. The Email Sending Route
app.post('/api/send-otp', async (req, res) => {
    const name = req.body.name || req.body.fullName || req.body.fullname || 'Hoknex User';
    const username = req.body.username;
    const email = req.body.email || req.body.campusEmail;
    const password = req.body.password;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[email] = { otp, name, username, password };

    // The restored email sending code
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Hoknex Account Verification',
        text: `Your verification code is: ${otp}. It will expire soon.`
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'OTP sent to email!' });
    } catch (error) {
        console.error("Email Error:", error);
        res.status(500).json({ error: 'Failed to send email.' });
    }
});
// 2. Route to Verify OTP and Create Account
// Ensure you have your User model defined at the top of server.js, for example:
// const User = mongoose.model('User', new mongoose.Schema({ name: String, username: String, email: String, password: String }));

app.post('/api/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    const record = otpStore[email];

    if (!record) return res.status(400).json({ error: 'OTP expired or email not found.' });
    if (record.otp !== otp) return res.status(400).json({ error: 'Incorrect verification code.' });

    try {
        const cleanUsername = String(record.username).replace('@', '');

        // Scramble (hash) the password before saving it
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(record.password, salt);

        // Save to MongoDB with the encrypted password
        const newUser = new User({
            name: record.name,
            username: cleanUsername, 
            email: email, 
            password: hashedPassword // Secure!
        });
        await newUser.save();
        
        delete otpStore[email]; 
        res.json({ success: true, message: 'Account saved!', username: cleanUsername });
    } catch (error) {
        // ... (Keep your existing error handling here) ...
        if (error.code === 11000) {
            return res.status(400).json({ error: 'This email or username is already registered.' });
        }
        console.error("DB Save Error:", error);
        res.status(500).json({ error: 'Error saving account to database.' });
    }
});

app.get('/api/users/:username', async (req, res) => {
    try {
        // Remove the @ symbol (the %40) so it matches the database
        const cleanUsername = req.params.username.replace('@', '');
        
        const user = await User.findOne({ username: cleanUsername });
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        // Send back user data (excluding password for security)
        res.json({ name: user.name, username: user.username, email: user.email });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

app.post('/api/support/:id/reply', async (req, res) => {
    try {
        const { reply } = req.body; // Grab the text the admin typed
        
        // Find the ticket by its ID, save the reply, and change status to 'Resolved'
        const ticket = await Support.findByIdAndUpdate(
            req.params.id, 
            { reply: reply, status: 'Resolved' }, 
            { new: true }
        );
        
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
        
        res.json({ success: true, message: 'Reply sent successfully', ticket });
    } catch (err) {
        console.error('Support reply error:', err);
        res.status(500).json({ error: 'Failed to send reply' });
    }
});

const path = require("path");

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Remove or wrap your app.listen like this:
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT} 🚀`);
    });
}

// Crucial for Vercel Serverless Deployment
module.exports = app;