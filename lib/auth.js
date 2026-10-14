/* Accounts and sessions for the ranch: staff (post updates, manage bookings)
   and owners (see their horses). Passwords use scrypt; sessions are random
   tokens kept in an HttpOnly cookie, stored hashed. */
const crypto = require('crypto');

const COOKIE = 'wr_session';
const SESSION_DAYS = 30;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function createAuth(store) {
  const db = store.data;

  function publicUser(u) {
    if (!u) return null;
    return { id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role, active: u.active !== false, hasPassword: !!u.password };
  }

  function startSession(req, res, user) {
    const t = token();
    const now = Date.now();
    db.sessions = db.sessions.filter((s) => s.expiresAt > now); // drop expired
    db.sessions.push({ id: sha256(t), userId: user.id, createdAt: now, expiresAt: now + SESSION_DAYS * 864e5 });
    store.save();
    res.cookie(COOKIE, t, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: SESSION_DAYS * 864e5,
      path: '/',
    });
  }

  function endSession(req, res) {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (t) {
      const id = sha256(t);
      db.sessions = db.sessions.filter((s) => s.id !== id);
      store.save();
    }
    res.clearCookie(COOKIE, { path: '/' });
  }

  // Attaches req.user when a valid session cookie is present
  function loadUser(req, _res, next) {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (t) {
      const s = db.sessions.find((x) => x.id === sha256(t) && x.expiresAt > Date.now());
      const u = s && db.users.find((x) => x.id === s.userId && x.active !== false);
      if (u) req.user = u;
    }
    next();
  }

  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Log in to continue.' }));
  const requireStaff = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Log in to continue.' });
    if (req.user.role !== 'staff') return res.status(403).json({ error: 'Staff only.' });
    next();
  };

  // One-time links used instead of email: staff copies the link and texts it.
  function createInvite(user) {
    const t = token(24);
    db.invites = db.invites.filter((i) => i.userId !== user.id);
    db.invites.push({ id: sha256(t), userId: user.id, expiresAt: Date.now() + 14 * 864e5 });
    store.save();
    return t;
  }

  function findInvite(t) {
    const inv = db.invites.find((i) => i.id === sha256(t) && i.expiresAt > Date.now());
    const user = inv && db.users.find((u) => u.id === inv.userId && u.active !== false);
    return user ? { inv, user } : null;
  }

  function useInvite(inv) {
    db.invites = db.invites.filter((i) => i !== inv);
  }

  return { publicUser, startSession, endSession, loadUser, requireUser, requireStaff, createInvite, findInvite, useInvite, hashPassword, verifyPassword };
}

// Simple in-memory limiter: max `limit` hits per key per window
function rateLimit({ limit, windowMs, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip + ':' + req.baseUrl + req.path;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= limit) return res.status(429).json({ error: message || 'Too many tries. Wait a few minutes and try again.' });
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

module.exports = { createAuth, rateLimit, hashPassword, verifyPassword, sha256 };
