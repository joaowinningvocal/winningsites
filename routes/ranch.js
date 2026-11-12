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
const { seedStalls, seedDemo, seedReviewAccounts, STALL_SIZE } = require('../lib/ranch-seed');
const { MAP, SHAPES, AREAS } = require('../lib/ranch-layout');
const { DOCS, docById, allFields, fillValues, FILL_PARTS, INSTRUCTOR_FIELDS, INSTRUCTOR_DEFAULTS } = require('../lib/docs');
const mailer = require('../lib/mailer');

const IMAGE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif' };
const VIDEO = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp' };
const BOOKING_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'completed'];
const HOLDS = new Set(['pending', 'confirmed']); // these block the stall

module.exports = function ranchRouter({ dataDir }) {
  const STARTED_AT = new Date().toISOString();
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
  const stallById = (id) => db.stalls.find((s) => s.id === id);
  const horseInStall = (stallId) => db.horses.find((h) => h.active !== false && h.stallId === stallId);
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
    // Jenna's barn sheet (Oct 2026): 1 not in use, 2 and 11 in use, 10 ponies only, 20 is 12' x 22'
    'barn-sheet-rules': () => {
      const m = (n) => stallById('M' + n) || {};
      Object.assign(m(1), { status: 'unavailable', description: 'Not in use right now.' });
      for (const n of [2, 11]) {
        if (m(n).status !== 'unavailable') continue;
        Object.assign(m(n), { status: 'available', description: 'Indoor stall in the main barn, off the center aisle.' });
        if (m(n).photos && !m(n).photos.some((ph) => ph.url === BARN_PHOTO)) m(n).photos.unshift({ id: crypto.randomBytes(8).toString('hex'), url: BARN_PHOTO, builtIn: true });
      }
      Object.assign(m(10), { ponyOnly: true, description: 'Indoor stall in the main barn, for ponies only.' });
      Object.assign(m(20), { smaller: true, size: "12' x 22'" });
    },
    // Start the Stall board from the same sheet: boarders in 2-9 and 12, the ranch's own horses in 13-19.
    // They're monthly with no names; the team fills in names or ends them on the board.
    'board-from-barn-sheet': () => {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); // today at the ranch
      const plan = [[2, 3, 4, 5, 6, 7, 8, 9, 12, false], [13, 14, 15, 16, 17, 18, 19, true]];
      for (const row of plan) {
        const ours = row.pop();
        for (const n of row) {
          const id = 'M' + n;
          if (!stallById(id) || horseInStall(id) || db.bookings.some((b) => HOLDS.has(b.status) && b.stallIds.includes(id) && (b.to || '9999-12-31') > day)) continue;
          db.seq.booking += 1;
          db.bookings.push({
            id: crypto.randomBytes(8).toString('hex'), ref: 'WR' + db.seq.booking, status: 'confirmed', source: 'staff', kind: 'monthly', ours,
            stallIds: [id], horses: [''], ponies: [false], from: day, to: null, nights: null, name: '', phone: '', email: '',
            notes: 'From Jenna’s barn sheet. Add the horse’s name.', care: 'full', parking: false, estimate: null, staffNote: '',
            createdBy: 'Barn sheet', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          });
        }
      }
    },
    // Rates from Randy (Oct 30, 2026): barn $150 a night and $1,000 a month, outdoor $125 and $850.
    // Only stalls without a price get them, so nothing set on the Pricing board is overwritten.
    'rates-oct-2026': () => {
      for (const st of db.stalls) {
        const barn = st.group === 'main';
        if (st.nightly == null) st.nightly = barn ? 150 : 125;
        if (st.monthly == null) st.monthly = barn ? 1000 : 850;
      }
      Object.assign(db.settings, { monthlyMin: 850, monthlyMax: 1000 });
    },
    // Randy (Nov 2026): barn stalls are 12' x 24', outdoor stalls 10' x 20'. Sizes typed by hand on a stall stay.
    'outdoor-size-10x20': () => db.stalls.forEach((st) => { if (st.group === 'outdoor' && (!st.size || st.size === STALL_SIZE)) st.size = "10' x 20'"; }),
    // Barn stall 2 went back to $0 a night after Randy fixed it (Nov 2026): the barn rate again.
    // Kept out of the price history, so "Undo last change" can't take it back to $0.
    'barn-stall-2-rate': () => {
      const s = stallById('M2');
      if (s && s.nightly === 0) s.nightly = 150;
    },
  };
  let migrated = false;
  for (const [name, run] of Object.entries(migrations)) {
    if (!db.migrations[name]) { run(); db.migrations[name] = new Date().toISOString(); migrated = true; }
  }
  if (migrated) store.save();
  // Master account: whoever is in ADMIN_EMAIL / ADMIN_PASSWORD on Railway. Full access, nobody else can turn it
  // off, change it or send it a login link, and changing ADMIN_PASSWORD on Railway resets its password.
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail && process.env.ADMIN_PASSWORD) {
    let m = db.users.find((u) => u.email === adminEmail);
    if (!m) {
      m = { id: crypto.randomBytes(8).toString('hex'), name: process.env.ADMIN_NAME || 'Ranch admin', email: adminEmail, phone: '',
        role: 'staff', password: auth.hashPassword(process.env.ADMIN_PASSWORD), active: true, createdAt: new Date().toISOString() };
      db.users.push(m);
      console.log('[ranch] master account created for', adminEmail);
    } else if (!auth.verifyPassword(process.env.ADMIN_PASSWORD, m.password)) {
      m.password = auth.hashPassword(process.env.ADMIN_PASSWORD);
      db.sessions = db.sessions.filter((x) => x.userId !== m.id);
      console.log('[ranch] master password updated from ADMIN_PASSWORD for', adminEmail);
    }
    Object.assign(m, { role: 'staff', position: 'office', active: true, master: true });
    if (process.env.ADMIN_NAME) m.name = process.env.ADMIN_NAME;
    store.save();
  }
  // João (the developer) also has a master account, set here instead of Railway. It starts without a password:
  // logging in with the email sends him the link to create one.
  for (const a of [{ email: 'joao@winningvocal.com', name: 'João' }]) {
    let m = db.users.find((u) => u.email === a.email);
    if (!m) {
      m = { id: crypto.randomBytes(8).toString('hex'), name: a.name, email: a.email, phone: '', role: 'staff', password: null, active: true, createdAt: new Date().toISOString() };
      db.users.push(m);
      console.log('[ranch] master account created for', a.email);
    }
    if (!m.master || m.role !== 'staff' || m.position !== 'office' || m.active === false) { Object.assign(m, { role: 'staff', position: 'office', active: true, master: true }); store.save(); }
  }
  if (process.env.SEED_DEMO === '1') seedDemo(store, auth, uploads);

  // Ranch hands start with a temporary password the office tells them (HAND_TEMP_PASSWORD on Railway, else "Winning!")
  // and pick their own the first time they log in. Hands who already made a password keep it.
  const TEMP_PASSWORD = process.env.HAND_TEMP_PASSWORD || 'Winning!';
  const giveTempPassword = (u) => {
    if (u.role !== 'staff' || u.position !== 'hand' || u.password || u.demo || u.active === false) return false;
    Object.assign(u, { password: auth.hashPassword(TEMP_PASSWORD), mustChangePassword: true });
    return true;
  };
  if (db.users.map(giveTempPassword).some(Boolean)) store.save();
  seedReviewAccounts(store, uploads); // App Store and Google Play review logins

  // ---------------------------------------------------------- helpers
  const newId = () => crypto.randomBytes(8).toString('hex');
  const now = () => new Date().toISOString();
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const money = (v) => (v === null || v === '' || v === undefined ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 100) / 100 : undefined);
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const nights = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
  const dayOffset = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const origin = (req) => `${req.protocol}://${req.get('host')}`;

  // Monthly stays may have no end day. Stays with one of our own horses don't block: that horse can move.
  function stallBusy(stallId, from, to, ignoreBookingId) {
    return db.bookings.some((b) => b.id !== ignoreBookingId && HOLDS.has(b.status) && !b.ours && b.stallIds.includes(stallId) && b.from < to && from < (b.to || '9999-12-31'));
  }

  const photoUrl = (p) => p.url || '/api/ranch/files/' + p.file;

  function publicStall(s, range) {
    let availability = 'available';
    if (s.status !== 'available') availability = 'unavailable';
    else if (horseInStall(s.id)) availability = 'occupied';
    else if (range && stallBusy(s.id, range.from, range.to)) availability = 'booked';
    else if (!range && stallBusy(s.id, dayOffset(0), dayOffset(1))) availability = 'occupied';
    return {
      id: s.id, group: s.group, number: s.number, name: s.name, shape: SHAPES[s.id] || s.shape || null,
      smaller: !!s.smaller, ponyOnly: !!s.ponyOnly, size: s.size, nightly: s.nightly, monthly: s.monthly, description: s.description,
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

  // ---------------------------------------------------------- ops API (for Claude, like the Winning App's debug API)
  // A request with the header X-Ops-Key = the Railway variable OPS_API_KEY (24+ characters) runs as the acting account:
  // OPS_ACT_AS (an email) or else the master account. So every dashboard and chat route works with the key, plus the
  // /ops routes below. Without the variable the key does nothing and /ops is 404. Wrong keys: 20 per 10 minutes.
  // Every call is logged; passwords, password hashes and session or invite tokens are never returned.
  const OPS_KEY = (process.env.OPS_API_KEY || '').trim();
  let opsFails = [];
  const opsActor = () => {
    const want = (process.env.OPS_ACT_AS || '').trim().toLowerCase();
    const live = (u) => u.active !== false && u.role === 'staff';
    return (want && db.users.find((u) => live(u) && u.email === want)) || db.users.find((u) => live(u) && u.master)
      || db.users.find((u) => live(u) && (u.position || 'office') === 'office');
  };
  r.use((req, res, next) => {
    const got = req.headers['x-ops-key'];
    const opsPath = req.path.startsWith('/ops/');
    if (!got && !opsPath) return next();
    if (OPS_KEY.length < 24) return res.status(404).json({ error: 'Not found.' });
    const t = Date.now();
    opsFails = opsFails.filter((x) => t - x < 10 * 60e3);
    if (opsFails.length >= 20) return res.status(429).json({ error: 'Too many wrong keys. Wait 10 minutes.' });
    const a = crypto.createHash('sha256').update(String(got || '')).digest(), b = crypto.createHash('sha256').update(OPS_KEY).digest();
    if (!got || !crypto.timingSafeEqual(a, b)) { opsFails.push(t); console.log(`[ops] wrong key (${req.method} ${req.path})`); return res.status(403).json({ error: 'Wrong key.' }); }
    const actor = opsActor();
    if (!actor) return res.status(503).json({ error: 'No staff account to act as. Set OPS_ACT_AS on Railway.' });
    req.user = actor;
    req.ops = true;
    // Login links and anything secret stay out of what the key gets back
    const clean = (v, d = 0) => {
      if (!v || typeof v !== 'object' || d > 8) return v;
      if (Array.isArray(v)) return v.map((x) => clean(x, d + 1));
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = /inviteUrl|token|password|hash|secret/i.test(k) && typeof x !== 'boolean' ? (x ? '(hidden)' : x) : clean(x, d + 1);
      return o;
    };
    const json = res.json.bind(res);
    res.json = (b) => json(clean(b));
    console.log(`[ops] ${req.method} ${req.path} as ${actor.name}`);
    next();
  });
  const opsBrief = (u) => ({
    ...auth.publicUser(u), createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null, appInviteAt: u.appInviteAt || null,
    setupLinkAt: u.setupLinkAt || null, demo: !!u.demo,
  });
  r.get('/ops/ping', (req, res) => res.json({
    ok: true, actingAs: { id: req.user.id, name: req.user.name, email: req.user.email },
    email: { configured: mailer.configured(), ...mailer.via() }, people: db.users.filter((u) => !u.demo).length,
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null, startedAt: STARTED_AT,
  }));
  r.get('/ops/logs', (req, res) => res.json({ lines: require('../lib/oplog').recent({ limit: Number(req.query.limit) || 200, q: req.query.q }) }));
  r.get('/ops/people', (req, res) => {
    const q = String(req.query.q || '').toLowerCase();
    res.json({ people: db.users.filter((u) => !q || `${u.name} ${u.email} ${u.phone || ''}`.toLowerCase().includes(q)).map(opsBrief) });
  });

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
    if (b.coggins !== true) errors.push('Confirm you’ll bring a valid Health Certificate & Coggins for each horse.');
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

  // The instructor and insurance block of the riding forms, as the office last filled it in
  const instructorValues = () => {
    const saved = db.settings.instructor || {};
    return Object.fromEntries(INSTRUCTOR_FIELDS.map((f) => [f.key, saved[f.key] !== undefined ? saved[f.key] : INSTRUCTOR_DEFAULTS[f.key] || '']));
  };

  r.get('/docs', (_req, res) => res.json({ docs: DOCS, instructor: instructorValues() }));

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
    // The riding forms carry the instructor and insurance details the office filled in, as they are today
    if (doc.instructor) for (const [k, v] of Object.entries(instructorValues())) if (v) fields[k] = v;
    // The minor consent is always signed by the parent or guardian named on it
    const forMinor = !!(doc.signedByGuardian || (doc.minor && b.minor === true));
    const guardianName = doc.signedByGuardian ? fields.guardianName || '' : forMinor ? str(b.guardianName, 120) : '';
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
    // The document's marked blanks get what was filled in and the drawn signature; anything else filled in is listed after it
    const vals = fillValues(w.fields, w.signedAt);
    const shown = new Set();
    const filledHtml = html.replace(/<span class="blank" data-fill="(\w+)">[^<]*<\/span>/g, (m, k) => {
      if (k === 'signature') return sig ? `<img class="sig-inline" alt="Signature of ${e(w.signerName)}" src="data:image/png;base64,${sig}">` : m;
      if (!vals[k]) return m;
      (FILL_PARTS[k] || [k]).forEach((x) => shown.add(x));
      return `<span class="filled">${e(vals[k])}</span>`;
    });
    const sections = (doc ? doc.sections : []).map((sec) => {
      const rows = sec.fields.filter((f) => w.fields[f.key] && !shown.has(f.key)).map((f) => `<tr><th>${e(f.label)}</th><td>${e(w.fields[f.key])}</td></tr>`).join('');
      return rows ? `<h3>${e(sec.title)}</h3><table>${rows}</table>` : '';
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
      <title>${e(w.docTitle)}, ${e(w.fields.name)}</title>
      <style>body{font:15px/1.55 Georgia,serif;color:#111;max-width:780px;margin:0 auto;padding:0 20px 60px}
      .bar{position:sticky;top:0;background:#fff;padding:12px 0;border-bottom:1px solid #ddd;margin-bottom:20px;font-family:Arial,sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      .bar button{font:600 15px Arial,sans-serif;padding:10px 16px;background:#CC232A;color:#fff;border:0;cursor:pointer}
      .bar .close{font:600 15px Arial,sans-serif;padding:10px 14px;border:1px solid #111;color:#111;text-decoration:none}
      .box{border:2px solid #111;padding:14px 18px;margin:0 0 26px;font-family:Arial,sans-serif;font-size:14px}
      .box strong{font-size:16px}
      h2{font:700 18px Arial,sans-serif;margin:34px 0 8px;border-top:2px solid #111;padding-top:14px}h3{font:700 15px Arial,sans-serif;margin:18px 0 6px}
      table{border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #ddd;vertical-align:top}th{width:40%;font-weight:normal;color:#555}
      .doc table td,.doc table th{border:1px solid #ccc}.sig img{max-width:340px;border-bottom:1px solid #111;display:block;margin:6px 0 4px}
      .filled{font:600 15px Arial,sans-serif;border-bottom:1px solid #111;padding:0 4px}.sig-inline{height:56px;max-width:260px;vertical-align:bottom;border-bottom:1px solid #111}
      @media print{.bar{display:none}h2{page-break-before:auto}.sig{page-break-inside:avoid}}</style></head><body>
      <div class="bar" data-own-back><a class="close" href="${forStaff ? '/admin/#/waivers' : '/#/documents'}" onclick="if (history.length > 1) { history.back(); return false; }">&lsaquo; Close</a><button onclick="print()">Print or save as PDF</button><span>Keep a copy for your records.</span></div>
      <div class="box"><strong>${e(w.docTitle)}</strong>, signed electronically by ${e(w.signerName)}${w.minor ? ` (parent or guardian of ${e(w.fields.name)})` : ''} on ${e(when(w.signedAt))}.
        ${w.countersign ? `<br>Countersigned for Winning Ranch by ${e(w.countersign.by)} on ${e(when(w.countersign.at))}.` : forStaff ? '<br>Not countersigned by the ranch yet.' : ''}</div>
      <div class="doc">${filledHtml}</div>
      ${shown.size ? (sections ? `<h2>Also provided</h2>${sections}` : '') : `<h2>Information provided</h2>${sections || '<p>None.</p>'}`}
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

  r.use((req, res, next) => {
    if (!req.user || !req.user.mustChangePassword || /^\/auth\/(me|logout|change-password)$/.test(req.path)) return next();
    res.status(403).json({ error: 'Create your own password first.', mustChangePassword: true });
  });

  r.get('/auth/me', (req, res) => res.json({ user: auth.publicUser(req.user) }));

  // First login with the temporary password: pick your own
  r.post('/auth/change-password', loginLimit, auth.requireUser, async (req, res) => {
    const password = req.body && req.body.password;
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
    if (password === TEMP_PASSWORD) return res.status(400).json({ error: 'Pick a password of your own, not the temporary one.' });
    Object.assign(req.user, { password: auth.hashPassword(password), mustChangePassword: false });
    await store.save();
    res.json({ user: auth.publicUser(req.user) });
  });

  r.post('/auth/login', loginLimit, (req, res) => {
    const email = str(req.body && req.body.email, 160).toLowerCase();
    const password = req.body && req.body.password;
    const user = db.users.find((u) => u.email === email && u.active !== false);
    // No password yet: email a link to create one (never set it here, or whoever knows the email could take the account)
    if (user && !user.password) return passwordSetupLink(req, res, user);
    if (!user || !auth.verifyPassword(password, user.password)) return res.status(401).json({ error: 'That email and password don’t match.' });
    user.lastLoginAt = now(); // saved with the session
    auth.startSession(req, res, user);
    res.json({ user: auth.publicUser(user) });
  });

  r.post('/auth/logout', (req, res) => { auth.endSession(req, res); res.json({ ok: true }); });

  // Delete my account, from the app (App Store rule for apps with accounts). The account is closed and its
  // name, email, phone and password are erased. Signed agreements stay, as the privacy policy says.
  r.post('/auth/delete-account', loginLimit, auth.requireUser, async (req, res) => {
    const u = req.user;
    if (u.master) return res.status(400).json({ error: 'The master account can’t be deleted in the app. Change ADMIN_EMAIL on Railway instead.' });
    if (u.password && !auth.verifyPassword(req.body && req.body.password, u.password)) return res.status(400).json({ error: 'That password isn’t right.' });
    auth.endSession(req, res);
    Object.assign(u, { name: 'Deleted account', email: `deleted-${u.id}@deleted.invalid`, phone: '', password: null, active: false, deletedAt: now() });
    db.sessions = db.sessions.filter((s) => s.userId !== u.id);
    db.invites = db.invites.filter((i) => i.userId !== u.id);
    for (const c of db.chats) if (Array.isArray(c.members)) c.members = c.members.filter((id) => id !== u.id);
    await store.save();
    if (u.demo) seedReviewAccounts(store, uploads); // a store review login comes back fresh for the next review
    res.json({ ok: true });
  });

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
    found.user.mustChangePassword = false;
    auth.useInvite(found.inv);
    await store.save();
    found.user.lastLoginAt = now();
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
        const stall = stallById(boardApi.stallOfHorse(h));
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
    const stall = stallById(boardApi.stallOfHorse(h));
    const ups = db.updates.filter((u) => u.horseId === h.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({
      horse: { id: h.id, name: h.name, breed: h.breed, arrivedOn: h.arrivedOn, stall: stall ? stall.name : '', ...(req.user.role === 'staff' && h.notes ? { careNotes: h.notes } : {}) }, // the team's feeding notes; owners don't see them
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
  const HAND_ALLOWED = [/^GET \/horses$/, /^POST \/updates$/, /^(GET|POST|PATCH) \/shift(\/[\w-]+)?$/,
    /^GET \/schedule$/, /^POST \/schedule\/requests(\/[\w-]+\/cancel)?$/]; // see the schedule, ask to take or swap a shift
  // The lesson program only sends waivers to its clients
  const LESSONS_ALLOWED = [/^(GET|POST) \/client-waivers$/, /^(GET|PATCH) \/instructor$/];
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
  // Someone without a password tried to log in: their invite link goes to their own email, once every 10 minutes.
  // If email isn't working, the link is printed in the Railway logs (the master accounts can read them there).
  async function passwordSetupLink(req, res, user) {
    const sentTo = 'We emailed you a link to create your password. Open it on this phone, then log in.';
    if (user.setupLinkAt && Date.now() - Date.parse(user.setupLinkAt) < 10 * 60e3) return res.status(409).json({ error: `${sentTo} It can take a minute to arrive.`, needsPassword: true });
    const url = `${origin(req)}/#/invite/${auth.createInvite(user)}`;
    const mail = mailer.configured() === 'none' ? { ok: false } : await emailInvite(user, url, null);
    if (!mail.ok) {
      console.log(`[ranch] password link for ${user.email} (email didn’t send): ${url}`);
      return res.status(409).json({ error: 'You don’t have a password yet and we couldn’t email you a link. Ask the ranch office for a login link.', needsPassword: true });
    }
    user.setupLinkAt = now();
    await store.save();
    res.status(409).json({ error: sentTo, needsPassword: true });
  }

  // Forgot password: the link to set a new one goes to the account's own email, once every 10 minutes.
  // The answer is the same whether or not the email has an account.
  r.post('/auth/forgot', loginLimit, async (req, res) => {
    const email = str(req.body && req.body.email, 160).toLowerCase();
    const user = db.users.find((u) => u.email === email && u.active !== false);
    const done = () => res.json({ message: 'If that email has an account, we sent it a link to set a new password. Open it on this phone.' });
    if (!user || (user.setupLinkAt && Date.now() - Date.parse(user.setupLinkAt) < 10 * 60e3)) return done();
    const url = `${origin(req)}/#/invite/${auth.createInvite(user)}`;
    const mail = mailer.configured() === 'none' ? { ok: false } : await mailer.sendEmail({
      to: user.email,
      subject: 'Set a new password for the Winning Ranch app',
      html: mailer.layout({
        title: `Hi, ${String(user.name).split(' ')[0]}`,
        body: '<p>Someone asked to set a new password for your Winning Ranch account. If it was you, tap the button. The link works once and expires in 14 days.</p><p>If it wasn’t you, ignore this email. Your password stays the same.</p>',
        button: { label: 'Set a new password', url },
      }),
    }).catch((e) => ({ ok: false, error: e.message }));
    if (mail.ok) { user.setupLinkAt = now(); await store.save(); } else console.log(`[ranch] password link for ${user.email} (email didn’t send): ${url}`);
    done();
  });

  const appWhat = (user) => (user.role === 'owner' ? 'see your horse’s photos and videos, message the team and sign your documents'
    : user.position === 'lessons' ? 'send waivers to your lesson clients and see when they’re signed'
      : 'clock in, follow the shift checklist, post updates for owners and chat with the team');
  async function emailInvite(user, url, by) {
    const what = appWhat(user);
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
  // Requests from the website. Stays the team adds itself live on the Stall board.
  staff.get('/bookings', (_req, res) => {
    const order = { pending: 0, confirmed: 1, completed: 2, declined: 3, cancelled: 4 };
    const list = db.bookings.filter((b) => b.source !== 'staff' && b.source !== 'ai').sort((a, b) => (order[a.status] - order[b.status]) || a.from.localeCompare(b.from));
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
        // Who is in it today, from the Stall board
        return { ...publicStall(s), status: s.status, horse: boardApi.occupant(s.id) };
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
    if ('ponyOnly' in b) s.ponyOnly = !!b.ponyOnly;
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

  // Undo reverts the change it's asked for (the toast's own change), else the newest one not undone yet.
  // A stall whose price was changed again since keeps its newer price, so an old undo never brings back a fixed price.
  staff.post('/prices/undo', async (req, res) => {
    const wanted = req.body && typeof req.body.id === 'string' ? req.body.id : null;
    const entry = wanted ? db.priceLog.find((e) => e.id === wanted && !e.undoneAt) : [...db.priceLog].reverse().find((e) => !e.undoneAt);
    if (!entry) return res.status(400).json({ error: wanted ? 'That change was already undone.' : 'Nothing to undo.' });
    const kept = [];
    for (const [id, val] of Object.entries(entry.before)) {
      const t = stallById(id);
      if (!t) continue;
      if (t[entry.field] !== entry.after[id]) { kept.push(t.name); continue; }
      t[entry.field] = val;
    }
    entry.kept = kept;
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
    giveTempPassword(user);
    db.users.push(user);
    await store.save();
    const t = auth.createInvite(user);
    const inviteUrl = `${origin(req)}/#/invite/${t}`;
    const mail = b.sendEmail === false ? null : await emailInvite(user, inviteUrl, req.user);
    if (mail && mail.ok) { user.appInviteAt = now(); await store.save(); }
    res.status(201).json({ user: auth.publicUser(user), inviteUrl, emailed: !!(mail && mail.ok), emailError: mail && !mail.ok ? mail.error : undefined });
  });

  staff.post('/users/:id/invite', async (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found.' });
    if (user.master && !req.user.master) return res.status(403).json({ error: 'That’s the master account. Only its owner can change it.' });
    const t = auth.createInvite(user);
    const inviteUrl = `${origin(req)}/#/invite/${t}`;
    const mail = req.body && req.body.email ? await emailInvite(user, inviteUrl, req.user) : null;
    if (mail && mail.ok) { user.appInviteAt = now(); await store.save(); }
    res.json({ inviteUrl, emailed: !!(mail && mail.ok), emailError: mail && !mail.ok ? mail.error : undefined });
  });

  // ---- invite everyone to the app: one email to each person with an account, once (running it again reaches only
  // the people added since, unless "send again" is ticked).
  // No password of their own yet (never logged in, or a ranch hand on the temporary one): the link to create it.
  // Already using it: where to open the app, plus the store links when APP_STORE_URL / PLAY_STORE_URL are set on Railway.
  // Sent in the background, a little over a second apart (Gmail's limits); the People page shows the progress.
  const inviteKind = (u) => (!u.password || u.mustChangePassword ? 'setup' : 'app');
  const inviteTargets = () => db.users.filter((u) => u.active !== false && !u.demo && validEmail(u.email || ''));
  const storeLinks = () => ({ appStore: (process.env.APP_STORE_URL || '').trim(), googlePlay: (process.env.PLAY_STORE_URL || '').trim() });
  let inviteJob = null;
  const jobOut = () => inviteJob && { running: inviteJob.running, total: inviteJob.total, sent: inviteJob.sent, failed: inviteJob.failed, by: inviteJob.by, startedAt: inviteJob.startedAt, finishedAt: inviteJob.finishedAt };

  function emailAppReady(user, base, by) {
    const s = storeLinks();
    const stores = [s.appStore && `<a href="${s.appStore}">App Store (iPhone)</a>`, s.googlePlay && `<a href="${s.googlePlay}">Google Play (Android)</a>`].filter(Boolean);
    return mailer.sendEmail({
      to: user.email,
      subject: 'The Winning Ranch app is ready',
      html: mailer.layout({
        title: `Hi, ${String(user.name).split(' ')[0]}`,
        body: `<p>${by ? `${by.name} invited you to` : 'Your account is ready on'} the Winning Ranch app. In it you can ${appWhat(user)}.</p>
          <p>Log in with this email (${user.email}) and your password. If you don’t remember it, tap “Forgot your password?” on the login screen.</p>
          ${stores.length ? `<p>Get it on your phone: ${stores.join(' or ')}.</p>` : '<p>On your phone, open the link and add it to your Home Screen.</p>'}`,
        button: { label: 'Open the app', url: `${base}/` },
      }),
    });
  }

  staff.get('/invite-all', (_req, res) => {
    const row = (u) => ({ id: u.id, name: u.name, email: u.email, who: u.role === 'owner' ? 'owner' : POSITION_LABEL[u.position || 'office'], kind: inviteKind(u), sentAt: u.appInviteAt || null });
    res.json({ email: mailer.configured(), via: mailer.via(), stores: storeLinks(), people: inviteTargets().map(row).sort((a, b) => a.name.localeCompare(b.name)), job: jobOut() });
  });

  // One test email to whoever is logged in, with the exact answer from the email service
  staff.post('/email-test', async (req, res) => {
    const v = mailer.via();
    console.log(`[ranch] test email to ${req.user.email} through ${v.service}`);
    const mail = await mailer.sendEmail({
      to: req.user.email,
      subject: 'Test from the Winning Ranch app',
      html: mailer.layout({ title: 'It works', body: `<p>This test came through ${v.service}${v.from ? ` from ${v.from}` : ''}. If you got it, the invites go out the same way.</p>` }),
    }).catch((e) => ({ ok: false, error: e.message }));
    if (!mail.ok) console.log(`[ranch] test email failed: ${mail.error}`);
    res.json({ ok: !!mail.ok, error: mail.ok ? undefined : mail.error, via: v, to: req.user.email });
  });

  staff.post('/invite-all', async (req, res) => {
    if (mailer.configured() !== 'email') return res.status(400).json({ error: 'Email isn’t set up on the server yet, so nothing can be sent.' });
    if (inviteJob && inviteJob.running) return res.status(409).json({ error: 'The invites are already going out.', job: jobOut() });
    const again = !!(req.body && req.body.again);
    const list = inviteTargets().filter((u) => again || !u.appInviteAt);
    if (!list.length) return res.status(400).json({ error: 'Everyone already got the invite.' });
    const base = origin(req), by = { name: req.user.name };
    inviteJob = { running: true, total: list.length, sent: 0, failed: [], by: req.user.name, startedAt: now(), finishedAt: null };
    console.log(`[ranch] ${req.user.name} is emailing the app invite to ${list.length} people`);
    res.status(202).json({ job: jobOut() });
    const job = inviteJob;
    for (const u of list) {
      let mail;
      try {
        mail = inviteKind(u) === 'setup' ? await emailInvite(u, `${base}/#/invite/${auth.createInvite(u)}`, by) : await emailAppReady(u, base, by);
      } catch (e) { mail = { ok: false, error: e.message }; }
      if (mail && mail.ok) { u.appInviteAt = now(); job.sent++; } else {
        job.failed.push({ name: u.name, email: u.email, error: (mail && mail.error) || 'didn’t send' });
        console.log(`[ranch] app invite to ${u.email} failed: ${(mail && mail.error) || 'didn’t send'}`);
      }
      await store.save();
      await new Promise((r) => setTimeout(r, 1200));
    }
    job.running = false; job.finishedAt = now();
    console.log(`[ranch] app invite: ${job.sent} sent, ${job.failed.length} failed`);
  });

  staff.patch('/users/:id', async (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found.' });
    if (user.master && !req.user.master) return res.status(403).json({ error: 'That’s the master account. Only its owner can change it.' });
    if (user.master && ('position' in (req.body || {}) || (req.body || {}).active === false)) return res.status(400).json({ error: 'The master account always keeps full access.' });
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
      giveTempPassword(user);
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
  // The same horses as the Stall board: a horse added there shows up here, and a stall picked here moves it there.
  // The owner is an app account when they have one, else just the name typed on the board.
  staff.get('/horses', (_req, res) => {
    res.json({
      // The store review accounts' sample horses stay out of the team's lists
      horses: db.horses.filter((h) => !h.demo).map((h) => {
        const place = boardApi.placeOf(h.id);
        const stallId = boardApi.stallOfHorse(h);
        return {
          ...h,
          stallId,
          ownerName: (db.users.find((u) => u.id === h.ownerId) || {}).name || h.ownerName || '',
          hasAccount: !!db.users.some((u) => u.id === h.ownerId),
          stallName: (stallById(stallId) || {}).name || '',
          stay: place ? { ref: place.stay.ref, kind: place.stay.kind || 'nightly', from: place.from, to: place.to, now: place.now, ours: !!place.stay.ours } : null,
          updates: db.updates.filter((u) => u.horseId === h.id).length,
        };
      }),
    });
  });

  // Checks and copies the fields onto h; the stall is not set here (see placeHorse on the board)
  function horseFields(b, h) {
    if ('name' in b) { const v = str(b.name, 80); if (!v) return 'Add the horse’s name.'; h.name = v; }
    if ('breed' in b) h.breed = str(b.breed, 80);
    if ('notes' in b) h.notes = str(b.notes, 1000);
    if ('arrivedOn' in b) { if (b.arrivedOn && !isDate(b.arrivedOn)) return 'Arrival date looks wrong.'; h.arrivedOn = b.arrivedOn || ''; }
    if ('ownerId' in b) { if (b.ownerId && !db.users.some((u) => u.id === b.ownerId)) return 'Pick the owner.'; h.ownerId = b.ownerId || ''; }
    if ('ownerName' in b) h.ownerName = str(b.ownerName, 100);
    if ('stallId' in b && b.stallId && !stallById(b.stallId)) return 'Pick a valid stall.';
    if ('active' in b) h.active = !!b.active;
    return null;
  }

  // A name change shows on the board too
  function renameOnBoard(h) {
    for (const b of db.bookings) {
      const i = (b.horseIds || []).indexOf(h.id);
      if (i >= 0 && Array.isArray(b.horses)) b.horses[i] = h.name;
    }
  }

  staff.post('/horses', async (req, res) => {
    const b = req.body || {};
    const h = { id: newId(), name: '', breed: '', notes: '', arrivedOn: '', ownerId: '', ownerName: '', stallId: '', active: true, createdAt: now() };
    const err = horseFields({ arrivedOn: boardApi.today(), ...b }, h);
    if (err) return res.status(400).json({ error: err });
    if (!h.name) return res.status(400).json({ error: 'Add the horse’s name.' });
    db.horses.push(h);
    const placeErr = b.stallId ? boardApi.placeHorse(h, b.stallId, req.user) : null;
    if (placeErr) { db.horses.pop(); return res.status(409).json({ error: placeErr }); }
    await store.save();
    res.status(201).json({ horse: h });
  });

  staff.patch('/horses/:id', async (req, res) => {
    const h = db.horses.find((x) => x.id === req.params.id);
    if (!h) return res.status(404).json({ error: 'Horse not found.' });
    const b = req.body || {};
    const next = { ...h };
    const err = horseFields(b, next);
    if (err) return res.status(400).json({ error: err });
    // Leaving the ranch frees its stall; otherwise a new stall moves it on the board
    const stallId = next.active === false ? '' : 'stallId' in b ? b.stallId || '' : undefined;
    if (stallId !== undefined) {
      const legacy = h.stallId;
      h.stallId = next.stallId = ''; // an old Horses-tab stall gives way to the board
      const placeErr = boardApi.placeHorse(next, stallId, req.user);
      if (placeErr) { h.stallId = legacy; return res.status(409).json({ error: placeErr }); }
    }
    Object.assign(h, next);
    renameOnBoard(h);
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

  // ---- the instructor and insurance block of the riding forms (filled in once, copied into each signature)
  staff.get('/instructor', (_req, res) => res.json({ fields: INSTRUCTOR_FIELDS, values: instructorValues() }));

  staff.patch('/instructor', async (req, res) => {
    const b = req.body || {};
    const next = instructorValues();
    for (const f of INSTRUCTOR_FIELDS) {
      if (!(f.key in b)) continue;
      const v = str(b[f.key], f.key === 'iLimits' ? 400 : 160);
      if (f.options && v && !f.options.includes(v)) return res.status(400).json({ error: `Pick ${f.options.join(' or ')} for “${f.label}”.` });
      if (f.key === 'iEmail' && v && !validEmail(v)) return res.status(400).json({ error: 'Check the instructor’s email.' });
      next[f.key] = v;
    }
    db.settings.instructor = next;
    await store.save();
    res.json({ values: next });
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
      giveTempPassword(user);
      db.users.push(user);
      const t = auth.createInvite(user);
      const mail = await emailInvite(user, `${origin(req)}/#/invite/${t}`, req.user);
      if (mail.ok) user.appInviteAt = now(); // "Invite everyone" won't email them twice
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

  // ---- stall board: monthly boarders, nightly stays, the stall assistant
  const boardApi = require('./board')({ staff, db, store, newId, now, str, isDate, stallById, horseInStall, HOLDS });

  // ---- time clock (shift, hours, reports)
  require('./shifts')({ staff, db, store, newId, now, str });

  // ---- weekly AM/PM schedule, take and swap requests
  const scheduleApi = require('./schedule')({ staff, db, store, newId, now, str });

  // ---- app: messages and the home screen
  const chatApi = require('./chats')({ r, db, store, auth, newId, now, str, uploads, stallById, stallOfHorse: boardApi.stallOfHorse, docTitle: (id) => (docById(id) || {}).title || id, scheduleSummary: scheduleApi.summary });

  // ---- documents: what each person signed, what the ranch asked them to sign
  const mineWaivers = (u) => db.waivers.filter((w) => !w.deletedAt
    && (w.userId === u.id || (!w.userId && String(w.fields.email || '').toLowerCase() === u.email)));
  const docsFor = (u) => (u.role === 'staff' ? ['employee'] : ['boarding', 'participant', 'minor']);

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

  // ---- admins from Railway: ADMIN_EMAILS="randy@winningrealty.com:Randy Gager, jenna@winningrealty.com:Jenna Gager"
  // Each one becomes an office account (full access) and gets an invite email once.
  // If email isn't working yet, the invite link is printed in the Railway deploy logs instead.
  const baseUrl = (process.env.APP_BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/$/, '');
  if (!db.bootInvites) db.bootInvites = {};
  const bootAdmins = String(process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [email, name] = x.split(':').map((y) => (y || '').trim());
    return { email: email.toLowerCase(), name: name || email.split('@')[0] };
  }).filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email));
  let changed = false;
  for (const a of bootAdmins) {
    let u = db.users.find((x) => x.email === a.email);
    if (!u) {
      u = { id: newId(), name: a.name, email: a.email, phone: '', role: 'staff', position: 'office', password: null, active: true, createdAt: now() };
      db.users.push(u); changed = true;
      console.log('[ranch] admin account created for', a.email);
    } else if (u.role !== 'staff' || !['office', 'manager'].includes(u.position || 'office') || u.active === false) {
      Object.assign(u, { role: 'staff', position: 'office', active: true }); changed = true;
    }
  }
  if (changed) store.save();
  setTimeout(async () => {
    for (const a of bootAdmins) {
      const u = db.users.find((x) => x.email === a.email);
      if (!u || u.password || db.bootInvites[a.email]) continue;
      if (!baseUrl) { console.log(`[ranch] set APP_BASE_URL so the invite for ${a.email} has a link`); continue; }
      const url = `${baseUrl}/#/invite/${auth.createInvite(u)}`;
      const mail = mailer.configured() === 'none' ? { ok: false, error: 'email not set up' } : await emailInvite(u, url, null);
      if (mail.ok) { db.bootInvites[a.email] = now(); store.save(); console.log('[ranch] invite emailed to', a.email); }
      else console.log(`[ranch] invite for ${a.email} not emailed (${mail.error}). Link: ${url}`);
    }
  }, 2000).unref();

  return r;
};
