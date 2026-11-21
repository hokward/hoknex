// studio-server.js — Dedicated Hoknex AI Studio, Bulk & Protected Certificate Server
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.STUDIO_PORT || 5050;
const DATA_FILE = path.join(__dirname, 'hoknex_studio_db.json');

app.use(cors());
app.use(express.json({ limit: '35mb' }));
app.use(express.static(__dirname));

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ projects: [], certificates: [], bulkBatches: [] }, null, 2)
  );
}

const readDB = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      projects: Array.isArray(raw.projects) ? raw.projects : [],
      certificates: Array.isArray(raw.certificates) ? raw.certificates : [],
      bulkBatches: Array.isArray(raw.bulkBatches) ? raw.bulkBatches : []
    };
  } catch {
    return { projects: [], certificates: [], bulkBatches: [] };
  }
};

// Atomic write to prevent JSON corruption during bulk saves
const writeDB = (data) => {
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
};

const THEMES = {
  gallery: {
    bg: '#FAF9F6',
    surface: '#FFFFFF',
    ink: '#18181B',
    muted: '#71717A',
    accent: '#2563EB',
    secondary: '#0D9488',
    badge: 'GALLERY MINIMAL'
  },
  editorial: {
    bg: '#111111',
    surface: '#1E1E1E',
    ink: '#F4F4F5',
    muted: '#A1A1AA',
    accent: '#F59E0B',
    secondary: '#A855F7',
    badge: 'EDITORIAL DARK'
  },
  tactile: {
    bg: '#FBF7F2',
    surface: '#FFFFFF',
    ink: '#27221F',
    muted: '#6B5E55',
    accent: '#B45309',
    secondary: '#A3B18A',
    badge: 'WARM & TACTILE'
  }
};

const generateUniquePassword = (prefix = 'HKX-') =>
  `${prefix}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const buildShareLink = (req, certId) => {
  const baseUrl =
    process.env.STUDIO_PUBLIC_URL ||
    `${req.protocol}://${req.get('host')}/studio.html`;
  return `${baseUrl}?certId=${encodeURIComponent(certId)}`;
};

// 1. AI Prompt-to-Design Generator (now also issues a unique password & share/QR link)
app.post('/api/studio/generate-from-prompt', (req, res) => {
  const {
    prompt = '',
    format = 'certificate',
    recipient = 'Aditya Kumar',
    themeKey = 'gallery',
    passwordPrefix = 'HKX-'
  } = req.body;
  const p = prompt.toLowerCase();

  let selectedKey = themeKey;
  if (p.includes('dark') || p.includes('editorial') || p.includes('neon') || p.includes('video')) {
    selectedKey = 'editorial';
  } else if (p.includes('warm') || p.includes('tactile') || p.includes('craft') || p.includes('cream')) {
    selectedKey = 'tactile';
  } else if (p.includes('minimal') || p.includes('gallery') || p.includes('clean')) {
    selectedKey = 'gallery';
  }

  const theme = THEMES[selectedKey] || THEMES.gallery;
  const cleanTitle = prompt
    .replace(/create|make|generate|a|an|for|certificate|poster|banner|thumbnail|dark|minimal|warm/gi, '')
    .trim()
    .toUpperCase();

  const certId = `HKX-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const password = generateUniquePassword(passwordPrefix);
  const shareLink = buildShareLink(req, certId);
  const headline = cleanTitle.length > 3 ? cleanTitle : 'CERTIFICATE OF EXCELLENCE';
  const description =
    prompt ||
    'Awarded for outstanding contribution, innovation, and leadership within the Hoknex global campus ecosystem.';
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const record = {
    certId,
    password,
    shareLink,
    recipient,
    title: headline,
    description,
    format,
    themeKey: selectedKey,
    date,
    createdAt: new Date().toISOString()
  };

  const db = readDB();
  db.certificates.push(record);
  writeDB(db);

  res.json({
    success: true,
    format,
    certId,
    password,
    shareLink,
    qrPayload: shareLink,
    theme,
    content: {
      headline,
      recipient,
      description,
      date
    }
  });
});

// 2. Save or Upsert Single Certificate (with password, QR link, optional logo/signature)
app.post('/api/studio/certificates/save', (req, res) => {
  const {
    certId,
    password,
    recipient = 'Participant',
    title = 'HOKNEX CERTIFICATE',
    description = '',
    format = 'certificate',
    themeKey = 'gallery',
    logo = null,
    signature = null
  } = req.body;

  if (!certId) {
    return res.status(400).json({ success: false, error: 'certId is required' });
  }

  const db = readDB();
  const finalPassword = password || generateUniquePassword('HKX-');
  const shareLink = buildShareLink(req, certId);

  const existingIdx = db.certificates.findIndex(
    (c) => c.certId.toLowerCase() === String(certId).toLowerCase()
  );

  const record = {
    certId,
    password: finalPassword,
    shareLink,
    recipient,
    title,
    description,
    format,
    themeKey,
    logo,
    signature,
    date: new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    db.certificates[existingIdx] = { ...db.certificates[existingIdx], ...record };
  } else {
    db.certificates.push({ ...record, createdAt: new Date().toISOString() });
  }

  writeDB(db);
  res.json({ success: true, certId, password: finalPassword, shareLink, qrPayload: shareLink });
});

// 3. Save Bulk Certificate Batch (each certificate keeps its own password & share/QR URL)
app.post('/api/studio/certificates/bulk', (req, res) => {
  const { certificates = [], batchName = 'Hoknex Bulk Batch', themeKey = 'gallery' } = req.body;

  if (!Array.isArray(certificates) || certificates.length === 0) {
    return res.status(400).json({ success: false, error: 'certificates array is required' });
  }

  const db = readDB();
  const batchId = `BATCH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const savedItems = certificates.map((item, idx) => {
    const certId =
      item.certId ||
      `HKX-${new Date().getFullYear()}-${String(idx + 1).padStart(3, '0')}-${crypto
        .randomBytes(2)
        .toString('hex')
        .toUpperCase()}`;
    const password = item.password || generateUniquePassword('HKX-');
    const shareLink = buildShareLink(req, certId);

    const certRecord = {
      certId,
      batchId,
      password,
      shareLink,
      recipient: item.recipient || `Recipient #${idx + 1}`,
      title: item.title || 'HOKNEX VERIFIED CREDENTIAL',
      description:
        item.description ||
        `Officially issued credential for ${item.recipient || `Recipient #${idx + 1}`}.`,
      format: 'certificate',
      themeKey: item.themeKey || themeKey,
      logo: item.logo || null,
      signature: item.signature || null,
      date,
      createdAt: new Date().toISOString()
    };

    const existingIdx = db.certificates.findIndex(
      (c) => c.certId.toLowerCase() === certId.toLowerCase()
    );
    if (existingIdx >= 0) {
      db.certificates[existingIdx] = { ...db.certificates[existingIdx], ...certRecord };
    } else {
      db.certificates.push(certRecord);
    }

    return {
      certId,
      password,
      recipient: certRecord.recipient,
      title: certRecord.title,
      shareLink,
      qrPayload: shareLink
    };
  });

  db.bulkBatches.unshift({
    batchId,
    batchName,
    count: savedItems.length,
    createdAt: new Date().toISOString()
  });

  writeDB(db);
  res.json({ success: true, batchId, count: savedItems.length, certificates: savedItems });
});

// 4. Password-Protected Unlock (used when opening shared link or scanning QR in any browser)
app.post('/api/studio/certificates/unlock', (req, res) => {
  const { certId, password } = req.body;
  if (!certId || !password) {
    return res.status(400).json({ valid: false, error: 'Certificate ID and password are required' });
  }

  const db = readDB();
  const found = db.certificates.find(
    (c) =>
      c.certId.toLowerCase() === String(certId).trim().toLowerCase() &&
      String(c.password) === String(password).trim()
  );

  if (!found) {
    return res.status(401).json({ valid: false, error: 'Invalid Certificate ID or Password' });
  }

  const { password: _, ...safeCertificate } = found;
  res.json({ valid: true, certificate: safeCertificate });
});

// 5. Public Metadata Lookup by Cert ID (never exposes the password)
app.get('/api/studio/verify/:certId', (req, res) => {
  const db = readDB();
  const cert = db.certificates.find(
    (c) => c.certId.toLowerCase() === req.params.certId.toLowerCase()
  );
  if (!cert) {
    return res.status(404).json({ valid: false, message: 'Certificate ID not found' });
  }
  const { password: _, ...publicCert } = cert;
  res.json({ valid: true, passwordRequired: true, cert: publicCert });
});

// 6. Save Studio Canvas Project
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
