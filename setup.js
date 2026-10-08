const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building Hoknex project structure...');

// 1. Create directories
fs.mkdirSync(path.join(__dirname, 'models'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });

// 2. Initialize package.json if it doesn't exist
if (!fs.existsSync('package.json')) {
    execSync('npm init -y', { stdio: 'inherit' });
}

// 3. Install dependencies
console.log('Installing dependencies (express, mongoose, cors, dotenv)...');
execSync('npm install express mongoose cors dotenv bcryptjs jsonwebtoken', { stdio: 'inherit' });

// 4. Create .env
fs.writeFileSync('.env', `PORT=5000\nMONGO_URI=your_mongodb_connection_string_here\nJWT_SECRET=hoknex_secure_secret_key_2026\n`);

// 5. Create server.js
fs.writeFileSync('server.js', `const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB Connected Successfully to Hoknex DB'))
.catch(err => console.error('MongoDB connection error:', err));

const PostSchema = new mongoose.Schema({
  content: String,
  createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

app.get('/api/health', (req, res) => {
  res.json({ status: 'Hoknex Server is running live!' });
});

app.post('/api/posts', async (req, res) => {
  try {
    const newPost = new Post(req.body);
    await newPost.save();
    res.status(201).json(newPost);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(\`Hoknex server running on port \${PORT}\`));
`);

// 6. Create public/index.html
fs.writeFileSync('public/index.html', `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Hoknex - Sign In</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="landing-container">
        <div class="brand-side">
            <div class="logo-box">H</div>
            <h1>People make <span class="highlight">Hoknex</span> matter.</h1>
            <p>Find collaborators, start communities, and share what you know.</p>
        </div>
        <div class="auth-side">
            <h2>Come on in.</h2>
            <form action="feed.html">
                <label>Username or email</label>
                <input type="text" placeholder="your.name" required>
                <label>Password</label>
                <input type="password" placeholder="Your password" required>
                <button type="submit" class="btn-primary">Sign in</button>
            </form>
        </div>
    </div>
</body>
</html>
`);

// 7. Create public/feed.html
fs.writeFileSync('public/feed.html', `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Hoknex - Campus Feed</title>
    <link rel="stylesheet" href="style.css">
</head>
<body class="dashboard-body">
    <aside class="sidebar">
        <div class="sidebar-logo"><span class="logo-badge">H</span> <strong>Hoknex</strong></div>
        <nav>
            <a href="#" class="active">Live feed</a>
            <a href="#">Find people</a>
            <a href="#">Discover</a>
            <a href="#">Projects</a>
            <a href="#">Clubs</a>
            <a href="#">Events</a>
            <a href="#">Notices</a>
            <a href="#">Lost & Found</a>
        </nav>
    </aside>
    <main class="main-content">
        <header class="topbar">
            <h2>Campus feed</h2>
            <input type="text" placeholder="Search campus..." class="search-bar">
        </header>
        <section class="feed-container">
            <div class="post-box">
                <textarea placeholder="Share an idea, question, or campus update..."></textarea>
                <button class="btn-primary">Publish now</button>
            </div>
        </section>
    </main>
</body>
</html>
`);

// 8. Create public/style.css
fs.writeFileSync('public/style.css', `* { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
body { background-color: #f7f6f2; color: #1a1a1a; }
.landing-container { display: flex; height: 100vh; width: 100vw; }
.brand-side { flex: 1; padding: 4rem; background: #fff; display: flex; flex-direction: column; justify-content: center; border-right: 1px solid #e5e3dc; }
.auth-side { flex: 1; padding: 4rem; display: flex; flex-direction: column; justify-content: center; max-width: 500px; }
.logo-box { background: #eab308; color: #fff; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font-weight: bold; border-radius: 8px; margin-bottom: 2rem; }
h1 { font-size: 3.5rem; line-height: 1.1; margin-bottom: 1.5rem; font-family: serif; }
.highlight { color: #2563eb; }
form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1.5rem; }
input, textarea { padding: 0.75rem; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; width: 100%; }
.btn-primary { background: #2563eb; color: #fff; padding: 0.75rem; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
.dashboard-body { display: flex; height: 100vh; overflow: hidden; }
.sidebar { width: 260px; background: #fff; border-right: 1px solid #e5e3dc; display: flex; flex-direction: column; padding: 1.5rem; }
.sidebar-logo { display: flex; align-items: center; gap: 10px; font-size: 1.2rem; margin-bottom: 2rem; }
.logo-badge { background: #eab308; color: #fff; padding: 4px 10px; border-radius: 4px; font-weight: bold; }
.sidebar nav { display: flex; flex-direction: column; gap: 0.5rem; }
.sidebar nav a { text-decoration: none; color: #4b5563; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 500; }
.sidebar nav a.active, .sidebar nav a:hover { background: #f3f4f6; color: #111827; }
.main-content { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
.topbar { padding: 1.5rem 2rem; border-bottom: 1px solid #e5e3dc; display: flex; justify-content: space-between; align-items: center; background: #fff; }
.search-bar { width: 300px; padding: 0.5rem 1rem; border-radius: 20px; border: 1px solid #d1d5db; }
.feed-container { padding: 2rem; max-width: 800px; margin: 0 auto; width: 100%; }
.post-box { background: #fff; padding: 1.5rem; border-radius: 10px; border: 1px solid #e5e3dc; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
`);

console.log('Hoknex project generated successfully via setup script!');