// studio-server.js — Dedicated Hoknex Design & Certificate Studio Server
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.STUDIO_PORT || 5050;
const DATA_FILE = path.join(__dirname, 'hoknex_studio_projects.json');

app.use(cors());
app.use(express.json({ limit: '25mb' })); // Large limit for base64 images/PDFs
app.use(express.static(__dirname));

// Initialize local JSON storage if missing
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ projects: [], certificates: [] }, null, 2));
}

const readDB = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const writeDB = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// 1. Prompt-to-Design Generator Endpoint
// Parses user prompt + format (certificate, poster, banner, thumbnail) into structured design parameters
app.post('/api/studio/generate-from-prompt', (req, res) => {
  const { prompt = '', format = 'certificate', recipient = 'Aditya Kumar', org = 'HOKNEX' } = req.body;
  const p = prompt.toLowerCase();

  // Smart theme detection from prompt keywords
  let theme = {
    bg: '#0b0d13',
    accent: '#f5b942',
    secondary: '#1e2436',
    text: '#ffffff',
    subtext: '#a0aec0',
    badge: 'VERIFIED CREDENTIAL'
  };

  if (p.includes('cyber') || p.includes('neon') || p.includes('hack') || p.includes('tech')) {
    theme = { bg: '#050811', accent: '#00f0ff', secondary: '#0f172a', text: '#ffffff', subtext: '#94a3b8', badge: 'TECH & INNOVATION' };
  } else if (p.includes('royal') || p.includes('gold') || p.includes('luxury') || p.includes('award')) {
    theme = { bg: '#0c0a09', accent: '#eab308', secondary: '#1c1917', text: '#fefce8', subtext: '#d6d3d1', badge: 'HONORARY DISTINCTION' };
  } else if (p.includes('minimal') || p.includes('white') || p.includes('clean') || p.includes('corporate')) {
    theme = { bg: '#f8fafc', accent: '#0f172a', secondary: '#e2e8f0', text: '#0f172a', subtext: '#475569', badge: 'OFFICIAL DOCUMENT' };
  } else if (p.includes('crimson') || p.includes('red') || p.includes('youtube') || p.includes('gaming')) {
    theme = { bg: '#11070a', accent: '#ff2a5f', secondary: '#240b12', text: '#ffffff', subtext: '#fda4af', badge: 'FEATURED RELEASE' };
  }

  // Extract title or generate contextual title from prompt
  const cleanTitle = prompt.trim()
    ? prompt.replace(/create|make|generate|a|an|for|certificate|poster|banner|thumbnail/gi, '').trim().toUpperCase()
    : (format === 'certificate' ? 'CERTIFICATE OF ACHIEVEMENT' : 'HOKNEX OFFICIAL SHOWCASE');

  const certId = `HKX-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  res.json({
    success: true,
    format,
    certId,
    theme,
    content: {
      org: org.toUpperCase(),
      headline: cleanTitle.length > 3 ? cleanTitle : (format === 'certificate' ? 'CERTIFICATE OF EXCELLENCE' : 'NEXT-GEN CAMPUS NETWORK'),
      recipient,
      description: prompt || 'Awarded for outstanding contribution, innovation, and leadership within the Hoknex ecosystem.',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    }
  });
});

// 2. Register & Verify Issued Certificate
app.post('/api/studio/issue-certificate', (req, res) => {
  const { certId, recipient, title, issuedBy } = req.body;
  const db = readDB();
  const record = {
    certId: certId || `HKX-${Date.now()}`,
    recipient: recipient || 'Participant',
    title: title || 'Hoknex Certificate',
    issuedBy: issuedBy || 'Hoknex Verification Authority',
    issuedAt: new Date().toISOString()
  };
  db.certificates.push(record);
  writeDB(db);
  res.json({ success: true, record });
});

// 3. Verify Certificate Lookup
app.get('/api/studio/verify/:certId', (req, res) => {
  const db = readDB();
  const found = db.certificates.find(c => c.certId.toLowerCase() === req.params.certId.toLowerCase());
  if (!found) return res.status(404).json({ valid: false, message: 'Certificate ID not found.' });
  res.json({ valid: true, record: found });
});

// 4. Save & Load Canvas JSON Projects
app.post('/api/studio/projects', (req, res) => {
  const { name, format, canvasJSON, previewDataUrl } = req.body;
  const db = readDB();
  const project = {
    id: crypto.randomUUID(),
    name: name || 'Untitled Hoknex Design',
    format,
    canvasJSON,
    previewDataUrl,
    updatedAt: new Date().toISOString()
  };
  db.projects.unshift(project);
  writeDB(db);
  res.json({ success: true, project });
});

app.get('/api/studio/projects', (req, res) => {
  const db = readDB();
  res.json({ projects: db.projects.slice(0, 20) });
});

app.listen(PORT, () => {
  console.log(`Hoknex Studio Server running at http://localhost:${PORT}/studio.html`);
});
