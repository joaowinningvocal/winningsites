/* Shared helpers for the dashboard (public/admin) */
window.WR = (() => {
  const API = '/api/ranch';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(API + path, opts);
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Something went wrong. Try again.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Upload with progress (fetch has no upload progress)
  function upload(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API + path);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || 'Upload failed. Try again.'));
      };
      xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
      xhr.send(formData);
    });
  }

  let toastTimer = 0;
  function toast(msg, opts = {}) {
    let el = $('.app-toast');
    if (!el) { el = document.createElement('div'); el.className = 'app-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('has-action', !!opts.action);
    if (opts.action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = opts.action;
      b.addEventListener('click', () => { el.classList.remove('is-on'); opts.onAction(); }, { once: true });
      el.appendChild(b);
    }
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), opts.action ? 6000 : 2600);
  }

  function timeAgo(iso) {
    const secs = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const units = [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800], [31557600, 'month', 2629800], [Infinity, 'year', 31557600]];
    for (const [limit, unit, div] of units) if (Math.abs(secs) < limit) return rtf.format(Math.round(secs / div), unit);
    return '';
  }
  const fmtDay = (s) => new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDate = (s) => new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  function dayLabel(iso) {
    const d = new Date(iso); const t = new Date();
    const key = (x) => x.toDateString();
    const y = new Date(); y.setDate(t.getDate() - 1);
    if (key(d) === key(t)) return 'Today';
    if (key(d) === key(y)) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  const money = (v) => (v == null ? '' : '$' + (Number.isInteger(v) ? v : Number(v).toFixed(2)));

  async function me() {
    try { return (await api('GET', '/auth/me')).user; } catch { return null; }
  }

  async function logout() {
    try { await api('POST', '/auth/logout'); } catch (_) {}
    location.hash = '#/';
    location.reload();
  }

  // ---------------------------------------------------------------- auth views
  function loginView(root, { title, intro, foot, onSuccess }) {
    root.innerHTML = `
      <div class="auth"><div class="auth__card">
        <img src="../img/crest-red.png" alt="Winning Ranch" width="621" height="632">
        <h1>${esc(title)}</h1>
        <p>${esc(intro)}</p>
        <form class="stack" id="login-form" novalidate>
          <div class="field"><label for="l-email">Email</label><input id="l-email" name="email" type="email" autocomplete="username" required></div>
          <div class="field"><label for="l-pass">Password</label><input id="l-pass" name="password" type="password" autocomplete="current-password" required></div>
          <p class="inline-error" id="login-error" role="alert"></p>
          <button class="btn btn--red" type="submit">Log in</button>
        </form>
        <p class="auth__foot">${foot}</p>
      </div></div>`;
    const form = $('#login-form', root);
    $('#l-email', root).focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#login-error', root);
      err.textContent = '';
      if (!form.email.value.trim() || !form.password.value) { err.textContent = 'Add your email and password.'; return; }
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const { user } = await api('POST', '/auth/login', { email: form.email.value, password: form.password.value });
        onSuccess(user);
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
      }
    });
  }

  async function inviteView(root, token, { onSuccess }) {
    root.innerHTML = '<div class="auth"><div class="auth__card"><p>Checking your link…</p></div></div>';
    let info;
    try { info = await api('GET', '/auth/invite/' + encodeURIComponent(token)); } catch (ex) {
      root.innerHTML = `<div class="auth"><div class="auth__card"><h1>Link expired</h1><p>${esc(ex.message)}</p>
        <a class="btn btn--red" style="width:100%" href="#/">Go to login</a></div></div>`;
      return;
    }
    const first = info.name.split(' ')[0];
    root.innerHTML = `
      <div class="auth"><div class="auth__card">
        <img src="../img/crest-red.png" alt="Winning Ranch" width="621" height="632">
        <h1>Welcome, ${esc(first)}</h1>
        <p>Create a password for ${esc(info.email)}. You&rsquo;ll use it to log in from now on.</p>
        <form class="stack" id="invite-form" novalidate>
          <input type="email" autocomplete="username" value="${esc(info.email)}" hidden>
          <div class="field"><label for="i-pass">New password</label><input id="i-pass" type="password" autocomplete="new-password" minlength="8" required><small class="muted">At least 8 characters.</small></div>
          <div class="field"><label for="i-pass2">Type it again</label><input id="i-pass2" type="password" autocomplete="new-password" required></div>
          <p class="inline-error" id="invite-error" role="alert"></p>
          <button class="btn btn--red" type="submit">Create password and log in</button>
        </form>
      </div></div>`;
    $('#i-pass', root).focus();
    $('#invite-form', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#invite-error', root);
      const p1 = $('#i-pass', root).value, p2 = $('#i-pass2', root).value;
      if (p1.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
      if (p1 !== p2) { err.textContent = 'The two passwords don’t match.'; return; }
      try {
        const { user } = await api('POST', '/auth/accept-invite', { token, password: p1 });
        history.replaceState(null, '', location.pathname + '#/');
        onSuccess(user);
      } catch (ex) { err.textContent = ex.message; }
    });
  }

  // ---------------------------------------------------------------- lightbox
  function lightbox(src) {
    let dlg = $('dialog.lightbox');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'lightbox';
      dlg.innerHTML = '<button type="button" aria-label="Close">&times;</button><img alt="">';
      dlg.addEventListener('click', () => dlg.close());
      document.body.appendChild(dlg);
    }
    $('img', dlg).src = src;
    dlg.showModal();
  }

  return { api, upload, esc, toast, timeAgo, fmtDay, fmtDate, dayLabel, money, me, logout, loginView, inviteView, lightbox, $ };
})();
