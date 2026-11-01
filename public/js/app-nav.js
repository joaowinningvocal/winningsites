/* Inside the app (the store app or the one added to the home screen) there's no browser back button,
   so a page without its own way back traps people until they force close the app. On every page:
   - links that would open a new window stay in the app (a new window goes to Safari, without the login);
   - our PDFs open in /doc.html, which has a Close button;
   - a CSV is shared to Files, Mail and so on instead of showing as text;
   - pages without their own way back get a Back bar (not the app itself: <script ... data-bar="off">). */
(() => {
  const me = document.currentScript;
  const KEY = 'wr-in-app';
  const cap = window.Capacitor;
  const native = !!(cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap.isNative));
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  let inApp = native || standalone || new URLSearchParams(location.search).get('app') === '1';
  try { if (inApp) sessionStorage.setItem(KEY, '1'); else inApp = sessionStorage.getItem(KEY) === '1'; } catch (_) {}
  if (!inApp) return;
  document.documentElement.classList.add('in-app');

  const sameOrigin = (u) => u.origin === location.origin;
  const cameFromHere = () => { try { return history.length > 1 && !!document.referrer && sameOrigin(new URL(document.referrer)); } catch (_) { return false; } };

  async function shareCsv(url) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || url.pathname.split('/').pop();
      const file = new File([await res.blob()], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) return await navigator.share({ files: [file], title: name });
    } catch (e) { if (e && e.name === 'AbortError') return; }
    alert('The spreadsheet can’t be saved from the app on this phone. It also comes by email with the weekly report, or open the dashboard on a computer.');
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button) return;
    let url;
    try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (!sameOrigin(url)) return; // other sites open in Safari, which is right
    if (/^\/docs\/[\w-]+\.pdf$/.test(url.pathname) && location.pathname !== '/doc.html') { e.preventDefault(); location.href = '/doc.html?src=' + encodeURIComponent(url.pathname); return; }
    if (/\.csv$/.test(url.pathname)) { e.preventDefault(); shareCsv(url); return; }
    if (a.target === '_blank') { e.preventDefault(); location.href = url.href; }
  }, true);

  if (me && me.dataset.bar === 'off') return;
  const add = () => {
    if (document.querySelector('[data-own-back]')) return; // the page has its own way back
    const back = me && me.dataset.back ? me.dataset.back : (/^\/(admin|api\/ranch\/admin)\b/.test(location.pathname) || /\/admin\//.test(document.referrer) ? '/admin/' : '/');
    const bar = document.createElement('div');
    bar.className = 'wr-backbar';
    bar.innerHTML = `<a href="${back}">&lsaquo; Back</a>`;
    bar.firstChild.addEventListener('click', (e) => { if (cameFromHere()) { e.preventDefault(); history.back(); } });
    const css = document.createElement('style');
    // In the page's flow, not fixed, so it never covers a page's own sticky header
    css.textContent = `.wr-backbar{position:relative;z-index:50;display:flex;align-items:center;background:#0E0E0E;
      padding:calc(8px + env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) 8px max(12px,env(safe-area-inset-left,0px));font:600 16px -apple-system,"Helvetica Neue",Arial,sans-serif}
      .wr-backbar a{color:#F6F0E5;text-decoration:none;padding:8px 14px;border:1px solid rgba(246,240,229,.35)}
      @media print{.wr-backbar{display:none}}`;
    document.head.appendChild(css);
    document.body.prepend(bar);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();
