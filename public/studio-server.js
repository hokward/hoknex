// studio-server.js — Hoknex Studio Public Credential, Batch & Project Server
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || process.env.STUDIO_PORT || 5050;
const DB_FILE = path.join(__dirname, 'hoknex_studio_db.json');

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({ certificates: [], bulkBatches: [], projects: [] }, null, 2)
  );
}

const readDB = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      certificates: Array.isArray(raw.certificates) ? raw.certificates : [],
      bulkBatches: Array.isArray(raw.bulkBatches) ? raw.bulkBatches : [],
      projects: Array.isArray(raw.projects) ? raw.projects : []
    };
  } catch {
    return { certificates: [], bulkBatches: [], projects: [] };
  }
};

const writeDB = (data) => {
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DB_FILE);
};

const makeCertId = () => `HKX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const makeCertPass = () => `P-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const buildPublicQrUrl = (req, certId) => {
  const baseUrl =
    process.env.STUDIO_PUBLIC_URL ||
    `${req.protocol}://${req.get('host')}/studio.html`;
  return `${baseUrl}?id=${encodeURIComponent(certId)}`;
};

app.get('/api/studio/health', (req, res) => {
  const db = readDB();
  res.json({
    ok: true,
    brand: 'Hoknex Studio',
    certificatesCount: db.certificates.length,
    projectsCount: db.projects.length
  });
});

// Save or Update Single Certificate
app.post('/api/studio/certificates/save', (req, res) => {
  const {
    certId,
    password,
    recipient = 'Hoknex Member',
    title = 'HOKNEX CERTIFICATE OF ACHIEVEMENT',
    description = 'Awarded for distinguished achievement within Hoknex.',
    issuer = 'Hoknex',
    format = 'certificate',
    themeKey = 'gallery',
    date = null,
    logo = null,
    signature = null,
    backgroundImage = null,
    qrUrl = null
  } = req.body;

  const cleanId = String(certId || makeCertId()).trim().toUpperCase();
  const finalPass = String(password || makeCertPass()).trim();
  const resolvedQrUrl = qrUrl || buildPublicQrUrl(req, cleanId);

  const db = readDB();
  const record = {
    certId: cleanId,
    password: finalPass,
    qrUrl: resolvedQrUrl,
    recipient: String(recipient).trim(),
    title: String(title).trim(),
    description: String(description).trim(),
    issuer: String(issuer).trim() || 'Hoknex',
    format,
    themeKey,
    date:
      date ||
      new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
    logo,
    signature,
    backgroundImage,
    updatedAt: new Date().toISOString()
  };

  const existingIdx = db.certificates.findIndex((c) => c.certId.toUpperCase() === cleanId);
  if (existingIdx >= 0) {
    db.certificates[existingIdx] = { ...db.certificates[existingIdx], ...record };
  } else {
    db.certificates.push({ ...record, createdAt: new Date().toISOString() });
  }

  writeDB(db);
  res.json({ success: true, certId: cleanId, password: finalPass, qrUrl: resolvedQrUrl });
});

// Save Bulk Certificate Batch
app.post('/api/studio/certificates/bulk', (req, res) => {
  const {
    certificates = [],
    batchName = 'Hoknex Bulk Batch',
    themeKey = 'gallery',
    backgroundImage = null,
    logo = null,
    signature = null,
    issuer = 'Hoknex'
  } = req.body;

  if (!Array.isArray(certificates) || certificates.length === 0) {
    return res.status(400).json({ error: 'certificates array is required.' });
  }

  const db = readDB();
  const batchId = `BATCH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const saved = certificates.map((item, idx) => {
    const certId = String(
      item.certId ||
        `HKX-${String(idx + 1).padStart(3, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    )
      .trim()
      .toUpperCase();
    const password = String(item.password || makeCertPass()).trim();
    const resolvedQrUrl = item.qrUrl || buildPublicQrUrl(req, certId);

    const certRecord = {
      certId,
      batchId,
      password,
      qrUrl: resolvedQrUrl,
      recipient: String(item.recipient || `Recipient #${idx + 1}`).trim(),
      title: String(item.title || 'HOKNEX VERIFIED CREDENTIAL').trim(),
      description: String(
        item.description ||
          `Officially awarded to ${item.recipient || `Recipient #${idx + 1}`} by ${issuer}.`
      ).trim(),
      issuer: String(item.issuer || issuer || 'Hoknex').trim(),
      format: 'certificate',
      themeKey: item.themeKey || themeKey,
      date: item.date || date,
      logo: item.logo || logo || null,
      signature: item.signature || signature || null,
      backgroundImage: item.backgroundImage || backgroundImage || null,
      createdAt: new Date().toISOString()
    };

    const existingIdx = db.certificates.findIndex((c) => c.certId.toUpperCase() === certId);
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
      qrUrl: resolvedQrUrl
    };
  });

  db.bulkBatches.unshift({
    batchId,
    batchName,
    count: saved.length,
    createdAt: new Date().toISOString()
  });

  writeDB(db);
  res.json({ success: true, batchId, count: saved.length, certificates: saved });
});

// Password-Protected Certificate Unlock
app.post('/api/studio/certificates/unlock', (req, res) => {
  const { certId, password } = req.body;
  if (!certId || !password) {
    return res.status(400).json({ valid: false, error: 'Credential ID and password are required.' });
  }

  const db = readDB();
  const cleanId = String(certId).trim().toUpperCase();
  const cleanPass = String(password).trim();

  const found = db.certificates.find(
    (c) =>
      c.certId.trim().toUpperCase() === cleanId &&
      (String(c.password).trim() === cleanPass ||
        String(c.password).trim().toLowerCase() === cleanPass.toLowerCase())
  );

  if (!found) {
    return res.status(401).json({ valid: false, error: 'Invalid Credential ID or Password.' });
  }

  const { password: _, ...safeCert } = found;
  res.json({ valid: true, certificate: safeCert });
});

// Saved Studio Projects
app.post('/api/studio/projects', (req, res) => {
  const { name, format, themeKey, canvasJSON } = req.body;
  const db = readDB();
  const project = {
    id: crypto.randomUUID(),
    name: name || 'Hoknex Studio Project',
    format: format || 'certificate',
    themeKey: themeKey || 'gallery',
    canvasJSON,
    updatedAt: new Date().toISOString()
  };
  db.projects.unshift(project);
  writeDB(db);
  res.json({ success: true, project });
});

app.get('/api/studio/projects', (req, res) => {
  const db = readDB();
  res.json({ projects: db.projects.slice(0, 30) });
});

app.patch('/api/studio/projects/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!id || !name || !String(name).trim()) {
    return res.status(400).json({ success: false, error: 'Valid project ID and name are required.' });
  }
  const db = readDB();
  const proj = db.projects.find((p) => String(p.id) === String(id));
  if (!proj) {
    return res.status(404).json({ success: false, error: 'Project not found.' });
  }
  proj.name = String(name).trim();
  proj.updatedAt = new Date().toISOString();
  writeDB(db);
  res.json({ success: true, project: proj });
});

app.delete('/api/studio/projects/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const before = db.projects.length;
  db.projects = db.projects.filter((p) => String(p.id) !== String(id));
  if (db.projects.length === before) {
    return res.status(404).json({ success: false, error: 'Project not found.' });
  }
  writeDB(db);
  res.json({ success: true, deletedId: id });
});

app.listen(PORT, () => {
  console.log(`Hoknex Studio Server running on port ${PORT}`);
});
