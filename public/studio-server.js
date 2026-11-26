// studio-server.js — Hoknex Studio Perks, Pro Pass, Admin Portal, Mailer, Library & Project Server
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (_) {
  nodemailer = null;
}

const app = express();
const PORT = process.env.PORT || process.env.STUDIO_PORT || 5050;
const DB_FILE = path.join(__dirname, 'hoknex_studio_db.json');
const ADMIN_STUDIO_KEY = process.env.HOKNEX_ADMIN_KEY || 'HOKNEX-ADMIN-2026';
const STUDIO_FROM_EMAIL = process.env.STUDIO_EMAIL || 'hoknex.in@gmail.com';

const NEW_USER_PERKS = 250;
const DAILY_CLAIM_PERKS = 25;
const ACTION_PERK_COST = 25;
const LOW_PERK_THRESHOLD = 25;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

const defaultDB = () => ({
  users: [],
  certificates: [],
  bulkBatches: [],
  projects: [],
  paymentRequests: [],
  emailLogs: [],
  settings: {
    paymentQrImage: '',
    paymentUpiId: 'hoknex.in@upi',
    paymentNote: 'Scan QR or pay via UPI, then upload your payment screenshot for Studio Admin verification.'
  }
});

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB(), null, 2));
}

const readDB = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const base = defaultDB();
    return {
      users: Array.isArray(raw.users) ? raw.users : [],
      certificates: Array.isArray(raw.certificates) ? raw.certificates : [],
      bulkBatches: Array.isArray(raw.bulkBatches) ? raw.bulkBatches : [],
      projects: Array.isArray(raw.projects) ? raw.projects : [],
      paymentRequests: Array.isArray(raw.paymentRequests) ? raw.paymentRequests : [],
      emailLogs: Array.isArray(raw.emailLogs) ? raw.emailLogs : [],
      settings:
        raw.settings && typeof raw.settings === 'object'
          ? { ...base.settings, ...raw.settings }
          : base.settings
    };
  } catch {
    return defaultDB();
  }
};

const writeDB = (data) => {
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DB_FILE);
};

const hashPassword = (pw) => crypto.createHash('sha256').update(String(pw)).digest('hex');
const makeToken = () => crypto.randomBytes(24).toString('hex');
const makeCertId = () => `HKX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const makeCertPass = () => `P-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

function isAdminRequest(req) {
  const providedKey = String(
    req.headers['x-hoknex-admin-key'] || (req.body && req.body.adminKey) || ''
  ).trim();
  return providedKey.length > 0 && providedKey === ADMIN_STUDIO_KEY;
}

function getSmtpTransport() {
  if (!nodemailer || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: process.env.SMTP_SERVICE || 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendStudioEmail(db, { to, subject, text }) {
  if (!to) return;
  const entry = {
    id: crypto.randomUUID(),
    from: STUDIO_FROM_EMAIL,
    to: String(to).trim().toLowerCase(),
    subject,
    text,
    sentAt: new Date().toISOString(),
    delivery: 'logged'
  };

  const transporter = getSmtpTransport();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Hoknex Studio" <${STUDIO_FROM_EMAIL}>`,
        to: entry.to,
        subject,
        text
      });
      entry.delivery = 'smtp_sent';
    } catch (err) {
      entry.delivery = `smtp_fallback:${err.message}`;
    }
  }

  db.emailLogs.unshift(entry);
  if (db.emailLogs.length > 200) db.emailLogs = db.emailLogs.slice(0, 200);
}

async function checkAndTriggerLowPerkEmail(db, user) {
  if (!user || user.hasProPass) return false;
  const perks = Number(user.perks || 0);
  if (perks <= LOW_PERK_THRESHOLD && !user.lowPerkAlertSent) {
    user.lowPerkAlertSent = true;
    await sendStudioEmail(db, {
      to: user.email,
      subject: 'Hoknex Studio Reminder: Only 25 Perks Left — Join Pro Pass',
      text: `Hi ${user.name},\n\nYou have ${perks} Hoknex Studio Perks remaining. Upgrade to Hoknex Pro Pass to claim unlimited packs and perks.\n\nSupport: ${STUDIO_FROM_EMAIL}`
    });
    return true;
  }
  if (perks > LOW_PERK_THRESHOLD) {
    user.lowPerkAlertSent = false;
  }
  return false;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    dp: user.dp || '',
    token: user.token,
    perks: Number(user.perks ?? NEW_USER_PERKS),
    hasProPass: Boolean(user.hasProPass),
    proPacks: Array.isArray(user.proPacks) ? user.proPacks : [],
    lastDailyClaim: user.lastDailyClaim || '',
    library: Array.isArray(user.library) ? user.library : [],
    createdAt: user.createdAt
  };
}

function findUserFromReq(db, { token, email }) {
  if (token) {
    const byToken = db.users.find((u) => u.token === token);
    if (byToken) return byToken;
  }
  if (email) {
    const norm = String(email).trim().toLowerCase();
    return db.users.find((u) => u.email.toLowerCase() === norm) || null;
  }
  return null;
}

// ============================================================================
// HEALTH & PUBLIC SETTINGS
// ============================================================================
app.get('/api/studio/health', (req, res) => {
  const db = readDB();
  res.json({
    ok: true,
    brand: 'Hoknex Studio',
    supportEmail: STUDIO_FROM_EMAIL,
    usersCount: db.users.length,
    certificatesCount: db.certificates.length,
    projectsCount: db.projects.length,
    pendingPaymentsCount: db.paymentRequests.filter((p) => p.status === 'pending').length
  });
});

app.get('/api/studio/settings', (req, res) => {
  const db = readDB();
  res.json({
    ok: true,
    supportEmail: STUDIO_FROM_EMAIL,
    settings: db.settings
  });
});

// ============================================================================
// AUTHENTICATION, DAILY PERKS, PERK SPEND, PROFILE DP & LIBRARY
// ============================================================================
app.post('/api/studio/auth/signup', async (req, res) => {
  const { name, email, password, dp = '' } = req.body || {};
  if (!name || !email || !password || String(password).length < 4) {
    return res.status(400).json({ error: 'Name, email, and password (min 4 chars) are required.' });
  }

  const db = readDB();
  const normEmail = String(email).trim().toLowerCase();
  if (db.users.some((u) => u.email.toLowerCase() === normEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const nowIso = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: normEmail,
    passwordHash: hashPassword(password),
    dp: typeof dp === 'string' ? dp : '',
    token: makeToken(),
    perks: NEW_USER_PERKS,
    hasProPass: false,
    proPacks: [],
    lastDailyClaim: '',
    lowPerkAlertSent: false,
    library: [
      {
        id: crypto.randomUUID(),
        action: 'Signup Welcome Bonus',
        detail: 'New Hoknex Studio account created',
        perkDelta: `+${NEW_USER_PERKS}`,
        timestamp: nowIso
      }
    ],
    createdAt: nowIso
  };

  db.users.push(user);
  await sendStudioEmail(db, {
    to: user.email,
    subject: 'Welcome to Hoknex Studio — 250 Perks Credited',
    text: `Hi ${user.name},\n\nWelcome to Hoknex Studio! ${NEW_USER_PERKS} Perks have been added to your account.\n\nSupport: ${STUDIO_FROM_EMAIL}`
  });
  writeDB(db);

  res.json({ success: true, user: sanitizeUser(user) });
});

app.post('/api/studio/auth/signin', async (req, res) => {
  const { email, password, autoClaimDaily = false } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = readDB();
  const normEmail = String(email).trim().toLowerCase();
  const user = db.users.find(
    (u) => u.email.toLowerCase() === normEmail && u.passwordHash === hashPassword(password)
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  user.token = makeToken();
  if (typeof user.perks !== 'number') user.perks = NEW_USER_PERKS;
  if (!Array.isArray(user.library)) user.library = [];
  if (!Array.isArray(user.proPacks)) user.proPacks = [];

  const today = new Date().toISOString().slice(0, 10);
  if (autoClaimDaily && user.lastDailyClaim !== today) {
    user.lastDailyClaim = today;
    user.perks += DAILY_CLAIM_PERKS;
    user.library.unshift({
      id: crypto.randomUUID(),
      action: 'Daily Auto Perks',
      detail: `Automatic daily +${DAILY_CLAIM_PERKS} Perks for ${today}`,
      perkDelta: `+${DAILY_CLAIM_PERKS}`,
      timestamp: new Date().toISOString()
    });
    await checkAndTriggerLowPerkEmail(db, user);
  }

  writeDB(db);
  res.json({ success: true, user: sanitizeUser(user) });
});

app.post('/api/studio/user/profile', (req, res) => {
  const { token, email, name, dp } = req.body || {};
  const db = readDB();
  const user = findUserFromReq(db, { token, email });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (typeof name === 'string' && name.trim()) user.name = name.trim();
  if (typeof dp === 'string') user.dp = dp;
  writeDB(db);

  res.json({ success: true, user: sanitizeUser(user) });
});

app.post('/api/studio/perks/claim-daily', async (req, res) => {
  const { token, email } = req.body || {};
  const db = readDB();
  const user = findUserFromReq(db, { token, email });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const today = new Date().toISOString().slice(0, 10);
  if (user.lastDailyClaim === today) {
    return res.status(400).json({ error: 'Daily 25 Perks already claimed today.' });
  }

  user.lastDailyClaim = today;
  user.perks = Number(user.perks || 0) + DAILY_CLAIM_PERKS;
  user.library = user.library || [];
  user.library.unshift({
    id: crypto.randomUUID(),
    action: 'Daily Perks Claim',
    detail: `Daily reward claimed for ${today}`,
    perkDelta: `+${DAILY_CLAIM_PERKS}`,
    timestamp: new Date().toISOString()
  });

  await checkAndTriggerLowPerkEmail(db, user);
  writeDB(db);
  res.json({ success: true, added: DAILY_CLAIM_PERKS, user: sanitizeUser(user) });
});

app.post('/api/studio/perks/consume', async (req, res) => {
  const {
    token,
    email,
    action = 'Studio Edit / Download',
    detail = '',
    packId = '',
    amount = ACTION_PERK_COST
  } = req.body || {};

  const db = readDB();
  const user = findUserFromReq(db, { token, email });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (!Array.isArray(user.library)) user.library = [];
  if (!Array.isArray(user.proPacks)) user.proPacks = [];

  const coveredByPro =
    Boolean(user.hasProPass) &&
    (user.proPacks.includes('all_access') || !packId || user.proPacks.includes(packId));

  const cost = coveredByPro ? 0 : Math.max(0, Number(amount) || ACTION_PERK_COST);
  const currentPerks = Number(user.perks || 0);

  if (!coveredByPro && currentPerks < cost) {
    return res.status(402).json({
      error: `Insufficient perks (${currentPerks} left; ${cost} required). Claim daily perks or join Pro Pass.`,
      perks: currentPerks
    });
  }

  user.perks = currentPerks - cost;
  user.library.unshift({
    id: crypto.randomUUID(),
    action: String(action),
    detail: String(detail || (coveredByPro ? 'Pro Pass Unlimited Access' : `${cost} Perks used`)),
    perkDelta: coveredByPro ? 'PRO FREE' : `-${cost}`,
    timestamp: new Date().toISOString()
  });
  if (user.library.length > 300) user.library = user.library.slice(0, 300);

  const lowAlertSent = await checkAndTriggerLowPerkEmail(db, user);
  writeDB(db);

  res.json({
    success: true,
    charged: cost,
    coveredByPro,
    lowPerksWarning: !coveredByPro && user.perks <= LOW_PERK_THRESHOLD,
    lowAlertSent,
    user: sanitizeUser(user)
  });
});

app.delete('/api/studio/library/item', (req, res) => {
  const { token, email, itemId } = req.body || {};
  const db = readDB();
  const user = findUserFromReq(db, { token, email });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  user.library = (user.library || []).filter((item) => item.id !== itemId);
  writeDB(db);
  res.json({ success: true, user: sanitizeUser(user) });
});

app.delete('/api/studio/library/all', (req, res) => {
  const { token, email } = req.body || {};
  const db = readDB();
  const user = findUserFromReq(db, { token, email });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  user.library = [];
  writeDB(db);
  res.json({ success: true, user: sanitizeUser(user) });
});

app.delete('/api/studio/auth/delete-account', (req, res) => {
  const { email, password, token } = req.body || {};
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

  if (idx === -1) {
    return res.status(401).json({ error: 'Account could not be verified.' });
  }

  const removed = db.users[idx];
  db.users.splice(idx, 1);
  db.projects = db.projects.filter((p) => p.ownerId !== removed.id);
  writeDB(db);

  res.json({ success: true, message: 'Account and saved projects deleted.' });
});

// ============================================================================
// PRO PASS PAYMENT REQUESTS & STUDIO ADMIN PORTAL
// ============================================================================
app.post('/api/studio/pro-pass/submit-payment', async (req, res) => {
  const {
    token,
    userEmail,
    fullName,
    contactPhone = '',
    packs = [],
    amount = 0,
    screenshotData = ''
  } = req.body || {};

  if (!fullName || !userEmail || !Array.isArray(packs) || packs.length === 0 || !screenshotData) {
    return res.status(400).json({
      error: 'Full name, email, at least one pack, and payment screenshot are required.'
    });
  }

  const db = readDB();
  const cleanEmail = String(userEmail).trim().toLowerCase();
  const matchedUser = findUserFromReq(db, { token, email: cleanEmail });

  const requestRecord = {
    id: crypto.randomUUID(),
    userId: matchedUser ? matchedUser.id : null,
    userEmail: cleanEmail,
    fullName: String(fullName).trim(),
    contactPhone: String(contactPhone).trim(),
    packs,
    amount: Number(amount) || 0,
    screenshotData,
    status: 'pending',
    perksGranted: 0,
    submittedAt: new Date().toISOString(),
    reviewedAt: null
  };

  db.paymentRequests.unshift(requestRecord);
  if (matchedUser) {
    matchedUser.library = matchedUser.library || [];
    matchedUser.library.unshift({
      id: crypto.randomUUID(),
      action: 'Pro Pass Payment Submitted',
      detail: `Packs: ${packs.join(', ')} — Awaiting Admin verification`,
      perkDelta: 'PENDING',
      timestamp: new Date().toISOString()
    });
  }

  await sendStudioEmail(db, {
    to: cleanEmail,
    subject: 'Hoknex Studio: Pro Pass Payment Screenshot Received',
    text: `Hi ${fullName},\n\nWe received your Pro Pass payment screenshot for packs (${packs.join(', ')}) and amount ₹${requestRecord.amount}. Studio Admin will verify shortly.\n\nContact: ${STUDIO_FROM_EMAIL}`
  });

  writeDB(db);
  res.json({ success: true, request: requestRecord });
});

app.get('/api/studio/admin/overview', (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ error: 'Unauthorized: Invalid Admin Studio Key.' });
  }
  const db = readDB();
  res.json({
    ok: true,
    supportEmail: STUDIO_FROM_EMAIL,
    settings: db.settings,
    users: db.users.map(sanitizeUser),
    paymentRequests: db.paymentRequests,
    emailLogs: db.emailLogs.slice(0, 50)
  });
});

app.post('/api/studio/admin/qr', (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ error: 'Unauthorized: Invalid Admin Studio Key.' });
  }
  const { paymentQrImage, paymentUpiId, paymentNote } = req.body || {};
  const db = readDB();
  if (typeof paymentQrImage === 'string') db.settings.paymentQrImage = paymentQrImage;
  if (typeof paymentUpiId === 'string') db.settings.paymentUpiId = paymentUpiId.trim();
  if (typeof paymentNote === 'string') db.settings.paymentNote = paymentNote.trim();
  writeDB(db);
  res.json({ success: true, settings: db.settings });
});

app.delete('/api/studio/admin/qr', (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ error: 'Unauthorized: Invalid Admin Studio Key.' });
  }
  const db = readDB();
  db.settings.paymentQrImage = '';
  writeDB(db);
  res.json({ success: true, settings: db.settings });
});

app.post('/api/studio/admin/payment-review', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ error: 'Unauthorized: Invalid Admin Studio Key.' });
  }
  const { requestId, decision, extraPerks = 0 } = req.body || {};
  const db = readDB();
  const reqItem = db.paymentRequests.find((p) => p.id === requestId);
  if (!reqItem) return res.status(404).json({ error: 'Payment request not found.' });

  const user = db.users.find(
    (u) => u.id === reqItem.userId || u.email.toLowerCase() === reqItem.userEmail.toLowerCase()
  );

  if (decision === 'reject') {
    reqItem.status = 'rejected';
    reqItem.reviewedAt = new Date().toISOString();
    await sendStudioEmail(db, {
      to: reqItem.userEmail,
      subject: 'Hoknex Studio: Pro Pass Payment Update',
      text: `Hi ${reqItem.fullName},\n\nYour Pro Pass payment screenshot could not be verified. Please contact ${STUDIO_FROM_EMAIL} or resubmit with a clear payment receipt.`
    });
    writeDB(db);
    return res.json({ success: true, request: reqItem });
  }

  const basePackPerks = reqItem.packs.includes('all_access') ? 1000 : reqItem.packs.length * 300;
  const bonus = Math.max(0, Number(extraPerks) || 0);
  const totalGranted = basePackPerks + bonus;

  reqItem.status = 'approved';
  reqItem.perksGranted = totalGranted;
  reqItem.reviewedAt = new Date().toISOString();

  if (user) {
    user.hasProPass = true;
    const mergedPacks = new Set([...(user.proPacks || []), ...(reqItem.packs || [])]);
    user.proPacks = Array.from(mergedPacks);
    user.perks = Number(user.perks || 0) + totalGranted;
    user.lowPerkAlertSent = false;
    user.library = user.library || [];
    user.library.unshift({
      id: crypto.randomUUID(),
      action: 'Pro Pass Approved',
      detail: `Unlocked [${reqItem.packs.join(', ')}] + ${totalGranted} Perks`,
      perkDelta: `+${totalGranted} PRO`,
      timestamp: new Date().toISOString()
    });
  }

  await sendStudioEmail(db, {
    to: reqItem.userEmail,
    subject: 'Hoknex Studio: Pro Pass Confirmed & Perks Credited!',
    text: `Hi ${reqItem.fullName},\n\nYour payment is verified! Your Hoknex Pro Pass is now active for (${reqItem.packs.join(', ')}) and ${totalGranted} Perks have been credited.\n\nSent from: ${STUDIO_FROM_EMAIL}`
  });

  writeDB(db);
  res.json({ success: true, request: reqItem, user: user ? sanitizeUser(user) : null });
});

app.post('/api/studio/admin/grant-perks', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ error: 'Unauthorized: Invalid Admin Studio Key.' });
  }
  const { userId, email, perksAmount = 100, note = 'Admin Free Perks Grant' } = req.body || {};
  const amount = Number(perksAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Perks amount must be greater than 0.' });
  }

  const db = readDB();
  const user = db.users.find(
    (u) => (userId && u.id === userId) || (email && u.email.toLowerCase() === String(email).trim().toLowerCase())
  );
  if (!user) return res.status(404).json({ error: 'Target user account not found.' });

  user.perks = Number(user.perks || 0) + amount;
  user.lowPerkAlertSent = false;
  user.library = user.library || [];
  user.library.unshift({
    id: crypto.randomUUID(),
    action: 'Admin Perks Sent',
    detail: String(note || 'Free perks sent by Studio Admin'),
    perkDelta: `+${amount}`,
    timestamp: new Date().toISOString()
  });

  await sendStudioEmail(db, {
    to: user.email,
    subject: `Hoknex Studio: +${amount} Free Perks Sent to Your Account`,
    text: `Hi ${user.name},\n\nStudio Admin sent +${amount} Perks to your Hoknex Studio account (${note}). Your current balance is ${user.perks} Perks.\n\nSent from: ${STUDIO_FROM_EMAIL}`
  });

  writeDB(db);
  res.json({ success: true, user: sanitizeUser(user) });
});

// ============================================================================
// SINGLE & BULK CERTIFICATES + PASSWORD-PROTECTED VAULT UNLOCK
// ============================================================================
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
  } = req.body || {};

  const cleanId = String(certId || makeCertId()).trim().toUpperCase();
  const db = readDB();
  const existingIdx = db.certificates.findIndex((c) => c.certId.toUpperCase() === cleanId);

  if (existingIdx >= 0 && !isAdminRequest(req)) {
    return res.status(403).json({
      success: false,
      error: 'Only an authenticated Hoknex Admin can edit an existing certificate.'
    });
  }

  const finalPass = String(
    password || (existingIdx >= 0 ? db.certificates[existingIdx].password : makeCertPass())
  ).trim();

  const record = {
    certId: cleanId,
    password: finalPass,
    qrUrl: qrUrl || (existingIdx >= 0 ? db.certificates[existingIdx].qrUrl : null),
    recipient: String(recipient).trim(),
    title: String(title).trim(),
    description: String(description).trim(),
    issuer: String(issuer).trim() || 'Hoknex',
    format,
    themeKey,
    date:
      date ||
      (existingIdx >= 0 && db.certificates[existingIdx].date) ||
      new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
    logo: logo !== null ? logo : (existingIdx >= 0 ? db.certificates[existingIdx].logo : null),
    signature:
      signature !== null ? signature : (existingIdx >= 0 ? db.certificates[existingIdx].signature : null),
    backgroundImage:
      backgroundImage !== null
        ? backgroundImage
        : (existingIdx >= 0 ? db.certificates[existingIdx].backgroundImage : null),
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    db.certificates[existingIdx] = { ...db.certificates[existingIdx], ...record };
  } else {
    db.certificates.push({ ...record, createdAt: new Date().toISOString() });
  }

  writeDB(db);
  res.json({ success: true, certId: cleanId, password: finalPass, qrUrl: record.qrUrl });
});

app.post('/api/studio/certificates/bulk', (req, res) => {
  const {
    certificates = [],
    batchName = 'Hoknex Bulk Batch',
    themeKey = 'gallery',
    backgroundImage = null,
    logo = null,
    signature = null,
    issuer = 'Hoknex'
  } = req.body || {};

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

    const certRecord = {
      certId,
      batchId,
      password,
      qrUrl: item.qrUrl || null,
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
      qrUrl: certRecord.qrUrl
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

app.post('/api/studio/certificates/unlock', (req, res) => {
  const { certId, password } = req.body || {};
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

// ============================================================================
// STUDIO PROJECTS (CREATE, LIST, RENAME, DELETE)
// ============================================================================
app.post('/api/studio/projects', (req, res) => {
  const { name, format, themeKey, canvasJSON, ownerId = null } = req.body || {};
  const db = readDB();
  const project = {
    id: crypto.randomUUID(),
    ownerId,
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
  const { name } = req.body || {};
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
  console.log(`Hoknex Studio Server running on port ${PORT} (Support: ${STUDIO_FROM_EMAIL})`);
});
