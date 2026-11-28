/* Messages for the Winning Ranch app (same idea as the Winning App's chats).
   Three fixed chats (channels):
   - "Barn Management": the people in it (Jenna, Randy, Gabi); its members add and remove people
   - "Winning Ranch - Workers": the whole ranch team + Barn Management (this was the old team chat)
   - "Winning Ranch - Boarders": every horse owner + Barn Management
   - One private chat per owner: that owner + the whole ranch team
   - Groups and direct messages made by the team
   Managers and the office add and remove people in any chat (People): the automatic chats keep a list of
   people added (extra) and taken out (excluded) on top of who is in them by role; a direct message becomes a group.
   Messages work like the Winning App's: reply with a quote, one reaction per person, edit, remove for
   everyone or just for me, "seen by", files (PDFs and documents) besides photos and videos.
   Photos and files are stored privately and only open for people in the chat.
   Also serves GET /app/home, the data behind the app's Home screen. */
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const H = require('../lib/hours');

module.exports = function chats({ r, db, store, auth, newId, now, str, uploads, stallById, stallOfHorse, docTitle, scheduleSummary, push }) {
  if (!db.chats) db.chats = [];
  if (!db.messages) db.messages = [];
  if (!db.reads) db.reads = {};
  if (!db.reports) db.reports = []; // reported messages, for Barn Management to review
  if (!db.blocks) db.blocks = {}; // { userId: [ids they blocked] }: their messages stay hidden for that person

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
  const extraOf = (c) => c.extra || [];       // added by hand to a chat whose members come from their role
  const excludedOf = (c) => c.excluded || []; // taken out of it by hand
  const inChannel = (u, c) => u.active !== false && !excludedOf(c).includes(u.id) && (extraOf(c).includes(u.id)
    || (c.key === 'management' ? isManagement(u)
      : c.key === 'workers' ? isTeam(u) || isManagement(u)
        : c.key === 'boarders' ? (u.role === 'owner' && !u.demo) || isManagement(u) : false)); // store review accounts stay out
  const channelMembers = (c) => db.users.filter((u) => inChannel(u, c));
  const ownerChat = (ownerId) => {
    let c = db.chats.find((x) => x.type === 'owner' && x.ownerId === ownerId);
    if (!c) { c = { id: newId(), type: 'owner', ownerId, createdAt: now() }; db.chats.push(c); store.save(); }
    return c;
  };
  const canSee = (u, c) => !!(u && c && (
    (c.type === 'channel' && inChannel(u, c))
    || (c.type === 'owner' && ((isTeam(u) && !excludedOf(c).includes(u.id)) || c.ownerId === u.id || extraOf(c).includes(u.id)))
    || ((c.type === 'group' || c.type === 'dm') && (c.members || []).includes(u.id))));
  // Everyone who sees a chat
  const membersOf = (c) => db.users.filter((u) => u.active !== false && canSee(u, c));
  // Managers and the office add and remove people anywhere; a group's creator in their group; Barn Management's members there
  const canManagePeople = (u, c) => !!(u && c && (isLead(u) || u.master
    || (c.type === 'group' && c.createdBy === u.id) || (c.type === 'channel' && c.key === 'management' && isManagement(u))));
  const canModerate = (u) => !!(u && (isLead(u) || u.master)); // remove anyone's message for everyone
  const titleFor = (u, c) => (c.type === 'channel' || c.type === 'group' ? c.title
    : c.type === 'dm' ? nameOf((c.members || []).find((id) => id !== u.id))
      : isStaff(u) ? ((db.users.find((x) => x.id === c.ownerId) || {}).name || 'Owner') : 'Winning Ranch');
  const canManage = (u, c) => (c.type === 'group' && (c.createdBy === u.id || isLead(u))) || (c.type === 'channel' && c.key === 'management' && isManagement(u));
  // @mentions: @First (first name; with the last name too when two people in the chat share it), @everyone, @barnmanager
  const cleanName = (x) => String(x || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]/g, ''); // João -> Joao
  function handlesFor(c) {
    const ms = membersOf(c);
    const first = (u) => cleanName(String(u.name).trim().split(/\s+/)[0]) || 'Someone';
    const count = {};
    ms.forEach((u) => { const f = first(u).toLowerCase(); count[f] = (count[f] || 0) + 1; });
    return ms.map((u) => {
      const f = first(u);
      const handle = count[f.toLowerCase()] > 1 ? f + cleanName(String(u.name).trim().split(/\s+/).slice(1).join('')) : f;
      return { id: u.id, handle, name: u.name, tag: u.role === 'owner' ? 'owner' : ({ hand: 'ranch hand', manager: 'barn manager', office: 'office', lessons: 'lesson program' }[u.position || 'office']) };
    });
  }
  const MENTION_RX = /(^|[^\w@])@([A-Za-z][A-Za-z0-9]*)/g;
  function resolveMentions(c, text, senderId) {
    const tokens = [...String(text || '').matchAll(MENTION_RX)].map((x) => x[2].toLowerCase());
    if (!tokens.length) return null;
    const ms = membersOf(c), hs = handlesFor(c);
    const ids = new Set(), labels = new Set();
    for (const t of tokens) {
      if (t === 'everyone') { ms.forEach((u) => ids.add(u.id)); labels.add(t); continue; }
      if (t === 'barnmanager') { ms.filter((u) => u.role === 'staff' && u.position === 'manager').forEach((u) => ids.add(u.id)); labels.add(t); continue; }
      const h = hs.find((x) => x.handle.toLowerCase() === t);
      if (h) { ids.add(h.id); labels.add(t); }
    }
    ids.delete(senderId);
    return labels.size ? { mentions: [...labels], mentionIds: [...ids] } : null;
  }
  const setMentions = (m, c) => {
    const r = resolveMentions(c, m.text, m.userId);
    if (r) Object.assign(m, r); else { delete m.mentions; delete m.mentionIds; }
  };

  function sys(c, text) { db.messages.push({ id: newId(), chatId: c.id, userId: null, kind: 'system', text, media: [], at: now() }); }
  const lastRead = (u, cid) => ((db.reads[u.id] || {})[cid]) || '';
  const nameOf = (id) => (db.users.find((x) => x.id === id) || {}).name || 'Someone';

  function visibleChats(u) {
    if (isTeam(u)) db.users.filter((x) => x.role === 'owner' && x.active !== false).forEach((o) => ownerChat(o.id));
    if (u.role === 'owner') ownerChat(u.id);
    const ownerActive = (c) => c.type !== 'owner' || (db.users.find((x) => x.id === c.ownerId) || {}).active !== false;
    return db.chats.filter((c) => ownerActive(c) && canSee(u, c));
  }

  // What a person sees in a chat: not removed by the ranch, not from someone they blocked, not a message they reported
  const blockedBy = (u) => db.blocks[u.id] || [];
  const reportedBy = (u) => new Set(db.reports.filter((x) => x.byUserId === u.id).map((x) => x.messageId));
  const shownTo = (u) => {
    const blocked = blockedBy(u), reported = reportedBy(u);
    return (m) => !m.removedAt && !(m.userId && blocked.includes(m.userId)) && !reported.has(m.id) && !(m.hiddenFor || []).includes(u.id);
  };

  function chatOut(u, c) {
    const msgs = db.messages.filter((m) => m.chatId === c.id).filter(shownTo(u));
    const last = msgs[msgs.length - 1];
    const seen = lastRead(u, c.id);
    return {
      id: c.id, type: c.type, key: c.key, title: titleFor(u, c), ownerId: isStaff(u) ? c.ownerId : undefined,
      members: c.type === 'group' ? (c.members || []).map((id) => ({ id, name: nameOf(id) }))
        : c.type === 'channel' ? channelMembers(c).map((x) => ({ id: x.id, name: x.name })) : undefined,
      memberCount: membersOf(c).length,
      about: c.type === 'channel' ? CHANNELS.find((ch) => ch.key === c.key).about : undefined,
      canManage: canManage(u, c), canManagePeople: canManagePeople(u, c), canModerate: canModerate(u),
      last: last ? { text: snippet(last), at: last.at, by: last.userId === u.id ? 'You' : last.userId ? nameOf(last.userId) : '' } : null,
      unread: msgs.filter((m) => m.userId !== u.id && m.at > seen && m.kind !== 'system').length,
      mentioned: msgs.some((m) => m.userId !== u.id && m.at > seen && !m.deletedAt && (m.mentionIds || []).includes(u.id)),
    };
  }

  // One line for a message: the chat list, quotes, the menu
  function snippet(m) {
    if (m.deletedAt) return 'Message deleted';
    if (m.text) return m.text.slice(0, 140);
    const f = (m.media || [])[0];
    return !f ? '' : f.type === 'file' ? `📎 ${f.name || 'File'}` : f.type === 'video' ? '🎥 Video' : '📷 Photo';
  }
  const mediaOut = (x) => ({ type: x.type, url: `/api/ranch/chat-media/${x.file}`, ...(x.type === 'file' ? { name: x.name || 'File', size: x.size || 0 } : {}) });
  function quoteOut(id) {
    const q = id && db.messages.find((x) => x.id === id);
    if (!q) return null;
    const img = !q.deletedAt && (q.media || []).find((x) => x.type === 'image');
    return { id: q.id, by: q.userId ? nameOf(q.userId) : 'Winning Ranch', text: snippet(q), img: img ? `/api/ranch/chat-media/${img.file}` : null };
  }

  const msgOut = (u, m) => (m.deletedAt ? {
    id: m.id, at: m.at, mine: m.userId === u.id, by: nameOf(m.userId), byId: m.userId || undefined, deleted: true, text: '', media: [],
  } : {
    id: m.id, text: m.text, at: m.at, mine: m.userId === u.id, by: nameOf(m.userId), byId: m.userId || undefined,
    staff: isStaff(db.users.find((x) => x.id === m.userId)),
    media: (m.media || []).map(mediaOut),
    ...(m.replyTo ? { replyTo: quoteOut(m.replyTo) } : {}),
    ...(m.reactions && m.reactions.length ? { reactions: m.reactions.map((x) => ({ uid: x.uid, name: nameOf(x.uid), e: x.e })) } : {}),
    ...(m.editedAt ? { editedAt: m.editedAt } : {}),
    ...(m.mentions ? { mentions: m.mentions, mentionsMe: (m.mentionIds || []).includes(u.id) } : {}),
    ...(m.kind === 'system' ? { kind: 'system' } : {}),
    ...(m.kind === 'sign-request' ? {
      kind: 'sign-request',
      docs: (m.requestIds || []).map((id) => (db.signRequests || []).find((q) => q.id === id)).filter(Boolean)
        .map((q) => ({ id: q.docId, title: docTitle(q.docId), status: q.status })),
    } : {}),
  });

  // Photos, videos and documents (PDF, Word, Excel, CSV, text)
  const MEDIA_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
  const DOC_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf', '.pages', '.numbers'];
  const docExt = (f) => { const e = path.extname(f.originalname || '').toLowerCase(); return DOC_EXT.includes(e) ? e : ''; };
  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(uploads, 'private'),
      filename: (_q, f, cb) => cb(null, newId() + (MEDIA_EXT[f.mimetype] || docExt(f))),
    }),
    limits: { fileSize: 150 * 1024 * 1024, files: 6 },
    fileFilter: (_q, f, cb) => cb(null, !!MEDIA_EXT[f.mimetype] || /^image\//.test(f.mimetype) || !!docExt(f)),
  }).array('files', 6);
  const mediaOf = (f) => (/^video\//.test(f.mimetype) ? { file: f.filename, type: 'video' }
    : /^image\//.test(f.mimetype) ? { file: f.filename, type: 'image' }
      : { file: f.filename, type: 'file', name: path.basename(String(f.originalname || 'File')).slice(0, 120), size: f.size, mime: f.mimetype });

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
  const people = (u) => db.users.filter((x) => x.active !== false && !x.demo && x.id !== u.id && (x.role === 'owner' || isTeam(x)));

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

  // People in a chat: who is in it, and (for managers) who can be added
  const TAG = (x) => (x.role === 'owner' ? 'owner' : ({ hand: 'ranch hand', manager: 'ranch manager', office: 'office', lessons: 'lesson program' }[x.position || 'office']));
  function peopleOut(u, c) {
    const members = membersOf(c);
    const inIt = new Set(members.map((x) => x.id));
    const person = (x) => ({ id: x.id, name: x.name, tag: TAG(x), you: x.id === u.id || undefined, added: extraOf(c).includes(x.id) || undefined, owner: c.ownerId === x.id || undefined });
    const manage = canManagePeople(u, c);
    const note = c.type === 'channel' && c.key !== 'management' ? `${CHANNELS.find((ch) => ch.key === c.key).about} are in this chat automatically. Removing someone takes them out of this chat only.`
      : c.type === 'owner' ? 'The owner and the ranch team. Add a co-owner, a trainer or anyone who should follow this horse.'
        : c.type === 'dm' ? 'Adding someone turns this conversation into a group.' : '';
    return {
      title: titleFor(u, c), type: c.type, note, canManage: manage,
      canRename: c.type === 'group' && canManage(u, c), canLeave: c.type === 'group' || (c.type === 'channel' && c.key === 'management' && isManagement(u)),
      members: members.map(person).sort((a, b) => a.name.localeCompare(b.name)),
      others: manage ? db.users.filter((x) => x.active !== false && !x.demo && !inIt.has(x.id) && (x.role === 'owner' || isTeam(x))
        && !(c.type === 'channel' && c.key === 'management' && x.role === 'owner')).map(person).sort((a, b) => a.name.localeCompare(b.name)) : [],
    };
  }

  // ---------------------------------------------------------------- link previews (like the Winning App and Messenger)
  // Reads the page's sharing tags (Open Graph / Twitter, the ones Facebook and WhatsApp use): title, description,
  // image, site. Only public http(s) addresses (no private or internal network, checked on every redirect),
  // 6 seconds, the first 600 KB, cached 12 hours.
  const LP_CACHE = new Map();
  const dnsP = require('dns').promises, netMod = require('net');
  function privateIp(ip) {
    if (netMod.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
    const x = ip.toLowerCase();
    return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
  }
  async function publicUrl(u) {
    let url;
    try { url = new URL(u); } catch (_) { return null; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return null;
    try { const addrs = await dnsP.lookup(url.hostname, { all: true }); if (!addrs.length || addrs.some((a) => privateIp(a.address))) return null; } catch (_) { return null; }
    return url;
  }
  const decodeEnt = (t) => String(t || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  async function linkPreview(raw) {
    const key = String(raw).slice(0, 2000);
    const hit = LP_CACHE.get(key);
    if (hit && hit.exp > Date.now()) return hit.data;
    let url = await publicUrl(key), html = '', finalUrl = key;
    for (let hop = 0; url && hop < 4; hop++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      try {
        // Facebook's own preview robot: Facebook, Instagram and most sites hand it the sharing tags
        const r = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.8' } });
        if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = await publicUrl(new URL(r.headers.get('location'), url).toString()); clearTimeout(t); continue; }
        finalUrl = url.toString();
        if (r.ok && /html/i.test(r.headers.get('content-type') || '')) {
          const reader = r.body.getReader();
          const chunks = [];
          let n = 0;
          while (n < 600 * 1024) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
          try { ctl.abort(); } catch (_) { /* done reading */ }
          html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
        }
      } catch (_) { /* unreachable: no card */ } finally { clearTimeout(t); }
      break;
    }
    const meta = (names) => {
      for (const nm of names) {
        const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${nm}["'][^>]*>`, 'i'));
        if (tag) { const c = tag[0].match(/content=["']([^"']*)["']/i); if (c && c[1].trim()) return decodeEnt(c[1]); }
      }
      return '';
    };
    let host = '';
    try { host = new URL(finalUrl).hostname.replace(/^www\./, ''); } catch (_) { /* keep empty */ }
    let image = meta(['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
    try { if (image) image = new URL(image, finalUrl).toString(); } catch (_) { image = ''; }
    if (image && !/^https:/i.test(image)) image = ''; // the app is https: no insecure images
    const video = !!meta(['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player']) || /^video/i.test(meta(['og:type']));
    const data = {
      url: key, title: (meta(['og:title', 'twitter:title']) || decodeEnt((html.match(/<title[^>]*>([^<]{1,300})<\/title>/i) || [])[1] || '')).slice(0, 200),
      description: meta(['og:description', 'twitter:description', 'description']).slice(0, 300), image, video, site: (meta(['og:site_name']) || host).slice(0, 80), host,
    };
    if (LP_CACHE.size > 800) LP_CACHE.delete(LP_CACHE.keys().next().value);
    LP_CACHE.set(key, { data, exp: Date.now() + (data.title || data.image ? 12 : 1) * 3600 * 1000 });
    return data;
  }
  r.get('/link-preview', auth.requireUser, async (req, res) => {
    const url = String(req.query.url || '').trim();
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return res.status(400).json({ error: 'Bad link.' });
    try { res.set('Cache-Control', 'private, max-age=3600'); res.json(await linkPreview(url)); } catch (_) { res.json({ url, title: '', description: '', image: '', site: '' }); }
  });

  // Who can be @mentioned here (the composer's suggestions)
  r.get('/chats/:id/mentions', auth.requireUser, (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    if (!canSee(req.user, c)) return res.status(404).json({ error: 'Chat not found.' });
    const hs = handlesFor(c).filter((h) => h.id !== req.user.id).sort((a, b) => a.name.localeCompare(b.name));
    const managers = membersOf(c).filter((u) => u.role === 'staff' && u.position === 'manager');
    res.json({ people: [{ handle: 'everyone', name: 'Everyone in this chat', tag: `${membersOf(c).length} people` },
      ...(managers.length ? [{ handle: 'barnmanager', name: 'Barn manager', tag: managers.map((u) => u.name).join(', ') }] : []), ...hs.map(({ handle, name, tag }) => ({ handle, name, tag }))] });
  });

  r.get('/chats/:id/people', auth.requireUser, (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    if (!canSee(req.user, c)) return res.status(404).json({ error: 'Chat not found.' });
    res.json(peopleOut(req.user, c));
  });

  r.post('/chats/:id/people', auth.requireUser, async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    if (!canSee(req.user, c)) return res.status(404).json({ error: 'Chat not found.' });
    if (!canManagePeople(req.user, c)) return res.status(403).json({ error: 'Ask a manager or the office to add or remove people here.' });
    const b = req.body || {};
    const ids = (k) => [...new Set((Array.isArray(b[k]) ? b[k] : []).map(String))];
    const user = (id) => db.users.find((x) => x.id === id && x.active !== false && !x.demo);
    const added = [], removed = [];
    for (const id of ids('add')) {
      const x = user(id);
      if (!x || canSee(x, c) || !(x.role === 'owner' || isTeam(x))) continue;
      if (c.type === 'channel' && c.key === 'management' && x.role === 'owner') return res.status(400).json({ error: 'Barn Management is for the team.' });
      if (c.type === 'dm') Object.assign(c, { type: 'group', title: [...c.members, x.id].map((y) => nameOf(y).split(' ')[0]).join(', ').slice(0, 60), createdBy: req.user.id });
      if (c.type === 'group' || (c.type === 'channel' && c.key === 'management')) c.members.push(x.id);
      else { c.excluded = excludedOf(c).filter((y) => y !== x.id); if (!canSee(x, c)) c.extra = [...extraOf(c), x.id]; }
      added.push(x.id);
    }
    for (const id of ids('remove')) {
      const x = db.users.find((y) => y.id === id);
      if (!x || !canSee(x, c)) continue;
      if (c.type === 'owner' && c.ownerId === x.id) return res.status(400).json({ error: 'The owner always stays in their chat.' });
      if (c.type === 'dm') return res.status(400).json({ error: 'Add someone first to make this a group.' });
      if (c.type === 'group' || (c.type === 'channel' && c.key === 'management')) {
        if (c.members.length === 1) return res.status(400).json({ error: 'A chat needs at least one person.' });
        c.members = c.members.filter((y) => y !== x.id);
      } else { c.extra = extraOf(c).filter((y) => y !== x.id); if (canSee(x, c)) c.excluded = [...excludedOf(c), x.id]; }
      removed.push(x.id);
    }
    if (!added.length && !removed.length) return res.status(400).json({ error: 'Nothing to change.' });
    if (added.length) sys(c, `${req.user.name} added ${added.map(nameOf).join(', ')}`);
    if (removed.length) sys(c, `${req.user.name} removed ${removed.map(nameOf).join(', ')}`);
    await store.save();
    res.json(peopleOut(req.user, c));
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
    // Always the latest 300: the app compares them with what it shows, so nothing is missed or shown twice
    // (?after= still works for older versions of the app)
    const after = typeof req.query.after === 'string' ? req.query.after : '';
    const msgs = db.messages.filter((m) => m.chatId === c.id && m.at > after).filter(shownTo(req.user)).slice(-300);
    // When each person last opened the chat, for "seen by"
    const seen = membersOf(c).filter((x) => x.id !== req.user.id).map((x) => ({ id: x.id, name: x.name, at: lastRead(x, c.id) })).filter((x) => x.at);
    res.json({ chat: chatOut(req.user, c), messages: msgs.map((m) => msgOut(req.user, m)), seen });
  });

  r.post('/chats/:id/messages', auth.requireUser, (req, res, next) => upload(req, res, (err) => (err ? res.status(400).json({ error: 'That file is too big (150 MB max) or not a photo, video or document.' }) : next())), async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    const files = req.files || [];
    if (!canSee(req.user, c)) { files.forEach((f) => fs.promises.unlink(f.path).catch(() => {})); return res.status(404).json({ error: 'Chat not found.' }); }
    const b = req.body || {};
    // Sent again after a dropped connection: the first one got here, so don't post it twice
    const clientKey = str(b.clientKey, 60);
    const dup = clientKey && db.messages.find((x) => x.clientKey === clientKey && x.userId === req.user.id && x.chatId === c.id);
    if (dup) { files.forEach((f) => fs.promises.unlink(f.path).catch(() => {})); return res.status(201).json({ message: msgOut(req.user, dup) }); }
    const text = str(b.text, 4000);
    if (!text && !files.length) return res.status(400).json({ error: 'Write a message or add a photo.' });
    const replyTo = str(b.replyTo, 40);
    const m = { id: newId(), chatId: c.id, userId: req.user.id, text, media: files.map(mediaOf), at: now(),
      ...(replyTo && db.messages.some((x) => x.id === replyTo && x.chatId === c.id) ? { replyTo } : {}), ...(clientKey ? { clientKey } : {}) };
    setMentions(m, c);
    db.messages.push(m);
    (db.reads[req.user.id] = db.reads[req.user.id] || {})[c.id] = m.at;
    await store.save();
    notifyMessage(c, m, req.user);
    res.status(201).json({ message: msgOut(req.user, m) });
  });

  // ---------------------------------------------------------------- edit, remove, react (from the message's menu)
  const findMsg = (req) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    const m = canSee(req.user, c) && db.messages.find((x) => x.id === req.params.mid && x.chatId === c.id && !x.removedAt);
    return m && m.kind !== 'system' ? m : null;
  };

  r.patch('/chats/:id/messages/:mid', auth.requireUser, async (req, res) => {
    const m = findMsg(req);
    if (!m || m.deletedAt) return res.status(404).json({ error: 'Message not found.' });
    if (m.userId !== req.user.id || m.kind === 'sign-request') return res.status(403).json({ error: 'You can only edit your own messages.' });
    const text = str(req.body && req.body.text, 4000);
    if (!text && !(m.media || []).length) return res.status(400).json({ error: 'Write something, or remove the message instead.' });
    if (text !== m.text) { Object.assign(m, { text, editedAt: now() }); setMentions(m, db.chats.find((x) => x.id === m.chatId)); }
    await store.save();
    res.json({ message: msgOut(req.user, m) });
  });

  // for=all: gone for everyone (your own, or anyone's for managers and the office); for=me: only you stop seeing it
  r.delete('/chats/:id/messages/:mid', auth.requireUser, async (req, res) => {
    const m = findMsg(req);
    if (!m) return res.status(404).json({ error: 'Message not found.' });
    const forAll = (req.query.for || (req.body && req.body.for)) === 'all';
    if (forAll) {
      if (m.userId !== req.user.id && !canModerate(req.user)) return res.status(403).json({ error: 'You can only remove your own messages for everyone.' });
      if (!m.deletedAt) Object.assign(m, { deletedAt: now(), deletedBy: req.user.name });
    } else m.hiddenFor = [...new Set([...(m.hiddenFor || []), req.user.id])];
    await store.save();
    res.status(204).end();
  });

  // One reaction per person; the same one again takes it back
  const REACTIONS = ['❤️', '😆', '😮', '😢', '😠', '👍', '🔥'];
  r.post('/chats/:id/messages/:mid/react', auth.requireUser, async (req, res) => {
    const m = findMsg(req);
    if (!m || m.deletedAt) return res.status(404).json({ error: 'Message not found.' });
    const e = req.body && req.body.e;
    if (!REACTIONS.includes(e)) return res.status(400).json({ error: 'Pick one of the reactions.' });
    const mine = (m.reactions || []).find((x) => x.uid === req.user.id);
    m.reactions = (m.reactions || []).filter((x) => x.uid !== req.user.id);
    if (!mine || mine.e !== e) m.reactions.push({ uid: req.user.id, e, at: now() });
    await store.save();
    res.json({ message: msgOut(req.user, m) });
  });

  // ---------------------------------------------------------------- report a message, block a person
  // Reporting hides the message for the reporter right away; Barn Management sees it in the app and can remove it.
  const REPORT_REASONS = ['Spam', 'Harassment or hate', 'Inappropriate photo or video', 'Something else'];
  r.post('/chats/:id/messages/:mid/report', auth.requireUser, async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    const m = canSee(req.user, c) && db.messages.find((x) => x.id === req.params.mid && x.chatId === c.id && !x.removedAt);
    if (!m || m.kind === 'system') return res.status(404).json({ error: 'Message not found.' });
    if (m.userId === req.user.id) return res.status(400).json({ error: 'That’s your own message.' });
    const b = req.body || {};
    const reason = REPORT_REASONS.includes(b.reason) ? b.reason : 'Something else';
    if (!db.reports.some((x) => x.messageId === m.id && x.byUserId === req.user.id)) {
      db.reports.push({ id: newId(), messageId: m.id, chatId: c.id, byUserId: req.user.id, aboutUserId: m.userId, reason, details: str(b.details, 500), at: now(), status: 'open' });
      await store.save();
    }
    res.status(201).json({ ok: true });
  });

  r.get('/blocks', auth.requireUser, (req, res) => res.json({ blocked: blockedBy(req.user).map((id) => ({ id, name: nameOf(id) })) }));
  r.post('/blocks', auth.requireUser, async (req, res) => {
    const id = str(req.body && req.body.userId, 40);
    if (!id || id === req.user.id || !db.users.some((x) => x.id === id)) return res.status(400).json({ error: 'Pick someone to block.' });
    db.blocks[req.user.id] = [...new Set([...blockedBy(req.user), id])];
    await store.save();
    res.status(201).json({ ok: true });
  });
  r.delete('/blocks/:userId', auth.requireUser, async (req, res) => {
    db.blocks[req.user.id] = blockedBy(req.user).filter((id) => id !== req.params.userId);
    await store.save();
    res.json({ ok: true });
  });

  // Barn Management: open reports, then remove the message for everyone or keep it
  const openReports = () => db.reports.filter((x) => x.status === 'open');
  r.get('/reports', auth.requireUser, (req, res) => {
    if (!isLead(req.user)) return res.status(403).json({ error: 'Only managers see reports.' });
    res.json({ reports: openReports().map((x) => {
      const m = db.messages.find((y) => y.id === x.messageId) || {};
      const c = db.chats.find((y) => y.id === x.chatId);
      return { id: x.id, reason: x.reason, details: x.details, at: x.at, by: nameOf(x.byUserId), about: nameOf(x.aboutUserId), chat: c ? titleFor(req.user, c) : '', chatId: x.chatId,
        text: m.text || '', media: (m.media || []).map((y) => ({ type: y.type, url: `/api/ranch/chat-media/${y.file}` })), removed: !!m.removedAt };
    }) });
  });
  r.post('/reports/:id/resolve', auth.requireUser, async (req, res) => {
    if (!isLead(req.user)) return res.status(403).json({ error: 'Only managers resolve reports.' });
    const x = db.reports.find((y) => y.id === req.params.id && y.status === 'open');
    if (!x) return res.status(404).json({ error: 'That report was already handled.' });
    const remove = !!(req.body && req.body.remove);
    const m = db.messages.find((y) => y.id === x.messageId);
    if (remove && m && !m.removedAt) Object.assign(m, { removedAt: now(), removedBy: req.user.name });
    // Every report on the same message is handled together
    db.reports.filter((y) => y.messageId === x.messageId && y.status === 'open').forEach((y) => Object.assign(y, { status: remove ? 'removed' : 'kept', resolvedAt: now(), resolvedBy: req.user.name }));
    await store.save();
    res.json({ ok: true });
  });

  r.post('/chats/:id/read', auth.requireUser, async (req, res) => {
    const c = db.chats.find((x) => x.id === req.params.id);
    if (!canSee(req.user, c)) return res.status(404).json({ error: 'Chat not found.' });
    const latest = (db.messages.filter((m) => m.chatId === c.id).pop() || {}).at || '';
    const reads = (db.reads[req.user.id] = db.reads[req.user.id] || {});
    if (!reads[c.id] || reads[c.id] < latest) { reads[c.id] = now(); await store.save(); if (push) push.syncBadge(req.user).catch(() => {}); }
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- phone notifications (the store app)
  // Everyone else who sees the chat gets a notification with the neigh: "Gabi: stall 4 needs water"; a message that
  // @mentions them says so in the title. Not to people who blocked the sender, and not to the lesson program.
  function notifyMessage(c, m, sender) {
    if (!push || !push.enabled()) return;
    const text = snippet(m) || 'New message';
    for (const u of membersOf(c)) {
      if (u.id === sender.id || (db.blocks[u.id] || []).includes(sender.id)) continue;
      const mention = (m.mentionIds || []).includes(u.id);
      const title = titleFor(u, c);
      push.send(u.id, mention
        ? { title: `${sender.name} mentioned you`, body: `${title}: ${text}`, data: { type: 'mention', chatId: c.id } }
        : { title, body: c.type === 'dm' || title === sender.name ? text : `${sender.name}: ${text}`, data: { type: 'message', chatId: c.id } }).catch(() => {});
    }
  }
  // The number on the app icon: unread messages in the chats this person sees
  function unreadTotal(u) {
    if (!u || (isStaff(u) && !isTeam(u))) return 0;
    let n = 0;
    for (const c of visibleChats(u)) {
      const seen = lastRead(u, c.id), show = shownTo(u);
      n += db.messages.filter((m) => m.chatId === c.id && m.userId !== u.id && m.at > seen && m.kind !== 'system' && !m.deletedAt && show(m)).length;
    }
    return n;
  }
  r.post('/push/register', auth.requireUser, (req, res) => {
    if (!push || !push.register(req.user, req.body && req.body.token, req.body && req.body.platform)) return res.status(400).json({ error: 'No token.' });
    push.syncBadge(req.user, true).catch(() => {});
    res.json({ ok: true, enabled: push.enabled() });
  });
  r.post('/push/unregister', auth.requireUser, (req, res) => { if (push) push.unregister(req.user, String((req.body && req.body.token) || '')); res.json({ ok: true }); });
  r.post('/push/badge', auth.requireUser, (req, res) => { if (push) push.syncBadge(req.user, true).catch(() => {}); res.json({ ok: true }); });

  r.get('/chat-media/:file', auth.requireUser, (req, res) => {
    const file = path.basename(req.params.file);
    const m = db.messages.find((x) => x.media.some((y) => y.file === file));
    const c = m && db.chats.find((x) => x.id === m.chatId);
    if (!canSee(req.user, c) || m.deletedAt) return res.status(404).end();
    const doc = m.media.find((y) => y.file === file && y.type === 'file');
    if (doc) res.set('Content-Disposition', `inline; filename="${String(doc.name || 'file').replace(/[^\w .()-]/g, '_')}"`);
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
  const photoOf = (h) => (h.photo ? `/api/ranch/horses/${h.id}/photo?v=${encodeURIComponent(h.photoAt || '')}` : null);
  r.get('/app/home', auth.requireUser, (req, res) => {
    const u = req.user;
    const unread = visibleChats(u).reduce((t, c) => t + chatOut(u, c).unread, 0);
    const seenUpdates = (db.reads[u.id] || {}).updates || '';
    const myHorses = db.horses.filter((h) => h.active !== false && (isStaff(u) || h.ownerId === u.id));
    const horses = (u.role === 'owner' ? myHorses : []).map((h) => {
      const ups = db.updates.filter((x) => x.horseId === h.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const img = ups.find((x) => x.media.some((m) => m.type === 'image'));
      return {
        id: h.id, name: h.name, stall: (stallById(stallOfHorse(h)) || {}).name || '', photo: photoOf(h),
        latest: ups[0] ? { caption: ups[0].caption, at: ups[0].createdAt, by: ups[0].authorName } : null,
        cover: img ? `/api/ranch/media/${img.media.find((m) => m.type === 'image').file}` : null,
        fresh: ups.filter((x) => x.createdAt > seenUpdates).length,
      };
    });
    const toSign = (db.signRequests || []).filter((q) => q.userId === u.id && q.status === 'pending').length;
    const out = { user: auth.publicUser(u), unread, horses, toSign };
    // The team's Home: every horse at the ranch, with its picture, to open its page (care notes and updates)
    if (isTeam(u)) out.ranchHorses = db.horses.filter((h) => h.active !== false && !h.demo).sort((a, b) => (!!b.photo - !!a.photo) || a.name.localeCompare(b.name)) // the ones with a picture first
      .map((h) => ({ id: h.id, name: h.name, stall: (stallById(stallOfHorse(h)) || {}).name || '', photo: photoOf(h) }));
    if (isStaff(u)) {
      const pos = u.position || 'office';
      const shift = (db.shifts || []).find((s) => !s.deletedAt && s.userId === u.id && !s.out);
      out.shift = pos === 'office' ? null : shift ? { since: shift.in.at, onBreak: shift.breaks.some((b) => !b.end), worked: H.workedMinutes(shift), done: H.checklistStats(shift) } : false;
      out.horsesOnRanch = db.horses.filter((h) => h.active !== false).length;
      if (pos !== 'hand') {
        out.pendingBookings = db.bookings.filter((b) => b.status === 'pending').length;
        if (pos === 'office' || u.master) out.waiversToCountersign = (db.waivers || []).filter((w) => !w.deletedAt && !w.countersign).length; // signed waivers: office only
        out.onClock = (db.shifts || []).filter((s) => !s.deletedAt && !s.out).map((s) => nameOf(s.userId));
      }
      if (pos !== 'lessons' && scheduleSummary) Object.assign(out, scheduleSummary(u)); // next shifts, take/swap answers and requests
      if (isLead(u)) out.reports = openReports().length;
    }
    res.json(out);
  });

  r.post('/app/seen-updates', auth.requireUser, async (req, res) => {
    (db.reads[req.user.id] = db.reads[req.user.id] || {}).updates = now();
    await store.save();
    res.json({ ok: true });
  });

  return { postSignRequest, unreadTotal };
};
