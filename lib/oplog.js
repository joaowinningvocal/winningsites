/* Keeps the last server log lines in memory so the ops API (/api/ranch/ops/logs) can show them
   without opening Railway. Login and invite links are hidden before a line is kept. */
const MAX = 800;
const lines = [];
const hide = (s) => String(s)
  .replace(/#\/invite\/[^\s"')]+/g, '#/invite/(hidden)')
  .replace(/(token|key|password|secret)=([^\s&"]+)/gi, '$1=(hidden)');

function keep(level, args) {
  const text = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })())).join(' ');
  lines.push({ at: new Date().toISOString(), level, text: hide(text).slice(0, 2000) });
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { try { keep(level, args); } catch (_) { /* never break logging */ } orig(...args); };
  }
}

function recent({ limit = 200, q = '' } = {}) {
  const s = String(q || '').toLowerCase();
  const out = s ? lines.filter((l) => l.text.toLowerCase().includes(s)) : lines;
  return out.slice(-Math.min(MAX, Math.max(1, limit)));
}

module.exports = { install, recent };
