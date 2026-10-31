/* Messages for the Winning Ranch app (same idea as the Winning App's chats).
   Three fixed chats (channels):
   - "Barn Management": the people in it (Jenna, Randy, Gabi); its members add and remove people
   - "Winning Ranch - Workers": the whole ranch team + Barn Management (this was the old team chat)
   - "Winning Ranch - Boarders": every horse owner + Barn Management
   - One private chat per owner: that owner + the whole ranch team
   - Groups and direct messages made by the team
   Photos are stored privately and only open for people in the chat.
   Also serves GET /app/home, the data behind the app's Home screen. */
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const H = require('../lib/hours');

module.exports = function chats({ r, db, store, auth, newId, now, str, uploads, stallById, stallOfHorse, docTitle }) {
  if (!db.chats) db.chats = [];
  if (!db.messages) db.messages = [];
  if (!db.reads) db.reads = {};

  const isStaff = (u) => u && u.role === 'staff';
  // The team in chats = staff except the lesson program (they only send waivers)
  const isTeam = (u) => isStaff(u) && (u.position || 'office') !== 'lessons';
  const isLead = (u) => isStaff(u) && ['manager', 'office'].includes(u.position || 'office');

  // ---------------------------------------------------------------- the fixed chats
  const CHANNELS = [
    { key: 'management', title: 'Barn Management', about: 'Barn management team' },
    { key: 'workers', title: 'Winning Ranch - Workers', about: 'The ranch team and Barn Management' },
    { key: 'boarders', title: 'Winning Ranch - Boarders', about: 'Every horse owner and Barn Management' },
  ];
  const channel = (key) => db.chats.find((c) => c.type === 'channel' && c.key === key);
  {
    let changed = false;
    // The old "Winning Ranch Team" chat becomes Workers, history and all
    const team = db.chats.find((c) => c.type === 'team');
    if (team && !channel('workers')) { Object.assign(team, { type: 'channel', key: 'workers', title: 'Winning Ranch - Workers' }); changed = true; }
    for (const ch of CHANNELS) {
      if (channel(ch.key)) continue;
      const c = { id: newId(), type: 'channel', key: ch.key, title: ch.title, createdAt: now() };
      // Barn Management starts with the office and the ranch managers; its members change it in the app
      if (ch.key === 'management') c.members = db.users.filter((u) => u.active !== false && isLead(u)).map((u) => u.id);
      db.chats.push(c);
      changed = true;
    }
    if (changed) store.save();
  }
  // If Barn Management is ever empty (first deploy before the admins exist), it starts again from the office and managers
  const management = () => {
    const c = channel('management');
    if (!c.members.length) c.members = db.users.filter((u) => u.active !== false && isLead(u)).map((u) => u.id);
    return c.members;
  };
  const isManagement = (u) => !!u && management().includes(u.id);
  const inChannel = (u, c) => u.active !== false && (c.key === 'management' ? isManagement(u)
    : c.key === 'workers' ? isTeam(u) || isManagement(u)
      : c.key === 'boarders' ? u.role === 'owner' || isManagement(u) : false);
  const channelMembers = (c) => db.users.filter((u) => inChannel(u, c));
  const ownerChat = (ownerId) => {
    let c = db.chats.find((x) => x.type === 'owner' && x.ownerId === ownerId);
    if (!c) { c = { id: newId(), type: 'owner', ownerId, createdAt: now() }; db.chats.push(c); store.save(); }
    return c;
  };
  const canSee = (u, c) => !!(u && c && (
    (c.type === 'channel' && inChannel(u, c))
    || (c.type === 'owner' && (isTeam(u) || c.ownerId === u.id))
    || ((c.type === 'group' || c.type === 'dm') && (c.members || []).includes(u.id))));
  const titleFor = (u, c) => (c.type === 'channel' || c.type === 'group' ? c.title
    : c.type === 'dm' ? nameOf((c.members || []).find((id) => id !== u.id))
      : isStaff(u) ? ((db.users.find((x) => x.id === c.ownerId) || {}).name || 'Owner') : 'Winning Ranch');
  const canManage = (u, c) => (c.type === 'group' && (c.createdBy === u.id || isLead(u))) || (c.type === 'channel' && c.key === 'management' && isManagement(u));
  function sys(c, text) { db.messages.push({ id: newId(), chatId: c.id, userId: null, kind: 'system', text, media: [], at: now() }); }
  const lastRead = (u, cid) => ((db.reads[u.id] || {})[cid]) || '';
  const nameOf = (id) => (db.users.find((x) => x.id === id) || {}).name || 'Someone';

  function visibleChats(u) {
    const mine = db.chats.filter((c) => (c.type === 'group' || c.type === 'dm') && (c.members || []).includes(u.id));
    const channels = CHANNELS.map((ch) => channel(ch.key)).filter((c) => inChannel(u, c));
    if (isTeam(u)) {
      db.users.filter((x) => x.role === 'owner' && x.active !== false).forEach((o) => ownerChat(o.id));
      return channels.concat(db.chats.filter((c) => c.type === 'owner' && (db.users.find((x) => x.id === c.ownerId) || {}).active !== false), mine);
    }
    return u.role === 'owner' ? [...channels, ownerChat(u.id), ...mine] : channels;
  }

  function chatOut(u, c) {
    const msgs = db.messages.filter((m) => m.chatId === c.id);
    const last = msgs[msgs.length - 1];
    const seen = lastRead(u, c.id);
    return {
      id: c.id, type: c.type, key: c.key, title: titleFor(u, c), ownerId: isStaff(u) ? c.ownerId : undefined,
      members: c.type === 'group' ? (c.members || []).map((id) => ({ id, name: nameOf(id) }))
        : c.type === 'channel' ? channelMembers(c).map((x) => ({ id: x.id, name: x.name })) : undefined,
      about: c.type === 'channel' ? CHANNELS.find((ch) => ch.key === c.key).about : undefined,
      canManage: canManage(u, c),
      last: last ? { text: last.text || (last.media.length ? 'Photo' : ''), at: last.at, by: last.userId === u.id ? 'You' : nameOf(last.userId) } : null,
      unread: msgs.filter((m) => m.userId !== u.id && m.at > seen).length,
    };
  }

  const msgOut = (u, m) => ({
    id: m.id, text: m.text, at: m.at, mine: m.userId === u.id, by: nameOf(m.userId),
    staff: isStaff(db.users.find((x) => x.id === m.userId)),
    media: m.media.map((x) => ({ type: x.type, url: `/api/ranch/chat-media/${x.file}` })),
    ...(m.kind === 'system' ? { kind: 'system' } : {}),
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
    // The fixed chats stay on top in their order, the rest newest first
    const pin = (c) => (c.type === 'channel' ? CHANNELS.findIndex((ch) => ch.key === c.key) : 9);
    const list = visibleChats(req.user).map((c) => chatOut(req.user, c))
      .sort((a, b) => pin(a) - pin(b) || (b.last ? b.last.at : '').localeCompare(a.last ? a.last.at : ''));
    res.json({ chats: list });
  });

  // ---------------------------------------------------------------- groups and direct messages (team)
  const requireTeam = (req, res, next) => (isTeam(req.user) ? next() : res.status(403).json({ error: 'Only the ranch team can do this.' }));
  const people = (u) => db.users.filter((x) => x.active !== false && x.id !== u.id && (x.role === 'owner' || isTeam(x)));

  r.get('/chats/people', auth.requireUser, requireTeam, (req, res) => {
    res.json({ people: people(req.user).map((x) => ({ id: x.id, name: x.name, role: x.role, position: x.position || (x.role === 'staff' ? 'office' : undefined) }))
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'staff' ? -1 : 1)) });
  });

  r.post('/chats', auth.requireUser, requireTeam, async (req, res) => {
    const b = req.body || {};
    const ok = new Set(people(req.user).map((x) => x.id));
    if (b.type === 'dm') {
      const other = db.users.find((x) => x.id === b.userId && ok.has(x.id) && isTeam(x));
      if (!other) return res.status(400).json({ error: 'Pick someone on the team. Owners have their own chat with the ranch.' });
      let c = db.chats.find((x) => x.type === 'dm' && x.members.includes(req.user.id) && x.members.includes(other.id));
      if (!c) { c = { id: newId(), type: 'dm', members: [req.user.id, other.id], createdBy: req.user.id, createdAt: now() }; db.chats.push(c); await store.save(); }
      return res.status(201).json({ chat: chatOut(req.user, c) });
    }
    const title = str(b.title, 60);
    const members = [...new Set((Array.isArray(b.memberIds) ? b.memberIds : []).filter((id) => ok.has(id)))];
    if (!title) return res.status(400).json({ error: 'Give the group a name.' });
    if (!members.length) return res.status(400).json({ error: 'Add at least one person.' });
    const c = { id: newId(), type: 'group', title, members: [req.user.id, ...members], createdBy: req.user.id, createdAt: now() };
    db.chats.push(c);
    sys(c, `${req.user.name} created the group`);
    await store.save();
    res.status(201).json({ chat: chatOut(req.user, c) });
  });

  r.patch('/chats/:id', auth.requireUser, async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    if (!canSee(req.user, c) || !canManage(req.user, c) || c.type !== 'group') return res.status(403).json({ error: 'Only the group’s creator or a manager can change it.' });
    const title = str(req.body && req.body.title, 60);
    if (!title) return res.status(400).json({ error: 'Give the group a name.' });
    c.title = title;
    sys(c, `${req.user.name} renamed the group to ${title}`);
    await store.save();
    res.json({ chat: chatOut(req.user, c) });
  });

  r.post('/chats/:id/members', auth.requireUser, async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    if (!canSee(req.user, c) || !canManage(req.user, c)) return res.status(403).json({ error: 'Only the group’s creator or a manager can add people.' });
    const ok = new Set(people(req.user).filter((x) => c.type === 'group' || isTeam(x)).map((x) => x.id));
    const add = [...new Set((req.body && req.body.userIds) || [])].filter((id) => ok.has(id) && !c.members.includes(id));
    if (!add.length) return res.status(400).json({ error: 'Pick someone who isn’t in the group yet.' });
    c.members.push(...add);
    sys(c, `${req.user.name} added ${add.map(nameOf).join(', ')}`);
    await store.save();
    res.json({ chat: chatOut(req.user, c) });
  });

  r.delete('/chats/:id/members/:userId', auth.requireUser, async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    const self = req.params.userId === req.user.id;
    const mgmt = !!c && c.type === 'channel' && c.key === 'management';
    if (!canSee(req.user, c) || !(c.type === 'group' || mgmt) || (!self && !canManage(req.user, c))) return res.status(403).json({ error: 'You can’t remove people from this group.' });
    if (!c.members.includes(req.params.userId)) return res.status(404).json({ error: 'Not in the group.' });
    if (mgmt && c.members.length === 1) return res.status(400).json({ error: 'Barn Management needs at least one person.' });
    c.members = c.members.filter((id) => id !== req.params.userId);
    sys(c, self ? `${req.user.name} left the group` : `${req.user.name} removed ${nameOf(req.params.userId)}`);
    await store.save();
    res.status(204).end();
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
        id: h.id, name: h.name, stall: (stallById(stallOfHorse(h)) || {}).name || '',
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
