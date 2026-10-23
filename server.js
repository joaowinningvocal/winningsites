/* Winning Ranch: the web-app, the website and the ranch API in one service.
   /                 the Winning Ranch app (owners and the ranch team log in here)
   /home.html ...    the website: stall map, booking, waivers and online signing, contact
   /admin/           the full dashboard for the office and the ranch manager
   /api/ranch/*      everything the app, the website and the dashboard use (routes/)
   Data lives in DATA_DIR (ranch.json + uploads/). On Railway, mount a Volume at /data
   and set DATA_DIR=/data so nothing is lost on redeploys. */
const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '1mb' }));

// The API (app, website and dashboard)
app.use('/api/ranch', require('./routes/ranch')({ dataDir: DATA_DIR }));

// Old addresses from the preview days keep working
app.get(['/ranch', '/ranch/', '/ranch/app', '/ranch/app/', '/ranch/portal', '/ranch/portal/', '/portal', '/portal/'], (_req, res) => res.redirect(301, '/'));
app.get('/ranch/index.html', (_req, res) => res.redirect(301, '/home.html'));
app.get(/^\/ranch\/(.+)$/, (req, res) => res.redirect(301, '/' + req.params[0] + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
app.get(['/review', '/review/'], (_req, res) => res.redirect(301, '/'));

// Pages and files. HTML is never cached so changes show up right away.
app.use(express.static(PUBLIC, {
  extensions: ['html'],
  setHeaders: (res, file) => { if (file.endsWith('.html') || file.endsWith('.webmanifest')) res.set('Cache-Control', 'no-cache'); },
}));

app.use((req, res) => (req.path.startsWith('/api/') ? res.status(404).json({ error: 'Not found.' }) : res.status(404).sendFile(path.join(PUBLIC, 'home.html'))));

app.listen(PORT, () => console.log(`Winning Ranch on :${PORT} (data: ${DATA_DIR})`));
