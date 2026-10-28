/* Winning Ranch API, mounted at /api/ranch
   Public:  stalls + availability, booking requests
   Owners:  login, their horses, the photo/video feed from the team
   Staff:   bookings, stalls & prices, horses, people, posting updates */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { createStore } = require('../lib/store');
const { createAuth, rateLimit } = require('../lib/auth');
const { seedStalls, seedDemo, STALL_SIZE } = require('../lib/ranch-seed');
const { MAP, SHAPES, AREAS } = require('../lib/ranch-layout');
const { DOCS, docById, allFields } = require('../lib/docs');
const mailer = require('../lib/mailer');

const IMAGE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif' };
const VIDEO = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp' };
const BOOKING_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'completed'];
const HOLDS = new Set(['pending', 'confirmed']); // these block the stall

module.exports = function ranchRouter({ dataDir }) {
  const store = createStore(path.join(dataDir, 'ranch.json'), {
    stalls: [],
    settings: { parkingNightly: null, monthlyMin: 750, monthlyMax: 1000 },
    bookings: [],
    users: [],
    sessions: [],
    invites: [],
    horses: [],
    updates: [],
    seq: { booking: 1000 },
    contacts: [],
    priceLog: [],
    waivers: [],
    signRequests: [],
    docVersions: {},
    migrations: {},
  });
  const db = store.data;
  const auth = createAuth(store);
  const uploads = path.join(dataDir, 'uploads');
  fs.mkdirSync(path.join(uploads, 'public'), { recursive: true });
  fs.mkdirSync(path.join(uploads, 'private'), { recursive: true });

  // ---------------------------------------------------------- first run
  if (!db.stalls.length) { db.stalls = seedStalls(); store.save(); }

  // ---------------------------------------------------------- one-time data updates for existing installs
  const BARN_PHOTO = '/img/photos/barn-stalls.jpg';
  const migrations = {
    // Shapes now come from lib/ranch-layout.js, not the database
    'layout-from-code': () => db.stalls.forEach((st) => { delete st.shape; }),
    // Stalls are 12' x 24' (the smaller one keeps its own size)
    'stall-size-12x24': () => db.stalls.forEach((st) => { if (!st.size && !st.smaller) st.size = STALL_SIZE; }),
    // Advertised monthly range shown when a stall has no monthly price of its own
    'monthly-range': () => {
      if (db.settings.monthlyMin === undefined) db.settings.monthlyMin = 750;
      if (db.settings.monthlyMax === undefined) db.settings.monthlyMax = 1000;
      delete db.settings.fullCareNightly; // rates now include full care
    },
    // Real photo of the barn stalls on every main-barn stall in use
    // Everything moved from /ranch/... to the root of the site
    'root-paths': () => db.stalls.forEach((st) => st.photos.forEach((ph) => { if (ph.url && ph.url.startsWith('/ranch/')) ph.url = ph.url.slice(6); })),
    // Contact-form messages used to live in the preview tool's file
    'contacts-from-review': () => {
      try {
        const old = JSON.parse(fs.readFileSync(path.join(dataDir, 'review.json'), 'utf8'));
        (old.contacts || []).forEach((c) => { if (!db.contacts.some((x) => x.id === c.id)) db.contacts.push(c); });
      } catch (_) { /* nothing to import */ }
    },
    'barn-photo': () => db.stalls.forEach((st) => {
      if (st.group === 'main' && st.status === 'available' && !st.photos.some((ph) => ph.url === BARN_PHOTO)) {
        st.photos.unshift({ id: crypto.randomBytes(8).toString('hex'), url: BARN_PHOTO, builtIn: true });
      }
    }),
  };
  let migrated = false;
  for (const [name, run] of Object.entries(migrations)) {
    if (!db.migrations[name]) { run(); db.migrations[name] = new Date().toISOString(); migrated = true; }
  }
  if (migrated) store.save();
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail && process.env.ADMIN_PASSWORD && !db.users.some((u) => u.email === adminEmail)) {
    db.users.push({
      id: crypto.randomBytes(8).toString('hex'), name: process.env.ADMIN_NAME || 'Ranch admin', email: adminEmail, phone: '',
      role: 'staff', password: auth.hashPassword(process.env.ADMIN_PASSWORD), active: true, createdAt: new Date().toISOString(),
    });
    store.save();
    console.log('[ranch] staff account created for', adminEmail);
  }
  if (process.env.SEED_DEMO === '1') seedDemo(store, auth, uploads);

  // ---------------------------------------------------------- helpers
  const newId = () => crypto.randomBytes(8).toString('hex');
  const now = () => new Date().toISOString();
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const money = (v) => (v === null || v === '' || v === undefined ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 100) / 100 : undefined);
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const nights = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
  const dayOffset = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const stallById = (id) => db.stalls.find((s) => s.id === id);
  const horseInStall = (stallId) => db.horses.find((h) => h.active !== false && h.stallId === stallId);
  const origin = (req) => `${req.protocol}://${req.get('host')}`;

  function stallBusy(stallId, from, to, ignoreBookingId) {
    return db.bookings.some((b) => b.id !== ignoreBookingId && HOLDS.has(b.status) && b.stallIds.includes(stallId) && b.from < to && from < b.to);
  }

  const photoUrl = (p) => p.url || '/api/ranch/files/' + p.file;

  function publicStall(s, range) {
    let availability = 'available';
    if (s.status !== 'available') availability = 'unavailable';
    else if (horseInStall(s.id)) availability = 'occupied';
    else if (range && stallBusy(s.id, range.from, range.to)) availability = 'booked';
    return {
      id: s.id, group: s.group, number: s.number, name: s.name, shape: SHAPES[s.id] || s.shape || null,
      smaller: !!s.smaller, size: s.size, nightly: s.nightly, monthly: s.monthly, description: s.description,
      photos: s.photos.map((p) => ({ id: p.id, url: photoUrl(p), builtIn: !!p.builtIn })),
      availability,
    };
  }

  function mediaOut(m) {
    return { type: m.type, url: '/api/ranch/media/' + m.file, mime: m.mime };
  }

  function canSeeHorse(user, horse) {
    return !!(user && horse && (user.role === 'staff' || horse.ownerId === user.id));
  }

  function notify(kind, payload) {
    const url = process.env.BOOKING_WEBHOOK_URL || process.env.CONTACT_WEBHOOK_URL;
    if (!url) return;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...payload }) })
      .catch((err) => console.error('[ranch] webhook failed:', err.message));
  }

  // ---------------------------------------------------------- uploads
  function uploader(sub, types, maxMb, maxFiles) {
    return multer({
      storage: multer.diskStorage({
        destination: path.join(uploads, sub),
        filename: (_req, file, cb) => cb(null, newId() + (types[file.mimetype] || '')),
      }),
      limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles },
      fileFilter: (req, file, cb) => {
        const ok = !!types[file.mimetype];
        if (!ok) (req.rejected = req.rejected || []).push(file.originalname);
        cb(null, ok);
      },
    }).array('files', maxFiles);
  }
  const wrapUpload = (mw) => (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'A file is too big. Photos up to 15 MB, videos up to 300 MB.'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Too many files at once.'
        : 'Upload failed: ' + err.message;
    res.status(400).json({ error: msg });
  });
  const mediaUpload = wrapUpload(uploader('private', { ...IMAGE, ...VIDEO }, 300, 10));
  const photoUpload = wrapUpload(uploader('public', IMAGE, 15, 8));
  const removeFile = (sub, file) => fs.promises.unlink(path.join(uploads, sub, path.basename(file))).catch(() => {});

  // ---------------------------------------------------------- router
  const r = express.Router();
  r.use(auth.loadUser);

  // Writes must come from this site (cookies are SameSite=Lax too)
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const o = req.headers.origin;
    if (o) {
      let host = '';
      try { host = new URL(o).host; } catch (_) { /* bad origin */ }
      if (host !== req.headers.host) return res.status(403).json({ error: 'Request blocked.' });
    }
    next();
  });

  r.use('/files', express.static(path.join(uploads, 'public'), { maxAge: '7d', fallthrough: false }));

  // ======================================================== public
  r.get('/stalls', (req, res) => {
    const { from, to } = req.query;
    const range = isDate(from) && isDate(to) && from < to ? { from, to } : null;
    res.json({ stalls: db.stalls.map((s) => publicStall(s, range)), settings: db.settings, range, map: MAP, areas: AREAS });
  });

  r.post('/bookings', rateLimit({ limit: 8, windowMs: 60 * 60e3, message: 'Too many booking requests. Call (305) 409-9656.' }), async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ref: 'WR0000' }); // honeypot
    const stallIds = Array.isArray(b.stallIds) ? [...new Set(b.stallIds.map(String))].slice(0, 10) : [];
    const from = b.from, to = b.to;
    const errors = [];
    if (!stallIds.length) errors.push('Pick at least one stall.');
    if (!isDate(from) || !isDate(to) || from >= to) errors.push('Pick a check-in date before the check-out date.');
    else {
      if (from < dayOffset(-1)) errors.push('Check-in can’t be in the past.');
      if (nights(from, to) > 90) errors.push('Online booking covers up to 90 nights. For longer stays, ask about monthly boarding.');
    }
    const horses = Array.isArray(b.horses) ? b.horses.map((h) => str(h, 80)) : [];
    if (horses.length !== stallIds.length || horses.some((h) => !h)) errors.push('Add a horse name for each stall.');
    const name = str(b.name, 100), email = str(b.email, 160).toLowerCase(), phone = str(b.phone, 40);
    if (!name) errors.push('Add your name.');
    if (!validEmail(email)) errors.push('Add a valid email.');
    if (!phone) errors.push('Add a phone number so we can confirm.');
    if (b.coggins !== true) errors.push('Confirm you’ll bring a full Coggins for each horse.');
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    for (const id of stallIds) {
      const s = stallById(id);
      if (!s) return res.status(400).json({ error: 'One of those stalls doesn’t exist.' });
      const pub = publicStall(s, { from, to });
      if (pub.availability !== 'available') return res.status(409).json({ error: `${s.name} isn’t available for those dates anymore. Pick another stall.`, stallId: id });
    }

    const n = nights(from, to);
    const care = 'full'; // every rate includes full care
    const parking = !!b.parking;
    const stallTotal = stallIds.every((id) => stallById(id).nightly !== null) ? stallIds.reduce((sum, id) => sum + stallById(id).nightly, 0) * n : null;
    const estimate = stallTotal;

    db.seq.booking += 1;
    const booking = {
      id: newId(), ref: 'WR' + db.seq.booking, status: 'pending',
      stallIds, from, to, nights: n, horses, care, parking,
      name, email, phone, notes: str(b.notes, 2000),
      estimate, staffNote: '', createdAt: now(), updatedAt: now(),
    };
    db.bookings.push(booking);
    await store.save();
    notify('booking', { ref: booking.ref, stalls: stallIds.map((id) => stallById(id).name), from, to, nights: n, horses, care, parking, name, email, phone, notes: booking.notes, estimate });
    res.status(201).json({ ref: booking.ref, from, to, nights: n, stalls: stallIds.map((id) => stallById(id).name), estimate });
  });


  // ======================================================== waivers signed online
  const docsDir = path.join(__dirname, '..', 'public', 'docs');
  const docHtml = (id) => { try { return fs.readFileSync(path.join(docsDir, path.basename(id) + '.html'), 'utf8'); } catch (_) { return ''; } };
  const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

  r.get('/docs', (_req, res) => res.json({ docs: DOCS }));

  r.post('/waivers', rateLimit({ limit: 12, windowMs: 60 * 60e3, message: 'Too many signatures from this device. Call (305) 409-9656.' }), async (req, res) => {
    const b = req.body || {};
    const doc = docById(b.docId);
    if (!doc) return res.status(400).json({ error: 'Unknown document.' });
    const input = b.fields && typeof b.fields === 'object' ? b.fields : {};
    const fields = {};
    const errors = [];
    for (const f of allFields(doc)) {
      const shown = !f.showIf || input[f.showIf[0]] === f.showIf[1];
      const v = shown && typeof input[f.key] === 'string' ? input[f.key].trim().slice(0, f.type === 'textarea' ? 2000 : (f.max || 300)) : '';
      if (f.required && shown && !v) { errors.push(`Fill in “${f.label}”.`); continue; }
      if (!v) continue;
      if (f.type === 'email' && !validEmail(v)) errors.push('Check the email address.');
      else if (f.type === 'date' && !isDate(v)) errors.push(`Check the date in “${f.label}”.`);
      else if (f.type === 'choice' && !f.options.includes(v)) errors.push(`Pick an option for “${f.label}”.`);
      else fields[f.key] = v;
    }
    const forMinor = !!(doc.minor && b.minor === true);
    const guardianName = forMinor ? str(b.guardianName, 120) : '';
    if (forMinor && !guardianName) errors.push('Add the parent or guardian’s full name.');
    const signerName = forMinor ? guardianName : fields.name || '';
    const typed = str(b.typedSignature, 120);
    if (!typed) errors.push('Type your full name to sign.');
    else if (signerName && norm(typed) !== norm(signerName)) errors.push(`Type your name exactly as above (${signerName}).`);
    if (b.agree !== true) errors.push('Confirm you read the whole document and agree to it.');
    if (b.esign !== true) errors.push('Agree to sign electronically.');
    const sig = typeof b.signature === 'string' ? b.signature : '';
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > 700000) errors.push('Draw your signature in the box.');
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    // Keep the exact text that was signed, even if the document is edited later
    const html = docHtml(doc.id);
    const version = hashOf(html);
    if (!db.docVersions[version]) db.docVersions[version] = { docId: doc.id, html, firstSignedAt: now() };

    const file = newId() + '.png';
    await fs.promises.writeFile(path.join(uploads, 'private', file), Buffer.from(sig.split(',')[1], 'base64'));
    const key = crypto.randomBytes(24).toString('base64url');
    const w = {
      id: newId(), docId: doc.id, docTitle: doc.title, docVersion: version,
      fields, minor: forMinor, guardianName, signerName, typedSignature: typed,
      signatureFile: file, copyKey: sha(key), userId: req.user ? req.user.id : null,
      signedAt: now(), ip: req.ip, userAgent: str(req.headers['user-agent'], 300),
      countersign: null,
    };
    db.waivers.push(w);
    // Signing fulfills any open request for this document (same account, or same email)
    const signerEmail = String(fields.email || '').toLowerCase();
    const viaLink = typeof b.requestId === 'string' ? b.requestId : '';
    db.signRequests.filter((q) => q.status === 'pending' && q.docId === doc.id
      && (q.id === viaLink || (req.user && q.userId && q.userId === req.user.id)
        || (q.userId ? (db.users.find((u) => u.id === q.userId) || {}).email === signerEmail : q.email === signerEmail)))
      .forEach((q) => { q.status = 'signed'; q.waiverId = w.id; q.signedAt = w.signedAt; });
    await store.save();
    notify('waiver', { doc: doc.title, name: fields.name, signer: signerName, email: fields.email, phone: fields.cell, horse: fields.horseName || '', signedAt: w.signedAt });
    res.status(201).json({ id: w.id, doc: doc.title, signedAt: w.signedAt, copyUrl: `/api/ranch/waivers/${w.id}/copy?k=${key}` });
  });

  // The signed copy: the exact text signed, what they filled in, and the signature
  async function signedCopy(w, { forStaff }) {
    const doc = docById(w.docId);
    const html = (db.docVersions[w.docVersion] || {}).html || docHtml(w.docId);
    let sig = '';
    try { sig = (await fs.promises.readFile(path.join(uploads, 'private', path.basename(w.signatureFile)))).toString('base64'); } catch (_) {}
    const e = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'long', timeStyle: 'short' }) + ' (Las Vegas time)';
    const sections = (doc ? doc.sections : []).map((sec) => {
      const rows = sec.fields.filter((f) => w.fields[f.key]).map((f) => `<tr><th>${e(f.label)}</th><td>${e(w.fields[f.key])}</td></tr>`).join('');
      return rows ? `<h3>${e(sec.title)}</h3><table>${rows}</table>` : '';
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
      <title>${e(w.docTitle)}, ${e(w.fields.name)}</title>
      <style>body{font:15px/1.55 Georgia,serif;color:#111;max-width:780px;margin:0 auto;padding:0 20px 60px}
      .bar{position:sticky;top:0;background:#fff;padding:12px 0;border-bottom:1px solid #ddd;margin-bottom:20px;font-family:Arial,sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      .bar button{font:600 15px Arial,sans-serif;padding:10px 16px;background:#CC232A;color:#fff;border:0;cursor:pointer}
      .box{border:2px solid #111;padding:14px 18px;margin:0 0 26px;font-family:Arial,sans-serif;font-size:14px}
      .box strong{font-size:16px}
      h2{font:700 18px Arial,sans-serif;margin:34px 0 8px;border-top:2px solid #111;padding-top:14px}h3{font:700 15px Arial,sans-serif;margin:18px 0 6px}
      table{border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #ddd;vertical-align:top}th{width:40%;font-weight:normal;color:#555}
      .doc table td,.doc table th{border:1px solid #ccc}.sig img{max-width:340px;border-bottom:1px solid #111;display:block;margin:6px 0 4px}
      @media print{.bar{display:none}h2{page-break-before:auto}.sig{page-break-inside:avoid}}</style></head><body>
      <div class="bar"><button onclick="print()">Print or save as PDF</button><span>Keep a copy for your records.</span></div>
      <div class="box"><strong>${e(w.docTitle)}</strong>, signed electronically by ${e(w.signerName)}${w.minor ? ` (parent or guardian of ${e(w.fields.name)})` : ''} on ${e(when(w.signedAt))}.
        ${w.countersign ? `<br>Countersigned for Winning Ranch by ${e(w.countersign.by)} on ${e(when(w.countersign.at))}.` : forStaff ? '<br>Not countersigned by the ranch yet.' : ''}</div>
      <div class="doc">${html}</div>
      <h2>Information provided</h2>${sections || '<p>None.</p>'}
      <h2>Signature</h2>
      <div class="sig"><table>
        <tr><th>Signed by</th><td>${e(w.signerName)}${w.minor ? `, parent or guardian of ${e(w.fields.name)}` : ''}</td></tr>
        <tr><th>Typed signature</th><td>${e(w.typedSignature)}</td></tr>
        <tr><th>Date and time</th><td>${e(when(w.signedAt))}</td></tr>
        <tr><th>Agreed to</th><td>Read the whole document and agreed to it; agreed to sign electronically</td></tr>
        ${forStaff ? `<tr><th>IP address</th><td>${e(w.ip)}</td></tr><tr><th>Device</th><td>${e(w.userAgent)}</td></tr>` : ''}
        <tr><th>Document version</th><td>${e(w.docVersion)}</td></tr>
      </table>${sig ? `<img alt="Signature of ${e(w.signerName)}" src="data:image/png;base64,${sig}">` : ''}
      ${w.countersign ? `<p>Winning Ranch (Management): ${e(w.countersign.by)}, ${e(when(w.countersign.at))}</p>` : ''}</div>
      </body></html>`;
  }

  r.get('/waivers/:id/copy', async (req, res) => {
    const w = db.waivers.find((x) => x.id === req.params.id);
    if (!w || w.deletedAt || !req.query.k || sha(req.query.k) !== w.copyKey) return res.status(404).send('This link doesn’t work. Ask the ranch for a copy.');
    res.set('Cache-Control', 'private, no-store').type('html').send(await signedCopy(w, { forStaff: false }));
  });

  // ======================================================== contact form (website)
  r.post('/contact', rateLimit({ limit: 10, windowMs: 60 * 60e3 }), async (req, res) => {
    const b = req.body || {};
    const entry = {
      id: newId(), firstName: str(b.firstName, 80), lastName: str(b.lastName, 80), phone: str(b.phone, 40),
      email: str(b.email, 160), topic: str(b.topic, 40), message: str(b.message, 5000), createdAt: now(),
    };
    if (!entry.firstName || !validEmail(entry.email)) return res.status(400).json({ error: 'Name and a valid email are required.' });
    db.contacts.push(entry);
    await store.save();
    notify('contact', entry);
    res.status(201).json({ ok: true });
  });

  // ======================================================== auth
  const loginLimit = rateLimit({ limit: 10, windowMs: 15 * 60e3 });

  r.get('/auth/me', (req, res) => res.json({ user: auth.publicUser(req.user) }));

  r.post('/auth/login', loginLimit, (req, res) => {
    const email = str(req.body && req.body.email, 160).toLowerCase();
    const password = req.body && req.body.password;
    const user = db.users.find((u) => u.email === email && u.active !== false);
    if (!user || !auth.verifyPassword(password, user.password)) return res.status(401).json({ error: 'That email and password don’t match.' });
    auth.startSession(req, res, user);
    res.json({ user: auth.publicUser(user) });
  });

  r.post('/auth/logout', (req, res) => { auth.endSession(req, res); res.json({ ok: true }); });

  r.get('/auth/invite/:token', (req, res) => {
    const found = auth.findInvite(req.params.token);
    if (!found) return res.status(404).json({ error: 'This link expired or was already used. Ask the ranch for a new one.' });
    res.json({ name: found.user.name, email: found.user.email, role: found.user.role });
  });

  r.post('/auth/accept-invite', loginLimit, async (req, res) => {
    const found = auth.findInvite(str(req.body && req.body.token, 200));
    if (!found) return res.status(404).json({ error: 'This link expired or was already used. Ask the ranch for a new one.' });
    const password = req.body && req.body.password;
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
    found.user.password = auth.hashPassword(password);
    auth.useInvite(found.inv);
    await store.save();
    auth.startSession(req, res, found.user);
    res.json({ user: auth.publicUser(found.user) });
  });

  // ======================================================== owners
  r.get('/my/horses', auth.requireUser, (req, res) => {
    const mine = db.horses.filter((h) => h.active !== false && (req.user.role === 'staff' || h.ownerId === req.user.id));
    res.json({
      horses: mine.map((h) => {
        const ups = db.updates.filter((u) => u.horseId === h.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const withImage = ups.find((u) => u.media.some((m) => m.type === 'image'));
        const stall = stallById(h.stallId);
        return {
          id: h.id, name: h.name, breed: h.breed, arrivedOn: h.arrivedOn, stall: stall ? stall.name : '',
          updates: ups.length,
          latest: ups[0] ? { caption: ups[0].caption, createdAt: ups[0].createdAt } : null,
          cover: withImage ? mediaOut(withImage.media.find((m) => m.type === 'image')).url : null,
        };
      }),
    });
  });

  r.get('/horses/:id/updates', auth.requireUser, (req, res) => {
    const h = db.horses.find((x) => x.id === req.params.id);
    if (!canSeeHorse(req.user, h)) return res.status(404).json({ error: 'Horse not found.' });
    const stall = stallById(h.stallId);
    const ups = db.updates.filter((u) => u.horseId === h.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({
      horse: { id: h.id, name: h.name, breed: h.breed, arrivedOn: h.arrivedOn, stall: stall ? stall.name : '' },
      updates: ups.map((u) => ({ id: u.id, caption: u.caption, authorName: u.authorName, createdAt: u.createdAt, media: u.media.map(mediaOut) })),
    });
  });

  r.get('/media/:file', auth.requireUser, (req, res) => {
    const file = path.basename(req.params.file);
    const up = db.updates.find((u) => u.media.some((m) => m.file === file));
    const horse = up && db.horses.find((h) => h.id === up.horseId);
    if (!canSeeHorse(req.user, horse)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.join(uploads, 'private', file));
  });

  // ======================================================== staff
  const staff = express.Router();
  staff.use(auth.requireStaff);

  // Ranch hands only get their shift and posting updates; everything else is for managers and office
  const HAND_ALLOWED = [/^GET \/horses$/, /^POST \/updates$/, /^(GET|POST|PATCH) \/shift(\/[\w-]+)?$/];
  // The lesson program only sends waivers to its clients
  const LESSONS_ALLOWED = [/^(GET|POST) \/client-waivers$/];
  staff.use((req, res, next) => {
    const pos = req.user.position || 'office';
    const allowed = pos === 'hand' ? HAND_ALLOWED : pos === 'lessons' ? LESSONS_ALLOWED : null;
    if (!allowed || allowed.some((rx) => rx.test(`${req.method} ${req.path}`))) return next();
    res.status(403).json({ error: 'Ask a manager for access to this.' });
  });
  r.use('/admin', staff);


  // ---- people helpers: positions, invite emails
  const POSITIONS = ['hand', 'manager', 'office', 'lessons'];
  const POSITION_LABEL = { hand: 'ranch hand', manager: 'ranch manager', office: 'office', lessons: 'lesson program' };
  async function emailInvite(user, url, by) {
    const what = user.role === 'owner' ? 'see your horse’s photos and videos, message the team and sign your documents'
      : user.position === 'lessons' ? 'send waivers to your lesson clients and see when they’re signed'
        : 'clock in, follow the shift checklist, post updates for owners and chat with the team';
    return mailer.sendEmail({
      to: user.email,
      subject: 'You’re invited to the Winning Ranch app',
      html: mailer.layout({
        title: `Welcome, ${String(user.name).split(' ')[0]}`,
        body: `<p>${by ? `${by.name} added you` : 'You’ve been added'} to the Winning Ranch app${user.role === 'staff' ? ` as ${POSITION_LABEL[user.position || 'office']}` : ''}. In the app you can ${what}.</p><p>Tap the button to create your password. The link works once and expires in 14 days.</p>`,
        button: { label: 'Set up my account', url },
      }),
    });
  }

  // ---- bookings
  staff.get('/bookings', (_req, res) => {
    const order = { pending: 0, confirmed: 1, completed: 2, declined: 3, cancelled: 4 };
    const list = db.bookings.slice().sort((a, b) => (order[a.status] - order[b.status]) || a.from.localeCompare(b.from));
    res.json({ bookings: list.map((b) => ({ ...b, stallNames: b.stallIds.map((id) => (stallById(id) || {}).name || id) })) });
  });

  staff.patch('/bookings/:id', async (req, res) => {
    const b = db.bookings.find((x) => x.id === req.params.id);
    if (!b) return res.status(404).json({ error: 'Booking not found.' });
    const status = req.body && req.body.status;
    if (status !== undefined) {
      if (!BOOKING_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
      if (HOLDS.has(status) && !HOLDS.has(b.status)) {
        const clash = b.stallIds.find((id) => stallBusy(id, b.from, b.to, b.id));
        if (clash) return res.status(409).json({ error: `${stallById(clash).name} is already held by another booking for those dates.` });
      }
      b.status = status;
    }
    if (req.body && typeof req.body.staffNote === 'string') b.staffNote = str(req.body.staffNote, 2000);
    b.updatedAt = now();
    b.updatedBy = req.user.name;
    await store.save();
    res.json({ booking: b });
  });

  // ---- stalls & rates
  staff.get('/stalls', (_req, res) => {
    res.json({
      settings: db.settings,
      map: MAP,
      areas: AREAS,
      stalls: db.stalls.map((s) => {
        const h = horseInStall(s.id);
        return { ...publicStall(s), status: s.status, horse: h ? { id: h.id, name: h.name } : null };
      }),
    });
  });

  staff.patch('/stalls/:id', async (req, res) => {
    const s = stallById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Stall not found.' });
    const b = req.body || {};
    const patch = {};
    for (const k of ['nightly', 'monthly']) if (k in b) {
      const v = money(b[k]);
      if (v === undefined) return res.status(400).json({ error: 'Prices must be numbers, like 45 or 45.50.' });
      patch[k] = v;
    }
    if ('size' in b) patch.size = str(b.size, 40);
    if ('description' in b) s.description = str(b.description, 500);
    if ('status' in b) {
      if (!['available', 'unavailable'].includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
      s.status = b.status;
    }
    const targets = b.applyToGroup ? db.stalls.filter((x) => x.group === s.group && x.smaller === s.smaller) : [s];
    for (const t of targets) Object.assign(t, patch);
    await store.save();
    res.json({ updated: targets.map((t) => t.id) });
  });

  // ---- pricing board: bulk changes with a history and undo
  const round2 = (v) => Math.round(v * 100) / 100;

  staff.get('/prices/log', (_req, res) => res.json({ log: db.priceLog.slice(-30).reverse() }));

  staff.post('/prices', async (req, res) => {
    const b = req.body || {};
    const field = b.field === 'monthly' || b.field === 'nightly' ? b.field : null;
    if (!field) return res.status(400).json({ error: 'Pick nightly or monthly.' });
    const op = ['set', 'add', 'percent', 'clear'].includes(b.op) ? b.op : null;
    if (!op) return res.status(400).json({ error: 'Unknown change.' });
    const ids = Array.isArray(b.stallIds) ? [...new Set(b.stallIds.map(String))] : [];
    const targets = ids.map(stallById).filter(Boolean);
    if (!targets.length) return res.status(400).json({ error: 'Pick at least one stall.' });
    const value = Number(b.value);
    if (op !== 'clear' && (b.value === '' || b.value === null || !Number.isFinite(value))) return res.status(400).json({ error: 'Type a number.' });
    if (op === 'set' && value < 0) return res.status(400).json({ error: 'Prices can’t be negative.' });
    if (op === 'set' && value > 100000) return res.status(400).json({ error: 'That price looks too high.' });

    const before = {}, after = {};
    for (const t of targets) {
      const cur = t[field];
      let next;
      if (op === 'clear') next = null;
      else if (op === 'set') next = round2(value);
      else if (cur == null) continue; // nothing to nudge on a stall without a price
      else if (op === 'add') next = round2(Math.max(0, cur + value));
      else next = round2(Math.max(0, cur * (1 + value / 100)));
      if (next === cur) continue;
      before[t.id] = cur;
      after[t.id] = next;
      t[field] = next;
    }
    const changed = Object.keys(after);
    if (!changed.length) return res.json({ changed: [], skipped: targets.length, entry: null });
    const entry = { id: newId(), at: now(), by: req.user.name, field, op, value: op === 'clear' ? null : value, before, after };
    db.priceLog.push(entry);
    if (db.priceLog.length > 500) db.priceLog.splice(0, db.priceLog.length - 500);
    await store.save();
    res.json({ changed, skipped: targets.length - changed.length, entry });
  });

  // Undo is a stack: it always reverts the newest change that isn't undone yet
  staff.post('/prices/undo', async (req, res) => {
    const entry = [...db.priceLog].reverse().find((e) => !e.undoneAt);
    if (!entry) return res.status(400).json({ error: 'Nothing to undo.' });
    for (const [id, val] of Object.entries(entry.before)) { const t = stallById(id); if (t) t[entry.field] = val; }
    entry.undoneAt = now();
    entry.undoneBy = req.user.name;
    await store.save();
    res.json({ entry });
  });

  staff.patch('/settings', async (req, res) => {
    const b = req.body || {};
    for (const k of ['parkingNightly', 'monthlyMin', 'monthlyMax']) if (k in b) {
      const v = money(b[k]);
      if (v === undefined) return res.status(400).json({ error: 'Prices must be numbers, like 25 or 25.50.' });
      db.settings[k] = v;
    }
    if (db.settings.monthlyMin != null && db.settings.monthlyMax != null && db.settings.monthlyMin > db.settings.monthlyMax) {
      [db.settings.monthlyMin, db.settings.monthlyMax] = [db.settings.monthlyMax, db.settings.monthlyMin];
    }
    await store.save();
    res.json({ settings: db.settings });
  });

  staff.post('/stalls/:id/photos', photoUpload, async (req, res) => {
    const s = stallById(req.params.id);
    const files = req.files || [];
    if (!s) { files.forEach((f) => removeFile('public', f.filename)); return res.status(404).json({ error: 'Stall not found.' }); }
    if (!files.length) return res.status(400).json({ error: req.rejected ? 'Only photos (JPG, PNG, WebP) can be added to stalls.' : 'Pick at least one photo.' });
    for (const f of files) s.photos.push({ id: newId(), file: f.filename });
    await store.save();
    res.status(201).json({ photos: s.photos.map((p) => ({ id: p.id, url: photoUrl(p), builtIn: !!p.builtIn })) });
  });

  staff.delete('/stalls/:id/photos/:photoId', async (req, res) => {
    const s = stallById(req.params.id);
    const p = s && s.photos.find((x) => x.id === req.params.photoId);
    if (!p) return res.status(404).json({ error: 'Photo not found.' });
    s.photos = s.photos.filter((x) => x !== p);
    if (p.file) removeFile('public', p.file);
    await store.save();
    res.status(204).end();
  });

  // ---- people (owners + staff)
  staff.get('/users', (_req, res) => {
    res.json({
      users: db.users.map((u) => ({
        ...auth.publicUser(u),
        horses: db.horses.filter((h) => h.ownerId === u.id && h.active !== false).map((h) => h.name),
      })),
    });
  });

  staff.post('/users', async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 100), email = str(b.email, 160).toLowerCase(), phone = str(b.phone, 40);
    const role = b.role === 'staff' ? 'staff' : 'owner';
    const position = role === 'staff' ? (POSITIONS.includes(b.position) ? b.position : 'office') : undefined;
    if (!name) return res.status(400).json({ error: 'Add a name.' });
    if (!validEmail(email)) return res.status(400).json({ error: 'Add a valid email. It’s what they log in with.' });
    if (db.users.some((u) => u.email === email)) return res.status(409).json({ error: 'Someone already has that email.' });
    const user = { id: newId(), name, email, phone, role, position, password: null, active: true, createdAt: now() };
    db.users.push(user);
    await store.save();
    const t = auth.createInvite(user);
    const inviteUrl = `${origin(req)}/#/invite/${t}`;
    const mail = b.sendEmail === false ? null : await emailInvite(user, inviteUrl, req.user);
    res.status(201).json({ user: auth.publicUser(user), inviteUrl, emailed: !!(mail && mail.ok), emailError: mail && !mail.ok ? mail.error : undefined });
  });

  staff.post('/users/:id/invite', async (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found.' });
    const t = auth.createInvite(user);
    const inviteUrl = `${origin(req)}/#/invite/${t}`;
    const mail = req.body && req.body.email ? await emailInvite(user, inviteUrl, req.user) : null;
    res.json({ inviteUrl, emailed: !!(mail && mail.ok), emailError: mail && !mail.ok ? mail.error : undefined });
  });

  staff.patch('/users/:id', async (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found.' });
    const b = req.body || {};
    if ('name' in b) { const v = str(b.name, 100); if (!v) return res.status(400).json({ error: 'Add a name.' }); user.name = v; }
    if ('phone' in b) user.phone = str(b.phone, 40);
    if ('email' in b) {
      const v = str(b.email, 160).toLowerCase();
      if (!validEmail(v)) return res.status(400).json({ error: 'Add a valid email.' });
      if (db.users.some((u) => u.email === v && u.id !== user.id)) return res.status(409).json({ error: 'Someone already has that email.' });
      user.email = v;
    }
    if ('position' in b && user.role === 'staff') {
      if (!POSITIONS.includes(b.position)) return res.status(400).json({ error: 'Unknown position.' });
      if (user.id === req.user.id && ['hand', 'lessons'].includes(b.position)) return res.status(400).json({ error: 'You can’t remove your own manager access.' });
      user.position = b.position;
    }
    if ('active' in b) {
      if (user.id === req.user.id && b.active === false) return res.status(400).json({ error: 'You can’t turn off your own access.' });
      user.active = !!b.active;
      if (!user.active) db.sessions = db.sessions.filter((s) => s.userId !== user.id);
    }
    await store.save();
    res.json({ user: auth.publicUser(user) });
  });

  // ---- horses
  staff.get('/horses', (_req, res) => {
    res.json({
      horses: db.horses.map((h) => ({
        ...h,
        ownerName: (db.users.find((u) => u.id === h.ownerId) || {}).name || '',
        stallName: (stallById(h.stallId) || {}).name || '',
        updates: db.updates.filter((u) => u.horseId === h.id).length,
      })),
    });
  });

  function horseFields(b, h) {
    if ('name' in b) { const v = str(b.name, 80); if (!v) return 'Add the horse’s name.'; h.name = v; }
    if ('breed' in b) h.breed = str(b.breed, 80);
    if ('notes' in b) h.notes = str(b.notes, 1000);
    if ('arrivedOn' in b) { if (b.arrivedOn && !isDate(b.arrivedOn)) return 'Arrival date looks wrong.'; h.arrivedOn = b.arrivedOn || ''; }
    if ('ownerId' in b) { if (!db.users.some((u) => u.id === b.ownerId)) return 'Pick the owner.'; h.ownerId = b.ownerId; }
    if ('stallId' in b) {
      if (b.stallId && !stallById(b.stallId)) return 'Pick a valid stall.';
      const other = b.stallId && db.horses.find((x) => x !== h && x.active !== false && x.stallId === b.stallId);
      if (other) return `${other.name} is already in that stall.`;
      h.stallId = b.stallId || '';
    }
    if ('active' in b) h.active = !!b.active;
    return null;
  }

  staff.post('/horses', async (req, res) => {
    const h = { id: newId(), name: '', breed: '', notes: '', arrivedOn: '', ownerId: '', stallId: '', active: true, createdAt: now() };
    const err = horseFields({ arrivedOn: new Date().toISOString().slice(0, 10), ...(req.body || {}) }, h);
    if (err) return res.status(400).json({ error: err });
    if (!h.name) return res.status(400).json({ error: 'Add the horse’s name.' });
    if (!h.ownerId) return res.status(400).json({ error: 'Pick the owner.' });
    db.horses.push(h);
    await store.save();
    res.status(201).json({ horse: h });
  });

  staff.patch('/horses/:id', async (req, res) => {
    const h = db.horses.find((x) => x.id === req.params.id);
    if (!h) return res.status(404).json({ error: 'Horse not found.' });
    const err = horseFields(req.body || {}, h);
    if (err) return res.status(400).json({ error: err });
    await store.save();
    res.json({ horse: h });
  });

  // ---- updates (photos/videos for owners)
  staff.post('/updates', mediaUpload, async (req, res) => {
    const files = req.files || [];
    const cleanup = () => files.forEach((f) => removeFile('private', f.filename));
    const horse = db.horses.find((h) => h.id === (req.body && req.body.horseId));
    if (!horse) { cleanup(); return res.status(400).json({ error: 'Pick the horse.' }); }
    const caption = str(req.body.caption, 2000);
    if (!caption && !files.length) return res.status(400).json({ error: req.rejected ? 'Those files aren’t photos or videos.' : 'Add a photo, a video or a note.' });
    const up = {
      id: newId(), horseId: horse.id, caption,
      media: files.map((f) => ({ file: f.filename, type: VIDEO[f.mimetype] ? 'video' : 'image', mime: f.mimetype })),
      authorName: req.user.name, authorId: req.user.id, createdAt: now(),
    };
    db.updates.push(up);
    await store.save();
    res.status(201).json({ update: { ...up, media: up.media.map(mediaOut) }, skipped: req.rejected || [] });
  });

  staff.delete('/updates/:id', async (req, res) => {
    const up = db.updates.find((u) => u.id === req.params.id);
    if (!up) return res.status(404).json({ error: 'Update not found.' });
    db.updates = db.updates.filter((u) => u !== up);
    up.media.forEach((m) => removeFile('private', m.file));
    await store.save();
    res.status(204).end();
  });

  // ---- signed waivers
  staff.get('/waivers', (_req, res) => {
    res.json({
      docs: DOCS.map((d) => ({ id: d.id, title: d.title })),
      deleted: db.waivers.filter((w) => w.deletedAt).length,
      waivers: db.waivers.filter((w) => (_req.query.deleted === '1' ? w.deletedAt : !w.deletedAt)).sort((a, b) => b.signedAt.localeCompare(a.signedAt)).map((w) => ({
        id: w.id, docId: w.docId, docTitle: w.docTitle, signedAt: w.signedAt,
        name: w.fields.name || '', signerName: w.signerName, minor: w.minor,
        email: w.fields.email || '', phone: w.fields.cell || '', horse: w.fields.horseName || '',
        countersign: w.countersign, deletedAt: w.deletedAt, deletedBy: w.deletedBy, deleteReason: w.deleteReason,
      })),
    });
  });

  staff.get('/waivers/:id/print', async (req, res) => {
    const w = db.waivers.find((x) => x.id === req.params.id);
    if (!w) return res.status(404).send('Not found');
    res.set('Cache-Control', 'private, no-store').type('html').send(await signedCopy(w, { forStaff: true }));
  });

  // Deleting hides a signed document (for test runs or ones filled out wrong). It can be restored.
  staff.delete('/waivers/:id', async (req, res) => {
    const w = db.waivers.find((x) => x.id === req.params.id && !x.deletedAt);
    if (!w) return res.status(404).json({ error: 'Waiver not found.' });
    w.deletedAt = now(); w.deletedBy = req.user.name; w.deleteReason = str(req.body && req.body.reason, 300);
    await store.save();
    res.status(204).end();
  });

  staff.post('/waivers/:id/restore', async (req, res) => {
    const w = db.waivers.find((x) => x.id === req.params.id && x.deletedAt);
    if (!w) return res.status(404).json({ error: 'Waiver not found.' });
    delete w.deletedAt; delete w.deletedBy; delete w.deleteReason;
    await store.save();
    res.json({ ok: true });
  });

  staff.post('/waivers/:id/countersign', async (req, res) => {
    const w = db.waivers.find((x) => x.id === req.params.id);
    if (!w) return res.status(404).json({ error: 'Waiver not found.' });
    if (!w.countersign) { w.countersign = { by: req.user.name, at: now() }; await store.save(); }
    res.json({ countersign: w.countersign });
  });

  // ---- contact-form messages
  staff.get('/contacts', (_req, res) => res.json({ contacts: db.contacts.slice().reverse() }));


  // ---- add several people at once: one per line, "Name, email, phone, position"
  staff.post('/users/bulk', async (req, res) => {
    const lines = String((req.body && req.body.lines) || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 50);
    const results = [];
    for (const line of lines) {
      const [name, email, phone, posRaw] = line.split(',').map((x) => (x || '').trim());
      const e = (email || '').toLowerCase();
      const posWord = (posRaw || '').toLowerCase();
      const isOwner = /owner|boarder|client/.test(posWord);
      const position = isOwner ? undefined : /lesson/.test(posWord) ? 'lessons' : /manager/.test(posWord) ? 'manager' : /office/.test(posWord) ? 'office' : 'hand';
      if (!name || !validEmail(e)) { results.push({ line, error: 'Needs a name and a valid email.' }); continue; }
      if (db.users.some((u) => u.email === e)) { results.push({ line, name, error: 'Already in People.' }); continue; }
      const user = { id: newId(), name: str(name, 100), email: e, phone: str(phone, 40), role: isOwner ? 'owner' : 'staff', position, password: null, active: true, createdAt: now() };
      db.users.push(user);
      const t = auth.createInvite(user);
      const mail = await emailInvite(user, `${origin(req)}/#/invite/${t}`, req.user);
      results.push({ line, name: user.name, role: user.role, position, emailed: mail.ok, emailError: mail.ok ? undefined : mail.error, inviteUrl: `${origin(req)}/#/invite/${t}` });
    }
    await store.save();
    res.json({ results });
  });

  // ---- waivers for clients without an account (lesson program, visitors)
  staff.post('/client-waivers', async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 100), email = str(b.email, 160).toLowerCase(), phone = str(b.phone, 40), note = str(b.note, 300);
    const docIds = (Array.isArray(b.docIds) ? b.docIds : []).filter((id) => docById(id));
    if (!name) return res.status(400).json({ error: 'Add the client’s name.' });
    if (!validEmail(email) && !phone) return res.status(400).json({ error: 'Add an email or a phone number to send it to.' });
    if (email && !validEmail(email)) return res.status(400).json({ error: 'Check the email address.' });
    if (!docIds.length) return res.status(400).json({ error: 'Pick at least one document.' });
    const reqs = docIds.map((docId) => ({ id: newId(), docId, name, email, phone, note, status: 'pending', requestedBy: req.user.name, requestedById: req.user.id, requestedAt: now(), client: true }));
    db.signRequests.push(...reqs);
    await store.save();
    const links = reqs.map((q) => ({ doc: docById(q.docId).title, url: `${origin(req)}/sign.html?doc=${q.docId}&r=${q.id}` }));
    let mail = null;
    if (email) {
      mail = await mailer.sendEmail({
        to: email,
        subject: `Please sign before your visit to Winning Ranch`,
        html: mailer.layout({
          title: `Hi ${name.split(' ')[0]}`,
          body: `<p>${req.user.name} from Winning Ranch asked you to sign ${links.length === 1 ? 'this document' : 'these documents'} before you ride:</p>
            ${links.map((l) => `<p style="margin:14px 0"><a href="${l.url}" style="background:#CC232A;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;display:inline-block">Sign: ${l.doc}</a></p>`).join('')}
            ${note ? `<p>${note.replace(/</g, '&lt;')}</p>` : ''}<p>It takes a few minutes on your phone.</p>`,
        }),
      });
    }
    res.status(201).json({ links, emailed: !!(mail && mail.ok), emailError: mail && !mail.ok ? mail.error : undefined });
  });

  staff.get('/client-waivers', (req, res) => {
    const mineOnly = (req.user.position || 'office') === 'lessons';
    const list = db.signRequests.filter((q) => q.client && (!mineOnly || q.requestedById === req.user.id))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, 200)
      .map((q) => ({ id: q.id, doc: (docById(q.docId) || {}).title, name: q.name, email: q.email, phone: q.phone, status: q.status, requestedAt: q.requestedAt, requestedBy: q.requestedBy, signedAt: q.signedAt || null }));
    res.json({ requests: list, email: mailer.configured() });
  });

  // Public: what a signing link was sent for, so the form can be filled in
  r.get('/sign-requests/:id', (req, res) => {
    const q = db.signRequests.find((x) => x.id === req.params.id && x.status === 'pending');
    if (!q) return res.status(404).json({ error: 'This request was already signed or cancelled.' });
    const u = q.userId ? db.users.find((x) => x.id === q.userId) : null;
    res.json({ docId: q.docId, name: u ? u.name : q.name, email: u ? u.email : q.email, phone: u ? u.phone : q.phone });
  });

  // ---- time clock (shift, hours, reports)
  require('./shifts')({ staff, db, store, newId, now, str });

  // ---- app: messages and the home screen
  const chatApi = require('./chats')({ r, db, store, auth, newId, now, str, uploads, stallById, docTitle: (id) => (docById(id) || {}).title || id });

  // ---- documents: what each person signed, what the ranch asked them to sign
  const mineWaivers = (u) => db.waivers.filter((w) => !w.deletedAt
    && (w.userId === u.id || (!w.userId && String(w.fields.email || '').toLowerCase() === u.email)));
  const docsFor = (u) => (u.role === 'staff' ? ['employee'] : ['boarding', 'lesson', 'liability']);

  r.get('/my/documents', auth.requireUser, (req, res) => {
    const u = req.user;
    const mine = mineWaivers(u);
    const pending = db.signRequests.filter((q) => q.userId === u.id && q.status === 'pending');
    const ids = [...new Set([...docsFor(u), ...pending.map((q) => q.docId), ...mine.map((w) => w.docId)])];
    res.json({
      docs: ids.map(docById).filter(Boolean).map((d) => {
        const signed = mine.filter((w) => w.docId === d.id).sort((a, b) => b.signedAt.localeCompare(a.signedAt));
        const q = pending.find((x) => x.docId === d.id);
        return {
          id: d.id, title: d.title, who: d.who, minutes: d.minutes,
          status: q ? 'requested' : signed.length ? 'signed' : 'available',
          request: q ? { by: q.requestedBy, at: q.requestedAt, note: q.note } : null,
          signed: signed.map((w) => ({ id: w.id, at: w.signedAt, horse: w.fields.horseName || '', countersigned: !!w.countersign })),
        };
      }),
      w9: u.role === 'staff',
    });
  });

  r.get('/my/waivers/:id/copy', auth.requireUser, async (req, res) => {
    const w = mineWaivers(req.user).find((x) => x.id === req.params.id);
    if (!w) return res.status(404).send('Not found');
    res.set('Cache-Control', 'private, no-store').type('html').send(await signedCopy(w, { forStaff: false }));
  });

  staff.get('/documents/status', (_req, res) => {
    const out = {};
    for (const u of db.users) {
      const mine = mineWaivers(u);
      out[u.id] = {};
      for (const id of [...new Set([...docsFor(u), ...mine.map((w) => w.docId)])]) {
        const last = mine.filter((w) => w.docId === id).sort((a, b) => b.signedAt.localeCompare(a.signedAt))[0];
        const q = db.signRequests.find((x) => x.userId === u.id && x.docId === id && x.status === 'pending');
        out[u.id][id] = { title: (docById(id) || {}).title || id, signedAt: last ? last.signedAt : null, requested: q ? { id: q.id, at: q.requestedAt, by: q.requestedBy } : null };
      }
    }
    res.json({ status: out });
  });

  staff.post('/sign-requests', async (req, res) => {
    const b = req.body || {};
    const user = db.users.find((u) => u.id === b.userId && u.active !== false);
    if (!user) return res.status(400).json({ error: 'Pick the person.' });
    const docIds = (Array.isArray(b.docIds) ? b.docIds : []).filter((id) => docById(id));
    if (!docIds.length) return res.status(400).json({ error: 'Pick at least one document.' });
    const note = str(b.note, 300);
    const made = [];
    for (const docId of docIds) {
      if (db.signRequests.some((q) => q.userId === user.id && q.docId === docId && q.status === 'pending')) continue;
      const q = { id: newId(), userId: user.id, docId, note, status: 'pending', requestedBy: req.user.name, requestedById: req.user.id, requestedAt: now() };
      db.signRequests.push(q);
      made.push(q);
    }
    let message = null;
    if (made.length && user.role === 'owner') message = chatApi.postSignRequest(user.id, req.user.id, made.map((q) => q.id), note);
    await store.save();
    res.status(201).json({ requested: made.map((q) => q.docId), alreadyPending: docIds.length - made.length, messageId: message && message.id });
  });

  staff.delete('/sign-requests/:id', async (req, res) => {
    const q = db.signRequests.find((x) => x.id === req.params.id && x.status === 'pending');
    if (!q) return res.status(404).json({ error: 'Request not found.' });
    q.status = 'cancelled'; q.cancelledBy = req.user.name; q.cancelledAt = now();
    await store.save();
    res.status(204).end();
  });

  return r;
};
