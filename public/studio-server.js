// studio-server.js — Hoknex Studio Backend Server
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
    JSON.stringify({ users: [], certificates: [], bulkBatches: [], projects: [] }, null, 2)
  );
}

const readDB = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      users: Array.isArray(raw.users) ? raw.users : [],
      certificates: Array.isArray(raw.certificates) ? raw.certificates : [],
      bulkBatches: Array.isArray(raw.bulkBatches) ? raw.bulkBatches : [],
      projects: Array.isArray(raw.projects) ? raw.projects : []
    };
  } catch {
    return { users: [], certificates: [], bulkBatches: [], projects: [] };
  }
};

const writeDB = (data) => {
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DB_FILE);
};

const hashPassword = (pw) => crypto.createHash('sha256').update(String(pw)).digest('hex');
const makeToken = () => crypto.randomBytes(24).toString('hex');

app.get('/api/studio/health', (req, res) => {
  const db = readDB();
  res.json({ ok: true, brand: 'Hoknex Studio', certificatesCount: db.certificates.length });
});

app.post('/api/studio/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || String(password).length < 4) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  const db = readDB();
  const normEmail = String(email).trim().toLowerCase();
  if (db.users.some((u) => u.email.toLowerCase() === normEmail)) {
    return res.status(409).json({ error: 'Account already exists.' });
  }
  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: normEmail,
    passwordHash: hashPassword(password),
    token: makeToken(),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeDB(db);
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, token: user.token } });
});

app.post('/api/studio/auth/signin', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const normEmail = String(email || '').trim().toLowerCase();
  const user = db.users.find(
    (u) => u.email.toLowerCase() === normEmail && u.passwordHash === hashPassword(password || '')
  );
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
  user.token = makeToken();
  writeDB(db);
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, token: user.token } });
});

app.delete('/api/studio/auth/delete-account', (req, res) => {
  const { email, password, token } = req.body;
  const db = readDB();
  const idx = db.users.findIndex((u) => {
    if (token && u.token === token) return true;
    if (email && password) {
      return (
        u.email.toLowerCase() === String(email).trim().toLowerCase() &&
        u.passwordHash === hashPassword(password)
      );
    }
    return false;
  });
  if (idx === -1) return res.status(401).json({ error: 'Account could not be verified.' });
  const removed = db.users[idx];
  db.users.splice(idx, 1);
  db.projects = db.projects.filter((p) => p.ownerId !== removed.id);
  writeDB(db);
  res.json({ success: true });
});

app.post('/api/studio/certificates/unlock', (req, res) => {
  const { certId, password } = req.body;
  const db = readDB();
  const cleanId = String(certId || '').trim().toUpperCase();
  const cleanPass = String(password || '').trim();
  const found = db.certificates.find(
    (c) =>
      c.certId.trim().toUpperCase() === cleanId &&
      (String(c.password).trim() === cleanPass ||
        String(c.password).trim().toLowerCase() === cleanPass.toLowerCase())
  );
  if (!found) return res.status(401).json({ valid: false, error: 'Invalid Credential ID or Password.' });
  const { password: _, ...safeCert } = found;
  res.json({ valid: true, certificate: safeCert });
});

app.listen(PORT, () => {
  console.log(`Hoknex Studio Server running on port ${PORT}`);
});
