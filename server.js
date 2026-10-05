/* Winning sites — preview + review server
   - /ranch/, /realty/ ...   the site drafts (static files in /sites/<id>)
   - /review/                the review tool (switch sites, leave pins/arrows/boxes + comments)
   - /api/*                  comments, export, contact form
   Comments are saved to DATA_DIR/review.json. On Railway, mount a Volume at /data
   and set DATA_DIR=/data so they survive redeploys. */

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PASSWORD = process.env.REVIEW_PASSWORD || '';
const CONTACT_WEBHOOK_URL = process.env.CONTACT_WEBHOOK_URL || '';
const SITES = require('./sites.config.json');
const SITE_IDS = new Set(SITES.map((s) => s.id));

// ---------------------------------------------------------------- storage
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'review.json');
let db = { seq: {}, annotations: [], contacts: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (_) { /* first run */ }

let saving = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(db, null, 1);
  saving = saving
    .then(() => fsp.writeFile(DB_FILE + '.tmp', snapshot))
    .then(() => fsp.rename(DB_FILE + '.tmp', DB_FILE))
    .catch((err) => console.error('[store] save failed:', err));
  return saving;
}

const newId = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Optional password for the whole preview (Basic auth, any username)
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
app.use((req, res, next) => {
  if (!PASSWORD) return next();
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && value) {
    const decoded = Buffer.from(value, 'base64').toString();
    if (sameSecret(decoded.slice(decoded.indexOf(':') + 1), PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Winning site review", charset="UTF-8"');
  res.status(401).send('Password required');
});

app.use(express.json({ limit: '200kb' }));

// ---------------------------------------------------------------- sites
const OVERLAY_TAG = '<script src="/review/overlay.js" defer></script>';

for (const site of SITES) {
  const dir = path.join(__dirname, 'sites', site.id);
  const base = '/' + site.id;

  // /ranch -> /ranch/ so relative asset paths resolve
  app.use((req, res, next) => {
    if (req.path === base) {
      const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return res.redirect(301, base + '/' + q);
    }
    next();
  });

  // HTML pages get the review overlay script injected (it stays inert outside /review)
  app.use(base, async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch (_) { return res.status(400).end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    else if (!path.extname(rel)) rel += '.html';
    if (!rel.endsWith('.html')) return next();
    const file = path.join(dir, path.normalize(rel));
    if (!file.startsWith(dir + path.sep)) return res.status(400).end();
    try {
      let html = await fsp.readFile(file, 'utf8');
      html = html.includes('</body>') ? html.replace('</body>', OVERLAY_TAG + '\n</body>') : html + OVERLAY_TAG;
      res.type('html').set('Cache-Control', 'no-cache').send(html);
    } catch (_) { next(); }
  }, express.static(dir, { maxAge: 0 }));
}

// ---------------------------------------------------------------- review tool
app.use('/review', express.static(path.join(__dirname, 'review'), { maxAge: 0 }));
app.get('/', (_req, res) => res.redirect('/review/'));

// ---------------------------------------------------------------- API: config
app.get('/api/config', (_req, res) => res.json({ sites: SITES }));

// ---------------------------------------------------------------- API: annotations
function cleanPoint(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    sel: str(p.sel, 800),
    fx: Math.max(-5, Math.min(5, num(p.fx))),
    fy: Math.max(-5, Math.min(5, num(p.fy))),
    x: Math.round(num(p.x)),
    y: Math.round(num(p.y)),
  };
}

app.get('/api/annotations', (req, res) => {
  const site = str(req.query.site, 40);
  res.json(site ? db.annotations.filter((a) => a.site === site) : db.annotations);
});

app.post('/api/annotations', async (req, res) => {
  const b = req.body || {};
  const site = str(b.site, 40);
  const kind = ['pin', 'arrow', 'box'].includes(b.kind) ? b.kind : null;
  const page = str(b.page, 300) || '/';
  const text = str(b.text, 5000);
  const author = str(b.author, 60);
  const points = Array.isArray(b.points) ? b.points.slice(0, 2).map(cleanPoint).filter(Boolean) : [];
  if (!SITE_IDS.has(site)) return res.status(400).json({ error: 'Unknown site' });
  if (!kind) return res.status(400).json({ error: 'Unknown kind' });
  if (!text) return res.status(400).json({ error: 'Comment text is empty' });
  if (!author) return res.status(400).json({ error: 'Author name is missing' });
  if (points.length !== (kind === 'pin' ? 1 : 2)) return res.status(400).json({ error: 'Wrong number of points' });
  if (!page.startsWith('/')) return res.status(400).json({ error: 'Bad page path' });

  db.seq[site] = (db.seq[site] || 0) + 1;
  const a = {
    id: newId(),
    n: db.seq[site],
    site, page, kind, points, text, author,
    hint: str(b.hint, 200),
    device: ['desktop', 'tablet', 'mobile'].includes(b.device) ? b.device : 'desktop',
    viewport: { w: Math.round(num(b.viewport && b.viewport.w)), h: Math.round(num(b.viewport && b.viewport.h)) },
    status: 'open',
    replies: [],
    createdAt: now(),
    updatedAt: now(),
  };
  db.annotations.push(a);
  await persist();
  res.status(201).json(a);
});

app.patch('/api/annotations/:id', async (req, res) => {
  const a = db.annotations.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Comment not found' });
  const b = req.body || {};
  if (typeof b.text === 'string') {
    const text = str(b.text, 5000);
    if (!text) return res.status(400).json({ error: 'Comment text is empty' });
    a.text = text;
  }
  if (b.status === 'open' || b.status === 'resolved') {
    a.status = b.status;
    a.resolvedBy = b.status === 'resolved' ? str(b.by, 60) : undefined;
  }
  a.updatedAt = now();
  await persist();
  res.json(a);
});

app.delete('/api/annotations/:id', async (req, res) => {
  const i = db.annotations.findIndex((x) => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Comment not found' });
  db.annotations.splice(i, 1);
  await persist();
  res.status(204).end();
});

app.post('/api/annotations/:id/replies', async (req, res) => {
  const a = db.annotations.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Comment not found' });
  const text = str(req.body && req.body.text, 5000);
  const author = str(req.body && req.body.author, 60);
  if (!text || !author) return res.status(400).json({ error: 'Reply text and author are required' });
  a.replies.push({ id: newId(), author, text, createdAt: now() });
  a.updatedAt = now();
  await persist();
  res.status(201).json(a);
});

// Markdown export — paste it into Claude (or a ticket) to work through the changes
app.get('/api/export', (req, res) => {
  const siteId = str(req.query.site, 40);
  const status = req.query.status === 'all' ? 'all' : 'open';
  const site = SITES.find((s) => s.id === siteId);
  if (!site) return res.status(400).send('Unknown site');
  const items = db.annotations
    .filter((a) => a.site === siteId && (status === 'all' || a.status === 'open'))
    .sort((a, b) => (a.page === b.page ? a.n - b.n : a.page.localeCompare(b.page)));

  const pageTitle = (p) => (site.pages.find((x) => x.path === p) || {}).title || p;
  const kindName = { pin: 'Comment', arrow: 'Arrow', box: 'Highlighted area' };
  const day = (iso) => iso.slice(0, 10);
  const lines = [
    `# ${site.name}: review comments`,
    '',
    `Exported ${day(now())}. ${items.length} ${status === 'open' ? 'open ' : ''}comment${items.length === 1 ? '' : 's'}.`,
    '',
  ];
  let current = null;
  for (const a of items) {
    if (a.page !== current) {
      current = a.page;
      lines.push(`## ${pageTitle(a.page)} (\`/${siteId}${a.page === '/' ? '/' : a.page}\`)`, '');
    }
    lines.push(`### #${a.n} ${kindName[a.kind]}${a.status === 'resolved' ? ' (resolved)' : ''}`);
    lines.push(`- From ${a.author}, ${day(a.createdAt)}, seen on ${a.device}${a.viewport && a.viewport.w ? ` (${a.viewport.w}px wide)` : ''}`);
    if (a.hint) lines.push(`- Points at: ${a.hint}`);
    lines.push(`- Element: \`${a.points[a.points.length - 1].sel}\``);
    lines.push('', ...a.text.split('\n').map((l) => '> ' + l), '');
    if (a.replies.length) {
      lines.push('Replies:');
      for (const r of a.replies) lines.push(`- **${r.author}:** ${r.text.replace(/\n/g, ' ')}`);
      lines.push('');
    }
  }
  res.type('text/markdown; charset=utf-8');
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="${siteId}-review-${day(now())}.md"`);
  res.send(lines.join('\n'));
});

// ---------------------------------------------------------------- API: contact form
app.post('/api/contact', async (req, res) => {
  const b = req.body || {};
  const entry = {
    id: newId(),
    site: str(b.site, 40),
    firstName: str(b.firstName, 80),
    lastName: str(b.lastName, 80),
    phone: str(b.phone, 40),
    email: str(b.email, 160),
    topic: str(b.topic, 40),
    message: str(b.message, 5000),
    createdAt: now(),
  };
  if (!entry.firstName || !/^\S+@\S+\.\S+$/.test(entry.email)) return res.status(400).json({ error: 'Name and a valid email are required' });
  db.contacts.push(entry);
  await persist();
  if (CONTACT_WEBHOOK_URL) {
    fetch(CONTACT_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) })
      .catch((err) => console.error('[contact] webhook failed:', err.message));
  }
  res.status(201).json({ ok: true });
});

app.get('/api/contacts', (_req, res) => res.json(db.contacts.slice().reverse()));

app.listen(PORT, () => {
  console.log(`Review server on :${PORT}  (data: ${DB_FILE}${PASSWORD ? ', password on' : ', no password'})`);
});
