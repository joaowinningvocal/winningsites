/* Messages for the Winning Ranch app (same idea as the Winning App's chats).
   - "Winning Ranch Team" chat: everyone on the ranch team
   - One private chat per owner: that owner + the whole ranch team
   Photos are stored privately and only open for people in the chat.
   Also serves GET /app/home, the data behind the app's Home screen. */
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const H = require('../lib/hours');

module.exports = function chats({ r, db, store, auth, newId, now, str, uploads, stallById, docTitle }) {
  if (!db.chats) db.chats = [];
  if (!db.messages) db.messages = [];
  if (!db.reads) db.reads = {};
  if (!db.chats.some((c) => c.type === 'team')) { db.chats.push({ id: newId(), type: 'team', title: 'Winning Ranch Team', createdAt: now() }); store.save(); }

  const isStaff = (u) => u && u.role === 'staff';
  const ownerChat = (ownerId) => {
    let c = db.chats.find((x) => x.type === 'owner' && x.ownerId === ownerId);
    if (!c) { c = { id: newId(), type: 'owner', ownerId, createdAt: now() }; db.chats.push(c); store.save(); }
    return c;
  };
  const canSee = (u, c) => !!(u && c && (isStaff(u) || (c.type === 'owner' && c.ownerId === u.id)));
  const titleFor = (u, c) => (c.type === 'team' ? c.title : isStaff(u) ? ((db.users.find((x) => x.id === c.ownerId) || {}).name || 'Owner') : 'Winning Ranch');
  const lastRead = (u, cid) => ((db.reads[u.id] || {})[cid]) || '';
  const nameOf = (id) => (db.users.find((x) => x.id === id) || {}).name || 'Someone';

  function visibleChats(u) {
    if (isStaff(u)) {
      db.users.filter((x) => x.role === 'owner' && x.active !== false).forEach((o) => ownerChat(o.id));
      return db.chats.filter((c) => c.type === 'team' || (c.type === 'owner' && (db.users.find((x) => x.id === c.ownerId) || {}).active !== false));
    }
    return u.role === 'owner' ? [ownerChat(u.id)] : [];
  }

  function chatOut(u, c) {
    const msgs = db.messages.filter((m) => m.chatId === c.id);
    const last = msgs[msgs.length - 1];
    const seen = lastRead(u, c.id);
    return {
      id: c.id, type: c.type, title: titleFor(u, c), ownerId: isStaff(u) ? c.ownerId : undefined,
      last: last ? { text: last.text || (last.media.length ? 'Photo' : ''), at: last.at, by: last.userId === u.id ? 'You' : nameOf(last.userId) } : null,
      unread: msgs.filter((m) => m.userId !== u.id && m.at > seen).length,
    };
  }

  const msgOut = (u, m) => ({
    id: m.id, text: m.text, at: m.at, mine: m.userId === u.id, by: nameOf(m.userId),
    staff: isStaff(db.users.find((x) => x.id === m.userId)),
    media: m.media.map((x) => ({ type: x.type, url: `/api/ranch/chat-media/${x.file}` })),
    ...(m.kind === 'sign-request' ? {
      kind: 'sign-request',
      docs: (m.requestIds || []).map((id) => (db.signRequests || []).find((q) => q.id === id)).filter(Boolean)
        .map((q) => ({ id: q.docId, title: docTitle(q.docId), status: q.status })),
    } : {}),
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(uploads, 'private'),
      filename: (_q, f, cb) => cb(null, newId() + ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'video/mp4': '.mp4', 'video/quicktime': '.mov' }[f.mimetype] || '')),
    }),
    limits: { fileSize: 150 * 1024 * 1024, files: 6 },
    fileFilter: (_q, f, cb) => cb(null, /^(image|video)\//.test(f.mimetype)),
  }).array('files', 6);

  // ---------------------------------------------------------------- chats
  r.get('/chats', auth.requireUser, (req, res) => {
    const list = visibleChats(req.user).map((c) => chatOut(req.user, c))
      .sort((a, b) => (b.last ? b.last.at : '').localeCompare(a.last ? a.last.at : '') || (a.type === 'team' ? -1 : 1));
    res.json({ chats: list });
  });

  r.get('/chats/:id/messages', auth.requireUser, (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    if (!canSee(req.user, c)) return res.status(404).json({ error: 'Chat not found.' });
    const after = typeof req.query.after === 'string' ? req.query.after : '';
    const msgs = db.messages.filter((m) => m.chatId === c.id && m.at > after).slice(-200);
    res.json({ chat: chatOut(req.user, c), messages: msgs.map((m) => msgOut(req.user, m)) });
  });

  r.post('/chats/:id/messages', auth.requireUser, (req, res, next) => upload(req, res, (err) => (err ? res.status(400).json({ error: 'That file is too big or not a photo/video.' }) : next())), async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    const files = req.files || [];
    if (!canSee(req.user, c)) { files.forEach((f) => fs.promises.unlink(f.path).catch(() => {})); return res.status(404).json({ error: 'Chat not found.' }); }
    const text = str(req.body && req.body.text, 4000);
    if (!text && !files.length) return res.status(400).json({ error: 'Write a message or add a photo.' });
    const m = { id: newId(), chatId: c.id, userId: req.user.id, text, media: files.map((f) => ({ file: f.filename, type: f.mimetype.startsWith('video') ? 'video' : 'image' })), at: now() };
    db.messages.push(m);
    (db.reads[req.user.id] = db.reads[req.user.id] || {})[c.id] = m.at;
    await store.save();
    res.status(201).json({ message: msgOut(req.user, m) });
  });

  r.post('/chats/:id/read', auth.requireUser, async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    if (!canSee(req.user, c)) return res.status(404).json({ error: 'Chat not found.' });
    (db.reads[req.user.id] = db.reads[req.user.id] || {})[c.id] = now();
    await store.save();
    res.json({ ok: true });
  });

  r.get('/chat-media/:file', auth.requireUser, (req, res) => {
    const file = path.basename(req.params.file);
    const m = db.messages.find((x) => x.media.some((y) => y.file === file));
    const c = m && db.chats.find((x) => x.id === m.chatId);
    if (!canSee(req.user, c)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=86400').sendFile(path.join(uploads, 'private', file));
  });

  // Used by signature requests: a card in the owner's chat with "Sign" buttons
  function postSignRequest(ownerId, byUserId, requestIds, note) {
    const c = ownerChat(ownerId);
    const titles = requestIds.map((id) => docTitle((db.signRequests.find((q) => q.id === id) || {}).docId));
    const m = { id: newId(), chatId: c.id, userId: byUserId, kind: 'sign-request', requestIds, media: [], at: now(),
      text: `Please sign: ${titles.join(', ')}.${note ? ' ' + note : ''}` };
    db.messages.push(m);
    return m;
  }

  // ---------------------------------------------------------------- home screen
  r.get('/app/home', auth.requireUser, (req, res) => {
    const u = req.user;
    const unread = visibleChats(u).reduce((t, c) => t + chatOut(u, c).unread, 0);
    const seenUpdates = (db.reads[u.id] || {}).updates || '';
    const myHorses = db.horses.filter((h) => h.active !== false && (isStaff(u) || h.ownerId === u.id));
    const horses = (u.role === 'owner' ? myHorses : []).map((h) => {
      const ups = db.updates.filter((x) => x.horseId === h.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const img = ups.find((x) => x.media.some((m) => m.type === 'image'));
      return {
        id: h.id, name: h.name, stall: (stallById(h.stallId) || {}).name || '',
        latest: ups[0] ? { caption: ups[0].caption, at: ups[0].createdAt, by: ups[0].authorName } : null,
        cover: img ? `/api/ranch/media/${img.media.find((m) => m.type === 'image').file}` : null,
        fresh: ups.filter((x) => x.createdAt > seenUpdates).length,
      };
    });
    const toSign = (db.signRequests || []).filter((q) => q.userId === u.id && q.status === 'pending').length;
    const out = { user: auth.publicUser(u), unread, horses, toSign };
    if (isStaff(u)) {
      const pos = u.position || 'office';
      const shift = (db.shifts || []).find((s) => !s.deletedAt && s.userId === u.id && !s.out);
      out.shift = pos === 'office' ? null : shift ? { since: shift.in.at, onBreak: shift.breaks.some((b) => !b.end), worked: H.workedMinutes(shift), done: H.checklistStats(shift) } : false;
      out.horsesOnRanch = db.horses.filter((h) => h.active !== false).length;
      if (pos !== 'hand') {
        out.pendingBookings = db.bookings.filter((b) => b.status === 'pending').length;
        out.waiversToCountersign = (db.waivers || []).filter((w) => !w.deletedAt && !w.countersign).length;
        out.onClock = (db.shifts || []).filter((s) => !s.deletedAt && !s.out).map((s) => nameOf(s.userId));
      }
    }
    res.json(out);
  });

  r.post('/app/seen-updates', auth.requireUser, async (req, res) => {
    (db.reads[req.user.id] = db.reads[req.user.id] || {}).updates = now();
    await store.save();
    res.json({ ok: true });
  });

  return { postSignRequest };
};
