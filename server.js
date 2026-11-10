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
        allowedFormats: ['jpeg', 'png', 'jpg', 'webp', 'webm', 'mp3', 'wav', 'mov', 'mp4'] 
    }
});

// 3. Initialize Multer
const upload = multer({ storage: storage });

let isConnected = false;

const connectDB = async () => {
    if (isConnected) return;
    try {
        // 🔒 BULLETPROOF FIX: Forcefully target the 'test' database regardless of dashboard strings
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

const reelCommentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 300 },
    createdAt: { type: Date, default: Date.now }
});

const reelSchema = new mongoose.Schema({
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cloudinaryPublicId: { type: String, required: true },
    hlsUrl: { type: String, required: true },
    fallbackMp4Url: { type: String, required: true },
    thumbnailUrl: { type: String, required: true },
    duration: { type: Number, default: 0 },
    caption: { type: String, maxlength: 300, default: '' },
    tags: [{ type: String, index: true }],
    audioTrack: {
        name: { type: String, default: 'Original Audio' },
        artist: { type: String, default: 'Hoknex Creator' },
        externalLink: { type: String, default: '' }
    },
    views: { type: Number, default: 0 },
    likesCount: { type: Number, default: 0 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    commentsCount: { type: Number, default: 0 },
    comments: [reelCommentSchema],
    sharesCount: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 100, index: true }
}, { timestamps: true });

reelSchema.index({ engagementScore: -1, _id: -1 });
const Reel = mongoose.models.Reel || mongoose.model('Reel', reelSchema);

const reelsRouter = express.Router();

// 1. Generate Direct-to-Cloudinary Upload Signature
reelsRouter.get('/upload-signature', async (req, res) => {
    try {
        const timestamp = Math.round(new Date().getTime() / 1000);
        const folder = 'hoknex_reels';
        const eagerTransform = 'sp_auto/m3u8|w_480,c_scale,f_jpg';

        const signature = cloudinary.utils.api_sign_request({
            timestamp: timestamp,
            folder: folder,
            resource_type: 'video',
            eager: eagerTransform,
            eager_async: true,
            notification_url: `${process.env.RENDER_EXTERNAL_URL || 'https://hoknex-backend.onrender.com'}/api/reels/cloudinary-webhook`
        }, process.env.CLOUDINARY_API_SECRET);

        res.status(200).json({
            signature,
            timestamp,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'wnnotcmw',
            apiKey: process.env.CLOUDINARY_API_KEY || '316289158118826',
            folder,
            eager: eagerTransform
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

// 3. Create Reel Meta Record
reelsRouter.post('/create', async (req, res) => {
    try {
        const { creatorId, publicId, secureUrl, duration, caption, tags, audioTrack } = req.body;
        
        const hlsUrl = secureUrl.replace(/\.[^/.]+$/, '.m3u8');
        const thumbnailUrl = secureUrl.replace(/\.[^/.]+$/, '.jpg');

        const newReel = new Reel({
            creatorId,
            cloudinaryPublicId: publicId,
            hlsUrl,
            fallbackMp4Url: secureUrl,
            thumbnailUrl,
            duration: duration || 0,
            caption: caption || '',
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

reelsRouter.post('/:id/comment', async (req, res) => {
    try {
        const { userId, text } = req.body;
        const reel = await Reel.findById(req.params.id);
        if (!reel) return res.status(404).json({ error: 'Reel not found' });

        reel.comments.push({ userId, text });
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

// ==========================================
// --- STORE, ADMIN & CAMPAIGNS SCHEMAS & API ROUTES ---
// ==========================================

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    deliveryFee: { type: Number, default: 0 },
    description: String,
    image: String,
    galleryImages: [String],
    inStock: { type: Boolean, default: true },
    sizes: { type: [String], default: ['S', 'M', 'L', 'XL'] },
    ratings: [Number],
    votes: { type: Number, default: 0 },
    badge: { type: String, default: 'New Arrival' }
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
    } catch(e) { res.status(500).json({ error: err.message }); }
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
        const event = await Event.findOne({ 'attendees.ticketId': ticketId });
        if (!event) {
            return res.status(404).json({ error: 'Invalid Ticket! No matching reservation found.' });
        }

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

const nodemailer = require('nodemailer');
const otpStore = {}; 

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS  
    },
    tls: {
        rejectUnauthorized: false
    }
});

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
