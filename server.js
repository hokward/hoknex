require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OrganizerApp = require('./models/OrganizerApp');
const User = require('./models/User');
const Post = require('./models/Post');
const Project = require('./models/Project');
const Club = require('./models/Club');
const Event = require('./models/Event');
const Support = require('./models/Support');
const Message = require('./models/Message');
const Reel = require('./models/Reel');

const app = express();
app.set('trust proxy', 1);

// ✅ Explicit Global CORS configuration to fix connection & blocks
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-username', 'x-user-id']
}));

app.use(express.static(__dirname + '/public'));

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// 1. Secure HTTP headers safely without blocking local assets
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false
}));

// 2. Rate Limiter to prevent spam
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Ensure large payload limit is set at the very top for base64 images and rich data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// 1. Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'wnnotcmw',
    api_key: process.env.CLOUDINARY_API_KEY || '316289158118826',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'l9kGKimUME38BQhYcCC6NMm5LhY'
});

// 2. Set up the Cloudinary Storage Engine
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'hoknex_uploads',
        resource_type: 'auto',
        allowedFormats: ['jpeg', 'png', 'jpg', 'webp', 'webm', 'mp3', 'wav', 'mov', 'mp4', 'pdf']
    }
});

// 3. Initialize Multer
const upload = multer({ storage: storage });

let isConnected = false;

const connectDB = async () => {
    if (isConnected) return;
    try {
        let uri = process.env.MONGO_URI || '';

        if (!uri) {
            uri = 'mongodb+srv://hoknexadmin:hoknexadmin@cluster0.qzerkk4.mongodb.net/test?retryWrites=true&w=majority';
        } else if (uri.includes('.net/')) {
            uri = uri.replace(/\.net\/[^?]*(\?|$)/, '.net/test$1');
        } else if (!uri.includes('.net/')) {
            uri = uri.replace(/\/?(\?|$)/, '/test$1');
        }

        const db = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000
        });
        isConnected = db.connections[0].readyState === 1;
        console.log('MongoDB Connected Successfully to test DB:', mongoose.connection.name);
    } catch (err) {
        console.error('MongoDB connection error:', err);
    }
};

// Force database connection before running any routes
app.use(async (req, res, next) => {
    await connectDB();
    next();
});

// Lightweight keep-alive ping route
app.get('/ping', (req, res) => {
    res.status(200).send('OK');
});

// Helper to send store emails via Brevo HTTP API with safe fallback
async function sendStoreEmailViaBrevo({ toEmails, subject, htmlContent, textContent }) {
    const cleanRecipients = Array.from(new Set((toEmails || []).map(e => String(e || '').trim()).filter(Boolean)));
    if (cleanRecipients.length === 0) {
        return { sent: false, reason: 'No recipient emails provided' };
    }

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        console.log(`📧 [DEV FALLBACK] BREVO_API_KEY missing. Subject: "${subject}" -> To: ${cleanRecipients.join(', ')}`);
        return { sent: true, fallback: true };
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': apiKey,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sender: { name: 'Hoknex Official Store', email: 'hoknex.in@gmail.com' },
            to: cleanRecipients.map(email => ({ email })),
            subject,
            htmlContent,
            textContent
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error('Brevo Store Email Error:', data);
        return { sent: false, error: data };
    }
    return { sent: true, data };
}

// ==========================================
// --- DIAGNOSTIC DEBUG ROUTE ---
// ==========================================
app.get('/api/debug-db', async (req, res) => {
    try {
        await connectDB();
        const userCount = await User.countDocuments();
        const postCount = await Post.countDocuments();
        res.json({
            status: 'Connected',
            databaseName: mongoose.connection.name,
            usersInDb: userCount,
            postsInDb: postCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// --- REELS SCHEMA & API ROUTER INTEGRATION ---
// ==========================================

const reelsRouter = express.Router();

// 1. Generate Direct-to-Cloudinary Upload Signature
reelsRouter.get('/upload-signature', async (req, res) => {
    try {
        const timestamp = Math.round(new Date().getTime() / 1000);
        const folder = 'hoknex_reels';

        const paramsToSign = {
            folder: folder,
            timestamp: timestamp
        };

        const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

        res.status(200).json({
            signature,
            timestamp,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'wnnotcmw',
            apiKey: process.env.CLOUDINARY_API_KEY || '316289158118826',
            folder
        });
    } catch (error) {
        console.error('Error generating signature:', error);
        res.status(500).json({ error: 'Failed to generate upload signature' });
    }
});

// 2. Cloudinary Eager Webhook
reelsRouter.post('/cloudinary-webhook', async (req, res) => {
    try {
        const event = req.body;
        if (event.notification_type === 'eager' && event.success) {
            const publicId = event.public_id;
            const eagerResults = event.eager || [];

            let hlsUrl = '';
            let thumbnailUrl = '';
            let fallbackMp4Url = event.secure_url || '';

            eagerResults.forEach(item => {
                if (item.format === 'm3u8' || item.url.includes('.m3u8')) {
                    hlsUrl = item.secure_url;
                }
                if (item.format === 'jpg' || item.format === 'jpeg' || item.url.includes('.jpg')) {
                    thumbnailUrl = item.secure_url;
                }
            });

            if (!thumbnailUrl && event.secure_url) {
                thumbnailUrl = event.secure_url.replace(/\.[^/.]+$/, '.jpg');
            }

            let reel = await Reel.findOne({ cloudinaryPublicId: publicId });
            if (reel) {
                if (hlsUrl) reel.hlsUrl = hlsUrl;
                if (thumbnailUrl) reel.thumbnailUrl = thumbnailUrl;
                if (fallbackMp4Url) reel.fallbackMp4Url = fallbackMp4Url;
                await reel.save();
            }
        }
        res.status(200).send('Webhook received successfully');
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// 3. Create Reel Meta Record (With Title, Custom Thumbnail & Tags Support)
reelsRouter.post('/create', async (req, res) => {
    try {
        const { creatorId, publicId, secureUrl, thumbnailOverride, duration, title, caption, taggedPeople, tags, audioTrack } = req.body;

        const hlsUrl = secureUrl.replace(/\.[^/.]+$/, '.m3u8');
        const thumbnailUrl = thumbnailOverride || secureUrl.replace(/\.[^/.]+$/, '.jpg');

        const newReel = new Reel({
            creatorId,
            cloudinaryPublicId: publicId,
            hlsUrl,
            fallbackMp4Url: secureUrl,
            thumbnailUrl,
            duration: duration || 0,
            title: title || 'Untitled Reel',
            caption: caption || '',
            taggedPeople: taggedPeople || [],
            tags: tags || [],
            audioTrack: audioTrack || {}
        });

        await newReel.save();
        res.status(201).json({ success: true, reel: newReel });
    } catch (error) {
        console.error('Create reel error:', error);
        res.status(500).json({ error: 'Failed to create reel record' });
    }
});

// 3.1. Fetch Reels Created by a Specific User (For Creator Insights Dashboard)
reelsRouter.get('/my-reels/:userId', async (req, res) => {
    try {
        const reels = await Reel.find({ creatorId: req.params.userId }).sort({ createdAt: -1 });
        res.status(200).json(reels);
    } catch (error) {
        console.error('Fetch my-reels error:', error);
        res.status(500).json({ error: 'Failed to fetch user reels' });
    }
});

// 3.2. Delete Reel Endpoint
reelsRouter.delete('/:id', async (req, res) => {
    try {
        await Reel.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Reel deleted successfully' });
    } catch (error) {
        console.error('Delete reel error:', error);
        res.status(500).json({ error: 'Failed to delete reel' });
    }
});

// 3.3. Update Reel Settings (Allow Comments / Hide Likes)
reelsRouter.put('/:id/settings', async (req, res) => {
    try {
        const { field, value } = req.body;
        const update = {};
        update[field] = value;
        const reel = await Reel.findByIdAndUpdate(req.params.id, update, { new: true });
        res.json({ success: true, reel });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// 4. Cursor-Based Feed API
reelsRouter.get('/feed', async (req, res) => {
    try {
        const { filter = 'trending', cursor, limit = 5 } = req.query;
        let query = {};
        let sort = { engagementScore: -1, _id: -1 };

        if (filter === 'fresh') {
            sort = { createdAt: -1, _id: -1 };
        }

        if (cursor) {
            const [scoreOrDate, lastId] = cursor.split('_');
            if (filter === 'fresh') {
                query = {
                    $or: [
                        { createdAt: { $lt: new Date(scoreOrDate) } },
                        { createdAt: new Date(scoreOrDate), _id: { $lt: lastId } }
                    ]
                };
            } else {
                query = {
                    $or: [
                        { engagementScore: { $lt: Number(scoreOrDate) } },
                        { engagementScore: Number(scoreOrDate), _id: { $lt: lastId } }
                    ]
                };
            }
        }

        const reels = await Reel.find(query)
            .sort(sort)
            .limit(Number(limit) + 1)
            .populate('creatorId', 'name username dpUrl isVip');

        let nextCursor = null;
        if (reels.length > limit) {
            const nextItem = reels.pop();
            const paginationKey = filter === 'fresh' ? nextItem.createdAt.toISOString() : nextItem.engagementScore;
            nextCursor = `${paginationKey}_${nextItem._id}`;
        }

        res.status(200).json({ reels, nextCursor });
    } catch (error) {
        console.error('Feed fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch reels feed' });
    }
});

// 5. Engagement APIs (Like, Unlike, Comments, Metrics)
reelsRouter.post('/:id/like', async (req, res) => {
    try {
        const { userId } = req.body;
        const reel = await Reel.findById(req.params.id);
        if (!reel) return res.status(404).json({ error: 'Reel not found' });

        const likedIndex = reel.likes.indexOf(userId);
        if (likedIndex > -1) {
            reel.likes.splice(likedIndex, 1);
            reel.likesCount = Math.max(0, reel.likesCount - 1);
            reel.engagementScore -= 5;
        } else {
            reel.likes.push(userId);
            reel.likesCount += 1;
            reel.engagementScore += 10;
        }
        await reel.save();
        res.status(200).json({ success: true, likesCount: reel.likesCount, liked: likedIndex === -1 });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update like' });
    }
});

reelsRouter.get('/:id/comments', async (req, res) => {
    try {
        const reel = await Reel.findById(req.params.id).populate('comments.userId', 'name username dpUrl');
        if (!reel) return res.status(404).json({ error: 'Reel not found' });
        res.json({ comments: reel.comments, reelOwnerId: reel.creatorId.toString() });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

reelsRouter.post('/:id/comment', async (req, res) => {
    try {
        const { userId, text, stickerUrl } = req.body;
        const reel = await Reel.findById(req.params.id);
        if (!reel) return res.status(404).json({ error: 'Reel not found' });

        reel.comments.push({ userId, text, stickerUrl: stickerUrl || '' });
        reel.commentsCount += 1;
        reel.engagementScore += 15;
        await reel.save();

        const populatedReel = await Reel.findById(req.params.id).populate('comments.userId', 'name username dpUrl');
        const newComment = populatedReel.comments[populatedReel.comments.length - 1];

        res.status(201).json({ success: true, comment: newComment, commentsCount: reel.commentsCount });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

reelsRouter.put('/:id/comment/:commentId/pin', async (req, res) => {
    try {
        const reel = await Reel.findById(req.params.id);
        if (!reel) return res.status(404).json({ error: 'Reel not found' });
        reel.comments.forEach(c => { c.isPinned = c._id.toString() === req.params.commentId; });
        await reel.save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to pin comment' });
    }
});

reelsRouter.delete('/:id/comment/:commentId', async (req, res) => {
    try {
        const reel = await Reel.findById(req.params.id);
        if (!reel) return res.status(404).json({ error: 'Reel not found' });
        reel.comments = reel.comments.filter(c => c._id.toString() !== req.params.commentId);
        reel.commentsCount = Math.max(0, reel.commentsCount - 1);
        await reel.save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

reelsRouter.post('/:id/metric', async (req, res) => {
    try {
        const { type } = req.body;
        const reel = await Reel.findById(req.params.id);
        if (!reel) return res.status(404).json({ error: 'Reel not found' });

        if (type === 'view') {
            reel.views += 1;
            reel.engagementScore += 1;
        } else if (type === 'share') {
            reel.sharesCount += 1;
            reel.engagementScore += 20;
        }
        await reel.save();
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update metric' });
    }
});

app.use('/api/reels', reelsRouter);

// DM Message Send Route for Sharing Reels
app.post('/api/messages/send', async (req, res) => {
    try {
        const { senderId, receiverId, text } = req.body;
        if (!senderId || !receiverId) return res.status(400).json({ error: 'Sender and receiver required' });
        const newMsg = new Message({
            sender: senderId,
            recipient: receiverId,
            text: text || ''
        });
        await newMsg.save();
        res.status(201).json({ success: true, message: 'Sent successfully' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ==========================================
// --- STORE, ADMIN & CAMPAIGNS SCHEMAS & API ROUTES ---
// ==========================================

const StoreHeroBannerSchema = new mongoose.Schema({
    imageUrl: { type: String, required: true },
    mediaType: { type: String, default: 'image' },
    updatedAt: { type: Date, default: Date.now }
});
const StoreHeroBanner = mongoose.models.StoreHeroBanner || mongoose.model('StoreHeroBanner', StoreHeroBannerSchema);

app.get('/api/store/hero-banner', async (req, res) => {
    try {
        const banner = await StoreHeroBanner.findOne().sort({ updatedAt: -1 });
        if (!banner) return res.json({});
        const detectedType = banner.mediaType || (/\.(mp4|webm|mov)(\?|$)/i.test(banner.imageUrl || '') ? 'video' : 'image');
        res.json({ ...banner.toObject(), mediaType: detectedType });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/store/hero-banner', async (req, res) => {
    try {
        const { imageUrl, mediaType } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'Banner imageUrl is required.' });
        const resolvedType = mediaType || (/\.(mp4|webm|mov)(\?|$)/i.test(imageUrl) ? 'video' : 'image');
        await StoreHeroBanner.deleteMany({});
        const banner = new StoreHeroBanner({
            imageUrl,
            mediaType: resolvedType,
            updatedAt: new Date()
        });
        await banner.save();
        res.json({ success: true, banner });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const StoreDropCountdownSchema = new mongoose.Schema({
    targetDate: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
});
const StoreDropCountdown = mongoose.models.StoreDropCountdown || mongoose.model('StoreDropCountdown', StoreDropCountdownSchema);

app.get('/api/store/drop-countdown', async (req, res) => {
    try {
        const cfg = await StoreDropCountdown.findOne().sort({ updatedAt: -1 });
        res.json(cfg || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/store/drop-countdown', async (req, res) => {
    try {
        const { targetDate } = req.body;
        if (!targetDate) return res.status(400).json({ error: 'targetDate is required.' });
        await StoreDropCountdown.deleteMany({});
        const cfg = new StoreDropCountdown({ targetDate, updatedAt: new Date() });
        await cfg.save();
        res.json({ success: true, targetDate: cfg.targetDate });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const StoreDropAlertSchema = new mongoose.Schema({
    email: { type: String, required: true },
    productId: String,
    productTitle: String,
    productImage: String,
    date: { type: String, default: () => new Date().toLocaleString() },
    createdAt: { type: Date, default: Date.now }
});
const StoreDropAlert = mongoose.models.StoreDropAlert || mongoose.model('StoreDropAlert', StoreDropAlertSchema);

app.get('/api/store/drop-alerts', async (req, res) => {
    try {
        const alerts = await StoreDropAlert.find().sort({ createdAt: -1 });
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/store/drop-alerts', async (req, res) => {
    try {
        const { email, productId, productTitle, productImage, date } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required.' });
        const alert = new StoreDropAlert({
            email,
            productId: productId || '',
            productTitle: productTitle || 'Upcoming Release',
            productImage: productImage || '',
            date: date || new Date().toLocaleString()
        });
        await alert.save();
        res.status(201).json({ success: true, alert });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    deliveryFee: { type: Number, default: 0 },
    description: String,
    image: String,
    video: { type: String, default: '' },
    galleryImages: [String],
    inStock: { type: Boolean, default: true },
    sizes: { type: [String], default: ['S', 'M', 'L', 'XL'] },
    ratings: [Number],
    votes: { type: Number, default: 0 },
    wishlistCount: { type: Number, default: 0 },
    badge: { type: String, default: 'New Arrival' },
    reviews: [{
        reviewerName: String,
        rating: Number,
        comment: String,
        photoUrl: String,
        date: String
    }],
    faqs: [{
        q: String,
        a: String
    }]
});
const Product = mongoose.models.Product || mongoose.model('Product', ProductSchema);

const StoreOrderSchema = new mongoose.Schema({
    orderId: String,
    name: String,
    phone: String,
    email: String,
    address: String,
    payMode: String,
    items: Array,
    subtotal: Number,
    deliveryFee: Number,
    total: Number,
    status: String,
    timeline: Array,
    customMessage: String,
    customImage: String,
    paymentProofUrl: String,
    date: String
});
const StoreOrder = mongoose.models.StoreOrder || mongoose.model('StoreOrder', StoreOrderSchema);

const StoreSubscriberSchema = new mongoose.Schema({
    email: String,
    date: String
});
const StoreSubscriber = mongoose.models.StoreSubscriber || mongoose.model('StoreSubscriber', StoreSubscriberSchema);

const StoreQRSchema = new mongoose.Schema({
    imageUrl: String
});
const StoreQR = mongoose.models.StoreQR || mongoose.model('StoreQR', StoreQRSchema);

const ComingSoonDropSchema = new mongoose.Schema({
    title: String,
    desc: String,
    image: String
});
const ComingSoonDrop = mongoose.models.ComingSoonDrop || mongoose.model('ComingSoonDrop', ComingSoonDropSchema);

const CampaignSchema = new mongoose.Schema({
    title: String,
    desc: String,
    image: String
});
const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', CampaignSchema);

app.post('/api/store/send-drop-launch-email', async (req, res) => {
    try {
        const { recipients, productTitle, productDesc, productImage, storeUrl } = req.body;
        const title = productTitle || 'Hoknex Atelier Drop';
        const desc = productDesc || 'Your requested upcoming release is now live at the Hoknex Store.';

        const dbAlerts = await StoreDropAlert.find({ productTitle: title });
        const combinedRecipients = [
            ...(Array.isArray(recipients) ? recipients : []),
            ...dbAlerts.map(a => a.email)
        ];

        const matchedProd = await Product.findOne({ name: title });
        const baseStoreUrl = /^https?:\/\//i.test(String(storeUrl || '').trim())
            ? String(storeUrl).trim()
            : 'https://hoknex.pages.dev/store';
        const directStoreUrl = matchedProd && matchedProd._id
            ? `${baseStoreUrl}${baseStoreUrl.includes('?') ? '&' : '?'}product=${matchedProd._id}`
            : baseStoreUrl;

        let resolvedImg = String(productImage || '').trim();
        if (!/^https:\/\//i.test(resolvedImg)) {
            const matchedDrop = await ComingSoonDrop.findOne({ title });
            if (matchedDrop && /^https:\/\//i.test(String(matchedDrop.image || '').trim())) {
                resolvedImg = String(matchedDrop.image).trim();
            } else if (matchedProd && /^https:\/\//i.test(String(matchedProd.image || '').trim())) {
                resolvedImg = String(matchedProd.image).trim();
            } else {
                const alertWithImg = dbAlerts.find(a => /^https:\/\//i.test(String(a.productImage || '').trim()));
                if (alertWithImg) resolvedImg = String(alertWithImg.productImage).trim();
            }
        }

        const isHttpImage = /^https:\/\//i.test(resolvedImg) && !/\.(mp4|webm|mov)(\?|$)/i.test(resolvedImg);
        const imgBlock = isHttpImage
            ? `
                <div style="margin:18px 0; text-align:center; background:#F2ECE1; padding:14px; border-radius:8px; border:1px solid #E2DBD0;">
                    <a href="${directStoreUrl}" target="_blank" style="display:inline-block; text-decoration:none;">
                        <img src="${resolvedImg}" alt="${title}" style="max-width:100%; max-height:300px; border-radius:6px; display:block;">
                    </a>
                </div>
            `
            : '';

        const htmlContent = `
            <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif; max-width:580px; margin:0 auto; background:#FAF6F0; color:#2C1E16; border:1px solid #E2DBD0; border-radius:12px; overflow:hidden;">
                <div style="background:#2C1E16; color:#FAF6F0; padding:20px 24px;">
                    <div style="font-size:11px; letter-spacing:2.5px; text-transform:uppercase; color:#E5C158; font-weight:700;">Hoknex Official Store • Drop Launched</div>
                    <h2 style="margin:6px 0 0 0; font-size:21px; font-weight:600; color:#FAF6F0;">${title} Is Now Live</h2>
                </div>
                <div style="padding:24px; line-height:1.65; font-size:14px;">
                    <p style="margin:0 0 12px 0; color:#6E5D52;">${desc}</p>
                    ${imgBlock}
                    <div style="text-align:center; margin:20px 0 10px 0;">
                        <a href="${directStoreUrl}" target="_blank" style="display:inline-block; background:#C05621; color:#FFFFFF; text-decoration:none; padding:12px 24px; border-radius:6px; font-weight:700; font-size:13px; letter-spacing:0.6px; text-transform:uppercase;">
                            Shop Now on Hoknex Store →
                        </a>
                    </div>
                    <div style="margin-top:20px; padding-top:14px; border-top:1px solid #E2DBD0; font-size:12px; color:#6E5D52; text-align:center;">
                        Sent by <strong style="color:#2C1E16;">Hoknex Official Store</strong> • hoknex.in@gmail.com
                    </div>
                </div>
            </div>
        `;
        const textContent = `Hoknex Official Store (hoknex.in@gmail.com)\n\n${title} Is Now Live!\n${desc}\nOrder now: ${directStoreUrl}${isHttpImage ? `\nProduct Image: ${resolvedImg}` : ''}`;

        const result = await sendStoreEmailViaBrevo({
            toEmails: combinedRecipients,
            subject: `Now Live: ${title} — Hoknex Store`,
            htmlContent,
            textContent
        });

        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/store/report-fake-payment', async (req, res) => {
    try {
        const { orderId, customerName, customerEmail, proofUrl } = req.body;
        if (!customerEmail) {
            return res.status(400).json({ error: 'Customer email is required.' });
        }

        const safeOrderId = orderId || 'N/A';
        const safeName = customerName || 'Valued Customer';
        const safeProofUrl = String(proofUrl || '').trim();

        const attachmentBlock = /^https?:\/\//i.test(safeProofUrl)
            ? `
                <div style="margin:18px 0; padding:12px; background:#F2ECE1; border:1px solid #E2DBD0; border-radius:6px;">
                    <p style="margin:0 0 8px 0; font-size:12px; font-weight:700; color:#2C1E16; text-transform:uppercase; letter-spacing:1px;">Submitted Payment Screenshot</p>
                    <img src="${safeProofUrl}" alt="Submitted Payment Proof" style="max-width:100%; max-height:260px; border-radius:4px; border:1px solid #E2DBD0; display:block;">
                    <p style="margin:8px 0 0 0; font-size:12px;"><a href="${safeProofUrl}" target="_blank" style="color:#C05621; font-weight:600; text-decoration:none;">Open Full Screenshot ↗</a></p>
                </div>
            `
            : '';

        const htmlContent = `
            <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif; max-width:580px; margin:0 auto; background:#FAF6F0; color:#2C1E16; border:1px solid #E2DBD0; border-radius:10px; overflow:hidden;">
                <div style="background:#2C1E16; color:#FAF6F0; padding:18px 24px;">
                    <div style="font-size:11px; letter-spacing:2.5px; text-transform:uppercase; color:#E5C158; font-weight:700;">Hoknex Atelier • Payment Verification</div>
                    <h2 style="margin:6px 0 0 0; font-size:20px; font-weight:600; color:#FAF6F0;">Payment Proof Requires Attention — Order #${safeOrderId}</h2>
                </div>
                <div style="padding:24px; line-height:1.65; font-size:14px;">
                    <p style="margin:0 0 12px 0;">Hello <strong>${safeName}</strong>,</p>
                    <p style="margin:0 0 12px 0; color:#6E5D52;">
                        Our verification desk reviewed the payment proof submitted for Order <strong>#${safeOrderId}</strong> and could not confirm a valid, completed settlement matching your order.
                    </p>
                    ${attachmentBlock}
                    <p style="margin:0 0 12px 0; color:#6E5D52;">
                        If you completed the payment via UPI, please reply to <strong>hoknex.in@gmail.com</strong> with a clear, unedited transaction receipt/UTR reference so we can verify and process your order smoothly. Submitting invalid or altered payment proofs may result in order cancellation.
                    </p>
                    <div style="margin-top:20px; padding-top:14px; border-top:1px solid #E2DBD0; font-size:12px; color:#6E5D52;">
                        Warm regards,<br>
                        <strong style="color:#2C1E16;">Hoknex Official Store Team</strong> • hoknex.in@gmail.com
                    </div>
                </div>
            </div>
        `;

        const textContent = `Hoknex Official Store (hoknex.in@gmail.com)\n\nHello ${safeName},\n\nWe could not verify the payment screenshot for Order #${safeOrderId}. Please reply to hoknex.in@gmail.com with a valid payment receipt or UTR details.\n${safeProofUrl ? `Submitted Proof: ${safeProofUrl}` : ''}`;

        const result = await sendStoreEmailViaBrevo({
            toEmails: [customerEmail],
            subject: `Payment Verification Notice — Order #${safeOrderId} | Hoknex Store`,
            htmlContent,
            textContent
        });

        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Product Wishlist Count Endpoint ---
app.put('/api/store/products/:id/wishlist', async (req, res) => {
    try {
        const delta = Number(req.body.delta);
        const step = delta === -1 ? -1 : 1;
        const prod = await Product.findById(req.params.id);
        if (!prod) return res.status(404).json({ error: 'Product not found' });
        prod.wishlistCount = Math.max(0, Number(prod.wishlistCount || 0) + step);
        await prod.save();
        res.json({ success: true, wishlistCount: prod.wishlistCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Product Customer Reviews & Photos Endpoints ---
app.get('/api/store/products/:id/reviews', async (req, res) => {
    try {
        const prod = await Product.findById(req.params.id).select('reviews ratings');
        if (!prod) return res.status(404).json({ error: 'Product not found' });
        res.json({ reviews: prod.reviews || [], ratings: prod.ratings || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/store/products/:id/reviews', async (req, res) => {
    try {
        const { reviewerName, rating, comment, photoUrl, date } = req.body;
        const prod = await Product.findById(req.params.id);
        if (!prod) return res.status(404).json({ error: 'Product not found' });

        if (!prod.reviews) prod.reviews = [];
        const newReview = {
            reviewerName: reviewerName || 'Customer',
            rating: Number(rating) || 5,
            comment: comment || '',
            photoUrl: photoUrl || '',
            date: date || new Date().toLocaleDateString()
        };
        prod.reviews.unshift(newReview);

        if (!prod.ratings) prod.ratings = [];
        prod.ratings.push(Number(rating) || 5);

        await prod.save();
        res.status(201).json({ success: true, review: newReview, reviews: prod.reviews, ratings: prod.ratings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Product FAQ Endpoints ---
app.get('/api/store/products/:id/faqs', async (req, res) => {
    try {
        const prod = await Product.findById(req.params.id).select('faqs');
        if (!prod) return res.status(404).json({ error: 'Product not found' });
        res.json({ faqs: prod.faqs || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/store/products/:id/faqs', async (req, res) => {
    try {
        const { q, a } = req.body;
        if (!q) return res.status(400).json({ error: 'Question is required' });
        const prod = await Product.findById(req.params.id);
        if (!prod) return res.status(404).json({ error: 'Product not found' });

        if (!prod.faqs) prod.faqs = [];
        const newFaq = {
            q,
            a: a || 'Submitted! Our team will update the answer shortly.'
        };
        prod.faqs.push(newFaq);
        await prod.save();
        res.status(201).json({ success: true, faq: newFaq, faqs: prod.faqs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// --- DEDICATED DONATION & CERTIFICATE ROUTES ---
// ==========================================

const DonationSchema = new mongoose.Schema({
    donorName: String,
    email: String,
    amount: Number,
    proofUrl: String,
    status: { type: String, default: 'Pending Verification ⏳' },
    certificateUrl: { type: String, default: '' },
    date: { type: Date, default: Date.now }
});
const Donation = mongoose.models.Donation || mongoose.model('Donation', DonationSchema);

app.get('/api/donations', async (req, res) => {
    try { const donations = await Donation.find().sort({ date: -1 }); res.json(donations); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/donations', async (req, res) => {
    try { const d = new Donation(req.body); await d.save(); res.json({ success: true, d }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/donations/:id/verify', async (req, res) => {
    try {
        const { certificateUrl } = req.body;
        await Donation.findByIdAndUpdate(req.params.id, {
            status: 'Verified & Certificate Issued 🎓',
            certificateUrl: certificateUrl
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/donations/:id', async (req, res) => {
    try { await Donation.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// --- DEDICATED FUND HELP DESK ROUTES ---
// ==========================================

const FundHelpDeskSchema = new mongoose.Schema({
    fullName: String,
    email: String,
    category: String,
    message: String,
    status: { type: String, default: 'Pending ⏳' },
    date: { type: Date, default: Date.now }
});
const FundHelpDesk = mongoose.models.FundHelpDesk || mongoose.model('FundHelpDesk', FundHelpDeskSchema);

app.get('/api/fund-helpdesk', async (req, res) => {
    try { const tickets = await FundHelpDesk.find().sort({ date: -1 }); res.json(tickets); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fund-helpdesk', async (req, res) => {
    try { const t = new FundHelpDesk(req.body); await t.save(); res.json({ success: true, t }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/fund-helpdesk/:id', async (req, res) => {
    try { await FundHelpDesk.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// --- ZINE MAGAZINE, SPOTLIGHT, BOOKS & TRENDING SCHEMAS & ROUTES ---
// ==========================================

const SpotlightSchema = new mongoose.Schema({
    title: { type: String, required: true },
    tag: { type: String, default: 'WORLD NEWS • SPOTLIGHT' },
    excerpt: { type: String, required: true },
    body: String,
    mediaUrl: String,
    mediaType: { type: String, default: 'image' },
    author: { type: String, default: 'World Desk International' },
    readTime: { type: String, default: '5 min read' },
    updatedAt: { type: Date, default: Date.now }
});
const Spotlight = mongoose.models.Spotlight || mongoose.model('Spotlight', SpotlightSchema);

const MagazineArticleSchema = new mongoose.Schema({
    title: { type: String, required: true },
    category: { type: String, required: true },
    type: { type: String, default: 'text' },
    mediaUrl: String,
    author: String,
    time: String,
    excerpt: String,
    body: String,
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    date: { type: Date, default: Date.now }
});
const MagazineArticle = mongoose.models.MagazineArticle || mongoose.model('MagazineArticle', MagazineArticleSchema);

const DigitalBookSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    coverUrl: { type: String, required: true },
    pdfUrl: { type: String, default: '' },
    pages: [String],
    createdAt: { type: Date, default: Date.now }
});
const DigitalBook = mongoose.models.DigitalBook || mongoose.model('DigitalBook', DigitalBookSchema);

const TrendingConfigSchema = new mongoose.Schema({
    headlines: [String]
});
const TrendingConfig = mongoose.models.TrendingConfig || mongoose.model('TrendingConfig', TrendingConfigSchema);

// --- Spotlight Banner Endpoints ---
app.get('/api/magazine/spotlight', async (req, res) => {
    try {
        const spotlight = await Spotlight.findOne().sort({ updatedAt: -1 });
        res.json(spotlight || {});
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/magazine/spotlight', async (req, res) => {
    try {
        await Spotlight.deleteMany({});
        const s = new Spotlight(req.body);
        await s.save();
        res.json({ success: true, s });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- Magazine Article Endpoints ---
app.get('/api/magazine/articles', async (req, res) => {
    try { const articles = await MagazineArticle.find().sort({ date: -1 }); res.json(articles); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/magazine/articles', async (req, res) => {
    try { const a = new MagazineArticle(req.body); await a.save(); res.json({ success: true, a }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/magazine/articles/:id/visit', async (req, res) => {
    try {
        const art = await MagazineArticle.findById(req.params.id);
        if(art) { art.views = (art.views || 0) + 1; await art.save(); }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/magazine/articles/:id', async (req, res) => {
    try { await MagazineArticle.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Digital Books Endpoints ---
app.get('/api/magazine/books', async (req, res) => {
    try { const books = await DigitalBook.find().sort({ createdAt: -1 }); res.json(books); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/magazine/books', async (req, res) => {
    try { const b = new DigitalBook(req.body); await b.save(); res.json({ success: true, b }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/magazine/books/:id', async (req, res) => {
    try { await DigitalBook.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Trending Config Endpoints ---
app.get('/api/magazine/trending', async (req, res) => {
    try {
        let config = await TrendingConfig.findOne();
        if(!config) { config = await TrendingConfig.create({ headlines: [] }); }
        res.json(config.headlines);
    } catch(e) { res.json([]); }
});

app.post('/api/magazine/trending', async (req, res) => {
    try {
        const { headlines } = req.body;
        let config = await TrendingConfig.findOne();
        if(config) { config.headlines = headlines; await config.save(); }
        else { config = await TrendingConfig.create({ headlines }); }
        res.json({ success: true, config });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- Store Products Endpoints ---
app.get('/api/store/products', async (req, res) => {
    try { const products = await Product.find(); res.json(products); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/products', async (req, res) => {
    try { const p = new Product(req.body); await p.save(); res.json({ success: true, p }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/store/products/:id', async (req, res) => {
    try { await Product.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/store/products/:id/stock', async (req, res) => {
    try {
        await Product.findByIdAndUpdate(req.params.id, { inStock: req.body.inStock, sizes: req.body.sizes });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/store/products/:id/vote', async (req, res) => {
    try {
        const prod = await Product.findById(req.params.id);
        if(!prod) return res.status(404).json({ error: 'Product not found' });
        prod.votes = (prod.votes || 0) + 1;
        await prod.save();
        res.json({ success: true, votes: prod.votes });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/store/products/:id/rate', async (req, res) => {
    try {
        const { rating } = req.body;
        const prod = await Product.findById(req.params.id);
        if(!prod) return res.status(404).json({ error: 'Product not found' });
        if(!prod.ratings) prod.ratings = [];
        prod.ratings.push(Number(rating));
        await prod.save();
        res.json({ success: true, ratings: prod.ratings });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Store Orders Endpoints ---
app.get('/api/store/orders', async (req, res) => {
    try { const orders = await StoreOrder.find(); res.json(orders); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/orders', async (req, res) => {
    try { const o = new StoreOrder(req.body); await o.save(); res.json({ success: true, o }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/store/orders/:id', async (req, res) => {
    try {
        const { status, customMessage } = req.body;
        let updateObj = {};
        if(status) {
            updateObj.status = status;
            await StoreOrder.findByIdAndUpdate(req.params.id, { $push: { timeline: { title: status, time: new Date().toLocaleString() } }, status });
        }
        if(customMessage !== undefined) updateObj.customMessage = customMessage;
        await StoreOrder.findByIdAndUpdate(req.params.id, updateObj);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/store/orders/:id', async (req, res) => {
    try { await StoreOrder.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Store Subscribers Endpoints ---
app.get('/api/store/subscribers', async (req, res) => {
    try { const subs = await StoreSubscriber.find(); res.json(subs); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/subscribers', async (req, res) => {
    try { const s = new StoreSubscriber(req.body); await s.save(); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/store/subscribers/:id', async (req, res) => {
    try { await StoreSubscriber.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Store QR Codes Endpoints ---
app.get('/api/store/qrs', async (req, res) => {
    try { const qrs = await StoreQR.find(); res.json(qrs); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/qrs', async (req, res) => {
    try { const q = new StoreQR(req.body); await q.save(); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/store/qrs/:id', async (req, res) => {
    try { await StoreQR.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Coming Soon Drops Endpoints ---
app.get('/api/store/drops', async (req, res) => {
    try { const drops = await ComingSoonDrop.find(); res.json(drops); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/drops', async (req, res) => {
    try { const d = new ComingSoonDrop(req.body); await d.save(); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/store/drops/:id', async (req, res) => {
    try { await ComingSoonDrop.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Visual Campaign Showcase Endpoints ---
app.get('/api/store/campaigns', async (req, res) => {
    try { const camps = await Campaign.find(); res.json(camps); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/campaigns', async (req, res) => {
    try { const c = new Campaign(req.body); await c.save(); res.json({ success: true, c }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/store/campaigns/:id', async (req, res) => {
    try { await Campaign.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// --- EXISTING PLATFORM ROUTES & LOGIC ---
// ==========================================

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
    const identifier = req.body.username || req.body.email || req.body.identifier || req.body.usernameOrEmail || req.body.loginId || '';
    const password = req.body.password;

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Please provide credentials' });
    }

    let cleanIdentifier = identifier;
    if (!identifier.includes('.com') && !identifier.includes('.in') && !identifier.includes('.edu')) {
         cleanIdentifier = identifier.replace('@', '');
    }

    try {
        const user = await User.findOne({
            $or: [
                { username: cleanIdentifier },
                { email: identifier }
            ]
        });

        if (!user) {
            return res.status(400).json({ error: 'User not found or incorrect password' });
        }

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
      if (req.files['dp'] && req.files['dp'][0]) updateData.dpUrl = req.files['dp'][0].path;
      if (req.files['banner'] && req.files['banner'][0]) updateData.bannerUrl = req.files['banner'][0].path;
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
    res.json({
      globalStudents: peopleCount || 1,
      campusPosts: postsCount,
      activeClubs: clubsCount,
      people: peopleCount || 1,
      posts: postsCount,
      clubs: clubsCount
    });
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
        note: reqUser.note || '',
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
        const { sender, recipient, text, mediaUrl, mediaType, isRead } = req.body;
        if (!sender || !recipient) {
            return res.status(400).json({ error: 'Sender and recipient are required.' });
        }

        const msg = new Message({
            sender,
            recipient,
            text: text || '',
            mediaUrl: mediaUrl || '',
            mediaType: mediaType || 'text',
            isRead: isRead || false
        });
        await msg.save();
        res.status(201).json(msg);
    } catch (err) {
        console.error('Message save error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/messages/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        const messages = await Message.find({
            $or: [
                { sender: user1, recipient: user2 },
                { sender: user2, recipient: user1 }
            ]
        }).sort({ createdAt: 1 });

        res.json(Array.isArray(messages) ? messages : []);
    } catch (err) {
        console.error('Fetch messages error:', err);
        res.status(500).json([]);
    }
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file || !req.file.path) {
            return res.status(400).json({ error: 'No file uploaded or upload failed.' });
        }
        res.status(200).json({ url: req.file.path });
    } catch (err) {
        console.error('Upload route error:', err);
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

app.delete('/api/messages/single/:msgId', async (req, res) => {
    try {
        await Message.findByIdAndDelete(req.params.msgId);
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/messages/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        await Message.deleteMany({
            $or: [
                { sender: user1, recipient: user2 },
                { sender: user2, recipient: user1 }
            ]
        });
        res.status(200).json({ success: true, message: 'Chat deleted successfully.' });
    } catch (err) {
        console.error('Delete chat error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/messages/read/:sender/:recipient', async (req, res) => {
    try {
        await Message.updateMany(
            { sender: req.params.sender, recipient: req.params.recipient, isRead: false },
            { $set: { isRead: true } }
        );
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Read receipt error:', err);
        res.status(500).json({ error: err.message });
    }
});

const SupportReportSchema = new mongoose.Schema({
    reporter: { type: String, required: true },
    reportedUser: { type: String, required: true },
    reason: { type: String, required: true },
    details: { type: String },
    attachmentUrl: { type: String },
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});
const SupportReport = mongoose.models.SupportReport || mongoose.model('SupportReport', SupportReportSchema);

app.post('/api/reports', upload.single('image'), async (req, res) => {
    try {
        const { reporter, reportedUser, reason, details } = req.body;
        const attachmentUrl = req.file ? req.file.path : '';
        const report = new SupportReport({ reporter, reportedUser, reason, details, attachmentUrl });
        await report.save();
        res.status(201).json({ success: true, message: 'Report submitted successfully to Hoknex Support Team.' });
    } catch (err) {
        console.error('Report submission error:', err);
        res.status(500).json({ error: err.message });
    }
});

const BlockSchema = new mongoose.Schema({
    blocker: { type: String, required: true },
    blocked: { type: String, required: true }
});
const BlockModel = mongoose.models.Block || mongoose.model('Block', BlockSchema);

app.get('/api/blocks/:user', async (req, res) => {
    try {
        const blocks = await BlockModel.find({ blocker: req.params.user });
        res.json(blocks.map(b => b.blocked));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/blocks', async (req, res) => {
    try {
        const { blocker, blocked, action } = req.body;
        if (action === 'block') {
            await BlockModel.updateOne({ blocker, blocked }, { blocker, blocked }, { upsert: true });
        } else {
            await BlockModel.deleteOne({ blocker, blocked });
        }
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Block action error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.use(async (req, res, next) => {
    try {
        const userId = req.headers['x-user-id'] || req.query.userId;
        if (userId) {
            const User = mongoose.model('User');
            await User.findByIdAndUpdate(userId, { lastActive: new Date() });
        }
    } catch (e) { }
    next();
});

app.post('/api/posts/:id/vote', async (req, res) => {
    try {
        const { optionIndex } = req.body;
        let post = await Post.findById(req.params.id);

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (!post.poll || !post.poll.options) {
            return res.status(400).json({ error: 'Poll not found' });
        }

        post.poll.options = post.poll.options.map(opt => {
            if (typeof opt === 'string') {
                return { text: opt, votes: 0 };
            }
            return { text: opt.text || String(opt), votes: opt.votes || 0 };
        });

        if (post.poll.options[optionIndex]) {
            post.poll.options[optionIndex].votes = (post.poll.options[optionIndex].votes || 0) + 1;
        }

        post.markModified('poll');
        await post.save();

        res.json(post);
    } catch (err) {
        console.error('Voting server error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/posts', upload.single('image'), async (req, res) => {
    try {
        let pollData = null;
        if (req.body.poll) {
            try {
                pollData = typeof req.body.poll === 'string' ? JSON.parse(req.body.poll) : req.body.poll;
            } catch(e) {}
        }

        let user = req.body.username ? await User.findOne({ username: req.body.username.trim() }) : null;

        const newPost = new Post({
            content: req.body.content || '',
            username: req.body.username || 'Student',
            imageUrl: req.file ? req.file.path : '',
            poll: pollData,
            author: user ? user._id : null
        });

        await newPost.save();
        const populated = await Post.findById(newPost._id).populate('author', 'name username dpUrl');
        res.status(201).json(populated || newPost);
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

    post.replies.push({
        text,
        username: username || 'User',
        authorName: user ? user.name : (username || 'User')
    });

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

app.post('/api/projects', upload.single('image'), async (req, res) => {
    try {
        const title = req.body.title;
        const description = req.body.desc || req.body.description || '';
        const classification = req.body.classification || 'Showcase';
        const audience = req.body.audience || 'Open to All';
        const techStack = req.body.techStack || '';
        const projectUrl = req.body.projectUrl || '';
        const author = req.body.author || 'Student';

        if (!title) {
            return res.status(400).json({ error: 'Project title is required.' });
        }

        const imageUrl = req.file ? req.file.path : '';

        const newProj = new Project({
            title,
            desc: description,
            classification,
            audience,
            techStack,
            projectUrl,
            imageUrl,
            author
        });

        await newProj.save();
        res.status(201).json(newProj);
    } catch (err) {
        console.error('Project creation error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        await Project.findByIdAndDelete(req.params.id);
        res.json({ message: 'Project deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/react', async (req, res) => {
    try {
        const { type } = req.body;
        const proj = await Project.findById(req.params.id);
        if (!proj) return res.status(404).json({ error: 'Project not found' });

        if (proj.reactions && proj.reactions[type] !== undefined) {
            proj.reactions[type] += 1;
            await proj.save();
        }
        res.json(proj);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/rate', async (req, res) => {
    try {
        const { rating } = req.body;
        const proj = await Project.findById(req.params.id);
        if (!proj) return res.status(404).json({ error: 'Project not found' });

        proj.rating = ((proj.rating * proj.ratingsCount) + Number(rating)) / (proj.ratingsCount + 1);
        proj.ratingsCount += 1;
        await proj.save();

        res.json(proj);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// --- HOKNEX CLUB / SPACE ROUTES ---
// ==========================================

app.get('/api/clubs', async (req, res) => {
  try {
    const clubs = await Club.find()
      .populate('owner', '_id name username dpUrl')
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
    const { name, description, username, dpUrl, defaultChannel, channelTopic } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Server name is required' });
    }
    const user = username ? await User.findOne({ username }) : null;
    const cleanChannel = (defaultChannel || 'general')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'general';

    const inviteCode = 'HKX-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    const newClub = new Club({
      name: name.trim(),
      description: (description || '').trim(),
      dpUrl: dpUrl || '',
      inviteCode,
      owner: user ? user._id : null,
      members: user ? [user._id] : [],
      roles: user ? [{ username: user.username, role: 'Admin', powers: ['all'] }] : [],
      channels: [{
        name: cleanChannel,
        topic: (channelTopic || 'Team discussions & announcements').trim(),
        isBroadcast: false,
        pinnedNotice: '',
        polls: [],
        messages: []
      }],
      modApplications: []
    });
    await newClub.save();
    res.status(201).json(newClub);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/join-by-invite', async (req, res) => {
  try {
    const { inviteCode, username } = req.body;
    if (!inviteCode || !username) return res.status(400).json({ error: 'Invite code and username required' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const codeClean = inviteCode.trim().toUpperCase();
    const club = await Club.findOne({
      $or: [{ inviteCode: codeClean }, { _id: mongoose.Types.ObjectId.isValid(inviteCode.trim()) ? inviteCode.trim() : null }]
    });
    if (!club) return res.status(404).json({ error: 'Invalid invite link or code' });

    club.members = club.members || [];
    if (!club.members.map(m => m.toString()).includes(user._id.toString())) {
      club.members.push(user._id);
      club.roles = club.roles || [];
      if (!club.roles.some(r => r.username === user.username)) {
        club.roles.push({ username: user.username, role: 'Member', powers: ['chat', 'thread', 'sticker'] });
      }
      await club.save();
    }
    res.json({ success: true, club });
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
    if (!club) return res.status(404).json({ error: 'Club not found' });

    club.members = club.members || [];
    if (!club.members.map(m => m.toString()).includes(user._id.toString())) {
      club.members.push(user._id);
      club.roles = club.roles || [];
      if (!club.roles.some(r => r.username === user.username)) {
        club.roles.push({ username: user.username, role: 'Member', powers: ['chat', 'thread', 'sticker'] });
      }
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
    const { userId, action } = req.body;
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    club.joinRequests = (club.joinRequests || []).filter(reqId => {
      const idStr = reqId._id ? reqId._id.toString() : reqId.toString();
      return idStr !== userId.toString();
    });

    if (action === 'accept') {
      club.members = club.members || [];
      const memberStrList = club.members.map(m => m.toString());
      if (!memberStrList.includes(userId.toString())) {
        club.members.push(userId);
      }
      const joinedUser = await User.findById(userId).select('username');
      club.roles = club.roles || [];
      if (joinedUser && !club.roles.some(r => r.username === joinedUser.username)) {
        club.roles.push({ username: joinedUser.username, role: 'Member', powers: ['chat', 'thread', 'sticker'] });
      }
    }

    await club.save();
    res.json({ message: `Request ${action}ed successfully`, club });
  } catch (err) {
    console.error('Handle request error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/roles', async (req, res) => {
  try {
    const { targetUsername, role, powers } = req.body;
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    club.roles = club.roles || [];
    const finalPowers = role === 'Admin'
      ? ['all', 'manage_channels', 'manage_roles', 'manage_mods', 'pin_messages', 'chat', 'thread', 'sticker']
      : (Array.isArray(powers) ? powers : ['chat', 'thread', 'sticker']);

    const idx = club.roles.findIndex(r => r.username === targetUsername);
    if (idx > -1) {
      club.roles[idx].role = role;
      club.roles[idx].powers = finalPowers;
    } else {
      club.roles.push({ username: targetUsername, role, powers: finalPowers });
    }

    await club.save();
    res.json({ success: true, roles: club.roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/mod-apply', async (req, res) => {
  try {
    const { username, experience, whyMod, hoursPerWeek } = req.body;
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    club.modApplications = club.modApplications || [];
    club.modApplications.push({
      username,
      experience: experience || '',
      whyMod: whyMod || '',
      hoursPerWeek: hoursPerWeek || '5-10 hrs/wk',
      status: 'Pending',
      appliedAt: new Date()
    });
    await club.save();
    res.json({ success: true, message: 'Moderator application submitted!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/mod-decision', async (req, res) => {
  try {
    const { appId, decision } = req.body;
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    club.modApplications = club.modApplications || [];
    const targetApp = club.modApplications.find(a => (a._id && a._id.toString() === appId) || a.username === appId);
    if (targetApp) {
      targetApp.status = decision === 'approve' ? 'Approved' : 'Rejected';
      if (decision === 'approve') {
        club.roles = club.roles || [];
        const modPowers = ['chat', 'thread', 'sticker', 'pin_messages', 'manage_channels'];
        const rIdx = club.roles.findIndex(r => r.username === targetApp.username);
        if (rIdx > -1) {
          club.roles[rIdx].role = 'Moderator';
          club.roles[rIdx].powers = modPowers;
        } else {
          club.roles.push({ username: targetApp.username, role: 'Moderator', powers: modPowers });
        }
      }
    }
    await club.save();
    res.json({ success: true, club });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:id/channels', async (req, res) => {
  try {
    const { channelName, topic } = req.body;
    if (!channelName || !channelName.trim()) {
      return res.status(400).json({ error: 'Channel name is required' });
    }
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    const cleanName = channelName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'channel';

    club.channels.push({
      name: cleanName,
      topic: (topic || 'Workspace channel • Live thread & mentions enabled').trim(),
      isBroadcast: false,
      pinnedNotice: '',
      polls: [],
      messages: []
    });
    await club.save();
    res.json(club);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clubs/:clubId/channels/:channelId', async (req, res) => {
  try {
    const club = await Club.findById(req.params.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found' });
    if (club.channels.length <= 1) {
      return res.status(400).json({ error: 'At least one channel must remain' });
    }
    club.channels = club.channels.filter(ch => ch._id.toString() !== req.params.channelId);
    await club.save();
    res.json({ success: true, club });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle Broadcast Mode & Pinned Notice on a Channel
app.put('/api/clubs/:clubId/channels/:channelId/settings', async (req, res) => {
  try {
    const { isBroadcast, pinnedNotice } = req.body;
    const club = await Club.findById(req.params.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    const channel = club.channels.id(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    if (typeof isBroadcast === 'boolean') {
      channel.set('isBroadcast', isBroadcast);
    }
    if (pinnedNotice !== undefined) {
      channel.set('pinnedNotice', String(pinnedNotice));
    }

    club.markModified('channels');
    await club.save();
    res.json({ success: true, channel, club });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create an Interactive Channel Poll
app.post('/api/clubs/:clubId/channels/:channelId/polls', async (req, res) => {
  try {
    const { question, options, createdBy } = req.body;
    const cleanQuestion = String(question || '').trim();
    const cleanOptions = Array.isArray(options)
      ? options.map(o => String(o || '').trim()).filter(Boolean)
      : [];

    if (!cleanQuestion || cleanOptions.length < 2) {
      return res.status(400).json({ error: 'Poll question and at least 2 options are required.' });
    }

    const club = await Club.findById(req.params.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    const channel = club.channels.id(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const existingPolls = channel.get('polls') || [];
    const newPoll = {
      _id: new mongoose.Types.ObjectId(),
      question: cleanQuestion,
      createdBy: createdBy || 'Member',
      options: cleanOptions.map(label => ({ label, votes: [] })),
      createdAt: new Date()
    };
    existingPolls.push(newPoll);
    channel.set('polls', existingPolls);

    club.markModified('channels');
    await club.save();
    res.status(201).json({ success: true, poll: newPoll, channel, club });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vote on a Channel Poll Option (Toggle vote per user)
app.post('/api/clubs/:clubId/channels/:channelId/polls/:pollId/vote', async (req, res) => {
  try {
    const { optionIndex, username } = req.body;
    const voter = String(username || 'Member').trim();
    const idx = Number(optionIndex);

    const club = await Club.findById(req.params.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    const channel = club.channels.id(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const polls = channel.get('polls') || [];
    const poll = polls.find(p => p._id && p._id.toString() === req.params.pollId);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });

    if (!Array.isArray(poll.options) || !poll.options[idx]) {
      return res.status(400).json({ error: 'Invalid poll option' });
    }

    poll.options.forEach(opt => {
      opt.votes = (opt.votes || []).filter(u => u !== voter);
    });
    poll.options[idx].votes.push(voter);

    channel.set('polls', polls);
    club.markModified('channels');
    await club.save();
    res.json({ success: true, poll, channel, club });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:clubId/channels/:channelId/messages', upload.single('media'), async (req, res) => {
  try {
    const { text, username, replyTo, stickerUrl, parentMessageId, activityStatus } = req.body;
    const user = username ? await User.findOne({ username }).select('name username dpUrl') : null;
    const senderName = user ? user.name : username || 'Member';
    const senderUsername = user ? user.username : username || '';
    const senderDp = user ? (user.dpUrl || '') : '';

    let messageText = text || '';
    if (req.file && req.file.path) {
      messageText += ` [Media]: ${req.file.path}`;
    }
    if (stickerUrl) {
      messageText += ` [Sticker]: ${stickerUrl}`;
    }
    if (replyTo && replyTo.trim()) {
      messageText = `> Replying to ${replyTo.trim()}\n${messageText}`.trim();
    }

    const club = await Club.findById(req.params.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    const channel = club.channels.id(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    if (parentMessageId) {
      const parentMsg = channel.messages.id(parentMessageId);
      if (parentMsg) {
        parentMsg.threadReplies = parentMsg.threadReplies || [];
        parentMsg.threadReplies.push({
          senderName,
          senderUsername,
          senderDp,
          text: messageText,
          createdAt: new Date()
        });
        await club.save();
        return res.json(channel);
      }
    }

    channel.messages.push({
      senderName,
      senderUsername,
      senderDp,
      activityStatus: activityStatus || '🟢 Active',
      text: messageText,
      reactions: [],
      threadReplies: [],
      createdAt: new Date()
    });
    await club.save();
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clubs/:clubId/channels/:channelId/messages/:messageId', async (req, res) => {
  try {
    const club = await Club.findById(req.params.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found' });
    const channel = club.channels.id(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    channel.messages = (channel.messages || []).filter(m => m._id.toString() !== req.params.messageId);
    await club.save();
    res.json({ success: true, channel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clubs/:clubId/channels/:channelId/messages/:messageId/react', async (req, res) => {
  try {
    const { emoji, username } = req.body;
    const club = await Club.findById(req.params.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    const channel = club.channels.id(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const msg = channel.messages.id(req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    msg.reactions = msg.reactions || [];
    const existing = msg.reactions.find(r => r.emoji === emoji);
    if (existing) {
      existing.users = existing.users || [];
      const idx = existing.users.indexOf(username);
      if (idx > -1) {
        existing.users.splice(idx, 1);
        if (existing.users.length === 0) {
          msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
        }
      } else {
        existing.users.push(username);
      }
    } else {
      msg.reactions.push({ emoji, users: [username] });
    }

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
    if (!user) return res.status(404).json({ error: 'User not found' });

    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });

    club.members = (club.members || []).filter(m => m.toString() !== user._id.toString());
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
    if (!club) return res.status(404).json({ error: 'Club not found' });

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
            description: queryText,
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

app.get('/api/support', async (req, res) => {
    try {
        const tickets = await Support.find().sort({ createdAt: -1 });
        res.json(tickets);
    } catch (error) {
        console.error("Error fetching tickets:", error);
        res.status(500).json({ error: 'Failed to load tickets.' });
    }
});

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

        let attendee = (event.attendees || []).find(a => a.username === username);
        let ticketId;

        if (attendee) {
            ticketId = attendee.ticketId;
        } else {
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

        res.json({ event, ticketId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/events/:id', async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.json({ message: 'Event deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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

app.get('/api/events/:id/export-attendance', async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ error: 'Event not found' });

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

app.get('/api/applications', async (req, res) => {
    try {
        const apps = await OrganizerApp.find().sort({ appliedAt: -1 });
        res.json(apps);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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

app.get('/api/organizers', async (req, res) => {
    try {
        const approvedApps = await OrganizerApp.find({ status: 'approved' });
        const approvedUsernames = approvedApps.map(app => app.username.toLowerCase());
        res.json(approvedUsernames);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// --- PINBOARD SCHEMA & API ENDPOINTS ---
// ==========================================

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

        let optimizedImg = img;
        if (optimizedImg.includes('cloudinary.com') && !optimizedImg.includes('q_auto')) {
            optimizedImg = optimizedImg.replace('/upload/', '/upload/q_auto,f_auto/');
        }

        const newPin = new Pin({
            title,
            desc: desc || 'No description provided.',
            img: optimizedImg,
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
        let { ticketId, organizerUsername } = req.body;

        if (!ticketId) {
            return res.status(400).json({ error: 'Ticket ID is required.' });
        }

        if (typeof ticketId === 'string' && ticketId.startsWith('{')) {
            try {
                const parsed = JSON.parse(ticketId);
                if (parsed.ticketId) {
                    ticketId = parsed.ticketId;
                }
            } catch (e) {
                // Keep original string if parsing fails
            }
        }

        const event = await Event.findOne({ 'attendees.ticketId': ticketId });
        if (!event) {
            return res.status(404).json({ error: 'Invalid Ticket! No matching reservation found.' });
        }

        const attendee = event.attendees.find(a => a.ticketId === ticketId);
        if (!attendee) {
            return res.status(404).json({ error: 'Attendee record not found for this ticket.' });
        }

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
        console.error("Ticket verification error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects', async (req, res) => {
    try {
        const projects = await Project.find().sort({ createdAt: -1 });
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const lostFoundSchema = new mongoose.Schema({
    id: String,
    title: String,
    desc: String,
    type: String,
    dropBox: String,
    author: String,
    createdAt: { type: Date, default: Date.now }
});
const LostFound = mongoose.models.LostFound || mongoose.model('LostFound', lostFoundSchema);

app.get('/api/lostfound', async (req, res) => {
    try {
        const items = await LostFound.find().sort({ createdAt: -1 });
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load items' });
    }
});

app.post('/api/lostfound', async (req, res) => {
    try {
        const newItem = new LostFound(req.body);
        await newItem.save();
        res.status(201).json(newItem);
    } catch (err) {
        res.status(500).json({ error: 'Failed to publish report' });
    }
});

const lnfChatSchema = new mongoose.Schema({
    itemId: String,
    sender: String,
    text: String,
    imageUrl: String,
    time: String
});
const LnfChat = mongoose.models.LnfChat || mongoose.model('LnfChat', lnfChatSchema);

app.get('/api/lnf-chat/:itemId', async (req, res) => {
    try {
        const messages = await LnfChat.find({ itemId: req.params.itemId });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load chat' });
    }
});

app.post('/api/lnf-chat', async (req, res) => {
    try {
        const newMsg = new LnfChat(req.body);
        await newMsg.save();
        res.status(201).json(newMsg);
    } catch (err) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.delete('/api/lostfound/:id', async (req, res) => {
    try {
        await LostFound.findOneAndDelete({ id: req.params.id });
        res.status(200).json({ message: 'Item deleted successfully' });
    } catch (err) {
        console.error("Error deleting item:", err);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

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

// --- BREVO HTTP API OTP ROUTE (Bypasses Render SMTP Blocking) ---
const otpStore = {};

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

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        console.log(`🔑 [DEV FALLBACK] BREVO_API_KEY missing. OTP for ${email}: ${otp}`);
        return res.json({
            success: true,
            message: 'OTP generated! (Check Render logs)'
        });
    }

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: "Hoknex Platform", email: "hoknex.in@gmail.com" },
                to: [{ email: email, name: name }],
                subject: "Hoknex Account Verification",
                textContent: `Hello ${name},\n\nYour secure 6-digit verification code for Hoknex is: ${otp}\n\nIt will expire soon.`
            })
        });

        const data = await response.json();

        if (response.ok) {
            res.json({ success: true, message: 'OTP sent to email via Brevo!' });
        } else {
            console.error("Brevo API Error:", data);
            console.log(`🔑 [BREVO FALLBACK] OTP for ${email}: ${otp}`);
            res.json({
                success: true,
                message: 'OTP generated! (Check Render logs)'
            });
        }
    } catch (error) {
        console.error("Fetch Error:", error.message);
        console.log(`🔑 [NETWORK FALLBACK] OTP for ${email}: ${otp}`);
        res.json({
            success: true,
            message: 'OTP generated! (Check Render logs)'
        });
    }
});

app.post('/api/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    const record = otpStore[email];

    if (!record) return res.status(400).json({ error: 'OTP expired or email not found.' });
    if (record.otp !== otp) return res.status(400).json({ error: 'Incorrect verification code.' });

    try {
        const cleanUsername = String(record.username).replace('@', '');
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(record.password, salt);

        const newUser = new User({
            name: record.name,
            username: cleanUsername,
            email: email,
            password: hashedPassword
        });
        await newUser.save();

        delete otpStore[email];
        res.json({ success: true, message: 'Account saved!', username: cleanUsername });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'This email or username is already registered.' });
        }
        console.error("DB Save Error:", error);
        res.status(500).json({ error: 'Error saving account to database.' });
    }
});

const PORT = process.env.PORT || 5000;

// ✅ Render Standalone Server Listener
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} 🚀`);
});
