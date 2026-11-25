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
app.use(express.json({ limit: '50mb' }));
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

const writeDB = (data) => {
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
};

const generateUniquePassword = (prefix = 'HKX-') =>
  `${prefix}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const buildShareLink = (req, certId) => {
  const baseUrl =
    process.env.STUDIO_PUBLIC_URL ||
    `${req.protocol}://${req.get('host')}/studio.html`;
  return `${baseUrl}?certId=${encodeURIComponent(certId)}`;
};

// Health check
app.get('/api/studio/health', (req, res) => {
  const db = readDB();
  res.json({ ok: true, certificatesCount: db.certificates.length });
});

// 1. Save or Upsert Single Certificate (preserves backgroundImage, logo, signature, password)
app.post('/api/studio/certificates/save', (req, res) => {
  const {
    certId,
    password,
    recipient = 'Participant',
    title = 'HOKNEX CERTIFICATE',
    description = '',
    issuer = 'Hoknex Global Network',
    format = 'certificate',
    themeKey = 'gallery',
    logo = null,
    signature = null,
    backgroundImage = null,
    date = null
  } = req.body;

  if (!certId) {
    return res.status(400).json({ success: false, error: 'certId is required' });
  }

  const db = readDB();
  const cleanId = String(certId).trim();
  const finalPassword = String(password || generateUniquePassword('HKX-')).trim();
  const shareLink = buildShareLink(req, cleanId);

  const existingIdx = db.certificates.findIndex(
    (c) => c.certId.toLowerCase() === cleanId.toLowerCase()
  );

  const record = {
    certId: cleanId,
    password: finalPassword,
    shareLink,
    recipient,
    title,
    description,
    issuer,
    format,
    themeKey,
    logo,
    signature,
    backgroundImage,
    date:
      date ||
      new Date().toLocaleDateString('en-US', {
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
  res.json({ success: true, certId: cleanId, password: finalPassword, shareLink });
});

// 2. Save Bulk Certificate Batch
app.post('/api/studio/certificates/bulk', (req, res) => {
  const {
    certificates = [],
    batchName = 'Hoknex Bulk Batch',
    themeKey = 'gallery',
    backgroundImage = null,
    logo = null,
    signature = null
  } = req.body;

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
    const certId = String(
      item.certId ||
        `HKX-${new Date().getFullYear()}-${String(idx + 1).padStart(3, '0')}-${crypto
          .randomBytes(2)
          .toString('hex')
          .toUpperCase()}`
    ).trim();
    const password = String(item.password || generateUniquePassword('HKX-')).trim();
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
      issuer: item.issuer || 'Hoknex Global Network',
      format: 'certificate',
      themeKey: item.themeKey || themeKey,
      logo: item.logo || logo || null,
      signature: item.signature || signature || null,
      backgroundImage: item.backgroundImage || backgroundImage || null,
      date: item.date || date,
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
      shareLink
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

// 3. Password-Protected Unlock (case-insensitive password fallback + exact trim match)
app.post('/api/studio/certificates/unlock', (req, res) => {
  const { certId, password } = req.body;
  if (!certId || !password) {
    return res.status(400).json({ valid: false, error: 'Certificate ID and password are required' });
  }

  const db = readDB();
  const cleanId = String(certId).trim().toLowerCase();
  const cleanPass = String(password).trim();

  const found = db.certificates.find(
    (c) =>
      c.certId.trim().toLowerCase() === cleanId &&
      (String(c.password).trim() === cleanPass ||
        String(c.password).trim().toLowerCase() === cleanPass.toLowerCase())
  );

  if (!found) {
    return res.status(401).json({ valid: false, error: 'Invalid Certificate ID or Password' });
  }

  const { password: _, ...safeCertificate } = found;
  res.json({ valid: true, certificate: safeCertificate });
});

// 4. List Issued Certificates (metadata only, passwords masked)
app.get('/api/studio/certificates', (req, res) => {
  const db = readDB();
  const list = db.certificates.slice(-50).reverse().map(({ password, ...rest }) => rest);
  res.json({ certificates: list });
});

app.listen(PORT, () => {
  console.log(`Hoknex Studio Server running on http://localhost:${PORT}/studio.html`);
});
