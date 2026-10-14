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
const { seedStalls, seedDemo } = require('../lib/ranch-seed');

const IMAGE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif' };
const VIDEO = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp' };
const BOOKING_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'completed'];
const HOLDS = new Set(['pending', 'confirmed']); // these block the stall

module.exports = function ranchRouter({ dataDir }) {
  const store = createStore(path.join(dataDir, 'ranch.json'), {
    stalls: [],
    settings: { fullCareNightly: null, parkingNightly: null },
    bookings: [],
    users: [],
    sessions: [],
    invites: [],
    horses: [],
    updates: [],
    seq: { booking: 1000 },
  });
  const db = store.data;
  const auth = createAuth(store);
  const uploads = path.join(dataDir, 'uploads');
  fs.mkdirSync(path.join(uploads, 'public'), { recursive: true });
  fs.mkdirSync(path.join(uploads, 'private'), { recursive: true });

  // ---------------------------------------------------------- first run
  if (!db.stalls.length) { db.stalls = seedStalls(); store.save(); }
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

  function publicStall(s, range) {
    let availability = 'available';
    if (s.status !== 'available') availability = 'unavailable';
    else if (horseInStall(s.id)) availability = 'occupied';
    else if (range && stallBusy(s.id, range.from, range.to)) availability = 'booked';
    return {
      id: s.id, group: s.group, number: s.number, name: s.name, shape: s.shape,
      smaller: !!s.smaller, size: s.size, nightly: s.nightly, monthly: s.monthly, description: s.description,
      photos: s.photos.map((p) => ({ id: p.id, url: '/api/ranch/files/' + p.file })),
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
    res.json({ stalls: db.stalls.map((s) => publicStall(s, range)), settings: db.settings, range });
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
    const care = b.care === 'full' ? 'full' : 'self';
    const parking = !!b.parking;
    const stallTotal = stallIds.every((id) => stallById(id).nightly !== null) ? stallIds.reduce((sum, id) => sum + stallById(id).nightly, 0) * n : null;
    const careTotal = care === 'full' ? (db.settings.fullCareNightly !== null ? db.settings.fullCareNightly * stallIds.length * n : null) : 0;
    const estimate = stallTotal !== null && careTotal !== null ? stallTotal + careTotal : null;

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
  r.use('/admin', staff);

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

  staff.patch('/settings', async (req, res) => {
    const b = req.body || {};
    for (const k of ['fullCareNightly', 'parkingNightly']) if (k in b) {
      const v = money(b[k]);
      if (v === undefined) return res.status(400).json({ error: 'Prices must be numbers, like 25 or 25.50.' });
      db.settings[k] = v;
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
    res.status(201).json({ photos: s.photos.map((p) => ({ id: p.id, url: '/api/ranch/files/' + p.file })) });
  });

  staff.delete('/stalls/:id/photos/:photoId', async (req, res) => {
    const s = stallById(req.params.id);
    const p = s && s.photos.find((x) => x.id === req.params.photoId);
    if (!p) return res.status(404).json({ error: 'Photo not found.' });
    s.photos = s.photos.filter((x) => x !== p);
    removeFile('public', p.file);
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
    if (!name) return res.status(400).json({ error: 'Add a name.' });
    if (!validEmail(email)) return res.status(400).json({ error: 'Add a valid email. It’s what they log in with.' });
    if (db.users.some((u) => u.email === email)) return res.status(409).json({ error: 'Someone already has that email.' });
    const user = { id: newId(), name, email, phone, role, password: null, active: true, createdAt: now() };
    db.users.push(user);
    await store.save();
    const t = auth.createInvite(user);
    res.status(201).json({ user: auth.publicUser(user), inviteUrl: `${origin(req)}/ranch/${role === 'staff' ? 'admin' : 'portal'}/#/invite/${t}` });
  });

  staff.post('/users/:id/invite', (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found.' });
    const t = auth.createInvite(user);
    res.json({ inviteUrl: `${origin(req)}/ranch/${user.role === 'staff' ? 'admin' : 'portal'}/#/invite/${t}` });
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

  return r;
};
