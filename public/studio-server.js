// studio-server.js — Dedicated Hoknex AI Studio & Certificate Server
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.STUDIO_PORT || 5050;
const DATA_FILE = path.join(__dirname, 'hoknex_studio_db.json');

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(__dirname));

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ projects: [], certificates: [] }, null, 2));
}

const readDB = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const writeDB = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

const THEMES = {
  gallery:   { bg: '#FAF9F6', surface: '#FFFFFF', ink: '#18181B', muted: '#71717A', accent: '#2563EB', secondary: '#0D9488', badge: 'GALLERY MINIMAL' },
  editorial: { bg: '#111111', surface: '#1E1E1E', ink: '#F4F4F5', muted: '#A1A1AA', accent: '#F59E0B', secondary: '#A855F7', badge: 'EDITORIAL DARK' },
  tactile:   { bg: '#FBF7F2', surface: '#FFFFFF', ink: '#27221F', muted: '#6B5E55', accent: '#B45309', secondary: '#A3B18A', badge: 'WARM & TACTILE' }
};

// AI Prompt-to-Design Generator
app.post('/api/studio/generate-from-prompt', (req, res) => {
  const { prompt = '', format = 'certificate', recipient = 'Aditya Kumar', themeKey = 'gallery' } = req.body;
  const p = prompt.toLowerCase();

  // Auto-detect palette if mentioned in prompt, otherwise respect active 60-30-10 UI theme
  let selectedKey = themeKey;
  if (p.includes('dark') || p.includes('editorial') || p.includes('neon') || p.includes('video')) selectedKey = 'editorial';
  else if (p.includes('warm') || p.includes('tactile') || p.includes('craft') || p.includes('cream')) selectedKey = 'tactile';
  else if (p.includes('minimal') || p.includes('gallery') || p.includes('clean')) selectedKey = 'gallery';

  const theme = THEMES[selectedKey] || THEMES.gallery;
  const cleanTitle = prompt
    .replace(/create|make|generate|a|an|for|certificate|poster|banner|thumbnail|dark|minimal|warm/gi, '')
    .trim()
    .toUpperCase();

  const certId = `HKX-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const record = {
    certId,
    recipient,
    title: cleanTitle.length > 3 ? cleanTitle : 'CERTIFICATE OF EXCELLENCE',
    format,
    createdAt: new Date().toISOString()
  };

  const db = readDB();
  db.certificates.push(record);
  writeDB(db);

  res.json({
    success: true,
    format,
    certId,
    theme,
    content: {
      headline: record.title,
      recipient,
      description: prompt || 'Awarded for outstanding contribution, innovation, and leadership within the Hoknex global campus ecosystem.',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    }
  });
});

// Verify Certificate ID
app.get('/api/studio/verify/:certId', (req, res) => {
  const db = readDB();
  const cert = db.certificates.find(c => c.certId.toLowerCase() === req.params.certId.toLowerCase());
  if (!cert) return res.status(404).json({ valid: false, message: 'Certificate ID not found' });
  res.json({ valid: true, cert });
});

// Save Studio Canvas Project
app.post('/api/studio/projects', (req, res) => {
  const { name, format, theme, canvasJSON } = req.body;
  const db = readDB();
  const project = {
    id: crypto.randomUUID(),
    name: name || 'Untitled Hoknex Design',
    format,
    theme,
    canvasJSON,
    updatedAt: new Date().toISOString()
  };
  db.projects.unshift(project);
  writeDB(db);
  res.json({ success: true, project });
});

app.get('/api/studio/projects', (req, res) => {
  const db = readDB();
  res.json({ projects: db.projects.slice(0, 25) });
});

app.listen(PORT, () => {
  console.log(`Hoknex Studio Server running on http://localhost:${PORT}/studio.html`);
});
