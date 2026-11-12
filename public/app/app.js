/* Winning Ranch app (POC). One login for owners and the ranch team, like the Winning App:
   Home (by role) + Messages in the bottom bar, the camera button for the team, a bell for news. */
(() => {
  const API = '/api/ranch';
  const TZ = 'America/Los_Angeles';
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { me: null, home: null, poll: 0, threadPoll: 0, listPoll: 0, thread: null, files: [] };
  const ROLE = { owner: 'Owner', hand: 'Ranch hand', manager: 'Ranch manager', office: 'Office', lessons: 'Lesson program' };
  const inChats = () => pos() !== 'lessons';
  const pos = () => (S.me && S.me.role === 'staff' ? S.me.position || 'office' : 'owner');
  const isStaff = () => S.me && S.me.role === 'staff';

  // ------------------------------------------------------------------ helpers
  async function api(method, path, body) {
    const o = { method, headers: {} };
    if (body instanceof FormData) o.body = body;
    else if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    // A request that hangs (weak signal at the barn) gives up instead of leaving "Loading…" forever
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), body instanceof FormData ? 300000 : 20000);
    o.signal = ctl.signal;
    let res;
    try { res = await fetch(API + path, o); } catch (ex) {
      throw new Error(ex.name === 'AbortError' ? 'That took too long. Check your connection and try again.' : 'No connection. Check your signal and try again.');
    } finally { clearTimeout(timer); }
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error((data && data.error) || 'Something went wrong.'); e.status = res.status; throw e; }
    return data;
  }
  function upload(path, fd, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', API + path);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch (_) {} x.status < 300 ? resolve(d) : reject(new Error(d.error || 'Upload failed.')); };
      x.onerror = () => reject(new Error('Upload failed. Check your connection.'));
      x.timeout = 600000;
      x.ontimeout = () => reject(new Error('That took too long. Check your connection.'));
      x.send(fd);
    });
  }
  let toastT = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
  const time = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    if (s < 86400) return `${Math.floor(s / 3600)} h`;
    return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  }
  const dur = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m) % 60).padStart(2, '0')}m`;
  const first = (n) => String(n || '').split(' ')[0];
  const hello = () => { const h = +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()); return h < 12 ? 'Good morning,' : h < 18 ? 'Good afternoon,' : 'Good evening,'; };
  const I = {
    chat: '<path d="M4 5h16v11H11l-5 4v-4H4z"/>',
    stall: '<path d="M3 21V9l9-6 9 6v12M7 21v-7h10v7M7 14l10 7M17 14L7 21"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    check: '<path d="M5 12l4 4 10-10"/><path d="M4 4h16v16H4z" opacity=".35"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M9 4l6 2 5-2v16l-5 2-6-2-5 2V6z M9 4v16 M15 6v16"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    money: '<path d="M4 7h16v10H4z"/><circle cx="12" cy="12" r="2.5"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    horse: '<path d="M7 20l1-6-3-3 2-5 4-2 6 1 3 4-2 2-3-1v4l2 6"/>',
    doc: '<path d="M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5"/>',
    cal: '<path d="M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5"/>',
  };
  const ic = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
  const feature = ({ href, act, icon, title, sub, badge }) => `<${href ? `a href="${href}"` : `button type="button" data-act="${act}"`} class="feature">
      <span class="feature__ic">${ic(icon)}${badge ? `<b class="badge">${badge}</b>` : ''}</span>
      <span class="feature__txt"><h3>${esc(title)}</h3><p>${esc(sub)}</p></span><span class="feature__arrow" aria-hidden="true">&rsaquo;</span></${href ? 'a' : 'button'}>`;
  const tile = (href, icon, label) => `<a class="tile" href="${href}">${ic(icon)}<span>${esc(label)}</span></a>`;

  // ------------------------------------------------------------------ boot + routing
  async function boot() {
    document.documentElement.dataset.theme = localStorage.getItem('wr-app-theme') || 'ranch';
    const invite = location.hash.match(/^#\/invite\/(.+)$/);
    if (invite) return inviteView(decodeURIComponent(invite[1]));
    try { S.me = (await api('GET', '/auth/me')).user; } catch (_) { S.me = null; }
    if (!S.me) return login();
    if (S.me.mustChangePassword) return newPasswordView();
    $('#topbar').hidden = false; $('#bottom-nav').hidden = false;
    $('#fab').hidden = !isStaff() || !inChats();
    document.querySelector('[data-nav="messages"]').hidden = !inChats();
    $('#role-text').textContent = ROLE[pos()];
    $('#menu-who').textContent = `${S.me.name}, ${S.me.email}`;
    $('#menu-dash').hidden = !isStaff();
    route();
    clearInterval(S.poll);
    S.poll = setInterval(() => { if (!document.hidden) refreshCounts(); }, 15000);
  }

  function route() {
    clearInterval(S.threadPoll); clearInterval(S.listPoll);
    if (S.thread && S.thread.cleanup) S.thread.cleanup();
    S.thread = null;
    const mm = document.getElementById('msgMenu'); if (mm) mm.remove();
    $('#menu').hidden = true; $('#notif').hidden = true;
    if ($('#sheet').open) $('#sheet').close();
    const h = location.hash || '#/home';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', h.startsWith('#/' + a.dataset.nav) || (a.dataset.nav === 'messages' && h.startsWith('#/chat'))));
    let m;
    if ((m = h.match(/^#\/horse\/([\w-]+)/))) return horseView(m[1]);
    if ((m = h.match(/^#\/chat\/([\w-]+)/))) return chatView(m[1]);
    if (h.startsWith('#/messages')) return messagesView();
    if (h.startsWith('#/checklist')) return checklistView();
    if (h.startsWith('#/documents')) return documentsView();
    if (h.startsWith('#/sent')) return sentView();
    if (h.startsWith('#/reports')) return reportsView();
    return homeView();
  }
  window.addEventListener('hashchange', () => S.me && route());
  // Back on the app after the phone slept or another app was open: catch up right away
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.thread && S.thread.pull) S.thread.pull(); });

  async function refreshCounts() {
    try {
      S.home = await api('GET', '/app/home');
      const fresh = S.home.horses.reduce((t, x) => t + x.fresh, 0);
      const extra = (S.home.pendingBookings || 0) + (S.home.waiversToCountersign || 0) + (S.home.shiftRequests || 0) + (S.home.shiftAnswers || []).length + (S.home.reports || 0);
      const n = S.home.unread + fresh + extra + (S.home.toSign || 0);
      $('#bell-badge').hidden = !n; $('#bell-badge').textContent = n > 99 ? '99+' : n;
      $('#nav-dot').hidden = !S.home.unread;
    } catch (e) { if (e.status === 401) location.reload(); }
  }

  // ------------------------------------------------------------------ login
  function login() {
    $('#topbar').hidden = true; $('#bottom-nav').hidden = true;
    view.innerHTML = `
      <div class="login"><form class="login__card" id="login" novalidate>
        <img src="/img/crest-light.png" alt="Winning Ranch" width="621" height="632">
        <h1>Winning Ranch</h1>
        <p>Owners and the ranch team, one app.</p>
        <div class="field"><label for="li-e">Email</label><input id="li-e" type="email" autocomplete="username" required></div>
        <div class="field"><label for="li-p">Password</label><input id="li-p" type="password" autocomplete="current-password" required></div>
        <button class="btn btn--red btn--big" type="submit">Log in</button>
        <p class="err" id="li-err" role="alert"></p>
        <p><button class="textlink" type="button" id="li-forgot" style="background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer">Forgot your password?</button></p>
        <p>No login yet? The ranch sends you a link when your horse checks in.</p>
        <div class="visit"><span>Visiting the ranch?</span>
          <a href="/stalls.html">Book a stall</a><a href="/waivers.html">Sign waivers</a><a href="/home.html">Explore the ranch</a></div>
      </form></div>`;
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/auth/login', { email: $('#li-e').value, password: $('#li-p').value }); location.hash = '#/home'; boot(); }
      catch (ex) { $('#li-err').textContent = ex.message; }
    };
    $('#li-forgot').onclick = async () => {
      const email = $('#li-e').value.trim();
      if (!email) { $('#li-err').textContent = 'Type your email above, then tap Forgot your password.'; return; }
      try { $('#li-err').textContent = (await api('POST', '/auth/forgot', { email })).message; } catch (ex) { $('#li-err').textContent = ex.message; }
    };
  }

  // ------------------------------------------------------------------ invite link: create a password
  // Logged in with the temporary password: pick your own before anything else
  function newPasswordView() {
    $('#topbar').hidden = true; $('#bottom-nav').hidden = true; $('#fab').hidden = true;
    view.innerHTML = `
      <div class="login"><form class="login__card" id="npw" novalidate>
        <img src="/img/crest-light.png" alt="Winning Ranch" width="621" height="632">
        <h1>Welcome, ${esc(first(S.me.name))}</h1>
        <p>You logged in with the temporary password. Create your own; you&rsquo;ll use it from now on.</p>
        <input type="email" autocomplete="username" value="${esc(S.me.email)}" hidden>
        <div class="field"><label for="np-1">New password</label><input id="np-1" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="np-2">Type it again</label><input id="np-2" type="password" autocomplete="new-password" required></div>
        <button class="btn btn--red btn--big" type="submit">Save my password</button>
        <p class="err" id="np-err" role="alert"></p>
      </form></div>`;
    $('#npw').onsubmit = async (e) => {
      e.preventDefault();
      const a = $('#np-1').value, b = $('#np-2').value;
      if (a.length < 8) { $('#np-err').textContent = 'Use at least 8 characters.'; return; }
      if (a !== b) { $('#np-err').textContent = 'The two passwords don’t match.'; return; }
      try { await api('POST', '/auth/change-password', { password: a }); toast('Password saved'); boot(); }
      catch (ex) { $('#np-err').textContent = ex.message; }
    };
  }

  async function inviteView(token) {
    $('#topbar').hidden = true; $('#bottom-nav').hidden = true;
    view.innerHTML = '<div class="login"><div class="login__card"><p>Checking your link…</p></div></div>';
    let info;
    try { info = await api('GET', '/auth/invite/' + encodeURIComponent(token)); } catch (ex) {
      view.innerHTML = `<div class="login"><div class="login__card"><img src="/img/crest-light.png" alt="Winning Ranch" width="621" height="632"><h1>Link expired</h1><p>${esc(ex.message)}</p><a class="btn btn--red btn--big" href="#/home">Go to login</a></div></div>`;
      window.onhashchange = () => { window.onhashchange = null; boot(); };
      return;
    }
    view.innerHTML = `
      <div class="login"><form class="login__card" id="inv" novalidate>
        <img src="/img/crest-light.png" alt="Winning Ranch" width="621" height="632">
        <h1>Welcome, ${esc(first(info.name))}</h1>
        <p>Create a password for ${esc(info.email)}. You&rsquo;ll use it to log in from now on.</p>
        <input type="email" autocomplete="username" value="${esc(info.email)}" hidden>
        <div class="field"><label for="iv-1">New password</label><input id="iv-1" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="iv-2">Type it again</label><input id="iv-2" type="password" autocomplete="new-password" required></div>
        <button class="btn btn--red btn--big" type="submit">Create password and log in</button>
        <p class="err" id="iv-err" role="alert"></p>
      </form></div>`;
    $('#inv').onsubmit = async (e) => {
      e.preventDefault();
      const a = $('#iv-1').value, b = $('#iv-2').value;
      if (a.length < 8) { $('#iv-err').textContent = 'Use at least 8 characters.'; return; }
      if (a !== b) { $('#iv-err').textContent = 'The two passwords don’t match.'; return; }
      try { await api('POST', '/auth/accept-invite', { token, password: a }); history.replaceState(null, '', '/#/home'); boot(); }
      catch (ex) { $('#iv-err').textContent = ex.message; }
    };
  }

  // ------------------------------------------------------------------ home
  async function homeView() {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    await refreshCounts();
    const h = S.home;
    const p = pos();
    let body = '';
    if (p === 'owner') {
      body += `<p class="section-label">Your horses</p>` + (h.horses.length ? h.horses.map((x) => `
        <a class="horse" href="#/horse/${x.id}">
          <span class="horse__img">${x.cover ? `<img src="${esc(x.cover)}" alt="">` : '<span class="sil"></span>'}</span>
          <span><h3>${esc(x.name)}${x.fresh ? `<span class="new">${x.fresh} new</span>` : ''}</h3>
            <p>${esc(x.stall || 'Stall not assigned')}</p>
            <p>${x.latest ? `${esc(x.latest.caption || 'New photo')} &middot; ${esc(ago(x.latest.at))}` : 'No updates yet'}</p></span>
        </a>`).join('') : '<div class="empty">Once your horse checks in, the team&rsquo;s photos and videos show up here.</div>');
      body += `<p class="section-label">The ranch</p>
        ${feature({ href: '#/messages', icon: 'chat', title: 'Message the ranch', sub: 'Questions, requests, care changes', badge: h.unread || '' })}
        ${feature({ href: '/stalls.html', icon: 'stall', title: 'Book a stall', sub: 'Pick dates and stalls on the map' })}
        ${feature({ href: '#/documents', icon: 'pen', title: 'Documents', sub: h.toSign ? `${h.toSign} to sign` : 'Waivers and agreements', badge: h.toSign || '' })}
        <p class="section-label">More</p>
        <div class="tiles">${tile('/stalls.html', 'map', 'Ranch map')}${tile('/home.html#amenities', 'star', 'Amenities')}${tile('tel:+13054099656', 'phone', 'Call a team member')}
          ${tile('https://www.google.com/maps/dir/?api=1&destination=5360+W+Agate+Ave,+Las+Vegas,+NV', 'pin', 'Directions')}${tile('/contact.html', 'globe', 'Contact')}${tile('/home.html', 'horse', 'Website')}</div>`;
    } else if (p === 'lessons') {
      body += `<p class="section-label">Lesson clients</p>`;
      body += feature({ act: 'client-waivers', icon: 'pen', title: 'Send waivers', sub: 'Adult waiver or minor consent, by email or text' });
      body += feature({ href: '#/sent', icon: 'doc', title: 'Waivers you sent', sub: 'See who signed and who still needs to' });
      body += feature({ act: 'instructor', icon: 'doc', title: 'Instructor and insurance', sub: 'Your details on the riding waivers' });
      body += `<p class="section-label">More</p><div class="tiles">${tile('/waivers.html', 'doc', 'Waivers page')}${tile('/stalls.html', 'map', 'Ranch map')}${tile('/home.html', 'globe', 'Website')}</div>`;
    } else {
      if (h.shift !== null && h.shift !== undefined) body += shiftCard(h.shift);
      body += `<p class="section-label">Today</p>`;
      if (h.shift) body += feature({ href: '#/checklist', icon: 'check', title: 'Shift checklist', sub: `${h.shift.done.done} of ${h.shift.done.total} done` });
      body += feature({ href: '/admin/#/schedule', icon: 'cal', title: 'Schedule', sub: h.shiftRequests ? `${h.shiftRequests} shift request${h.shiftRequests === 1 ? '' : 's'} to approve` : h.nextShifts && h.nextShifts.length ? `Next: ${h.nextShifts.join(', ')}` : 'AM and PM shifts this week', badge: h.shiftRequests || '' });
      body += feature({ act: 'post', icon: 'camera', title: 'Post an update', sub: 'Photos and videos for the owners' });
      body += feature({ href: '#/messages', icon: 'chat', title: 'Messages', sub: 'Team chat and owner chats', badge: h.unread || '' });
      body += feature({ href: '#/documents', icon: 'pen', title: 'My documents', sub: h.toSign ? `${h.toSign} to sign` : 'Employee packet and W-9', badge: h.toSign || '' });
      if (p !== 'hand') {
        body += `<p class="section-label">Ranch</p>`;
        body += feature({ href: '/admin/#/board', icon: 'stall', title: 'Stall board', sub: 'Who’s in each stall, add horses, ask the stall assistant' });
        body += feature({ href: '/admin/#/bookings', icon: 'cal', title: 'Bookings', sub: h.pendingBookings ? `${h.pendingBookings} waiting for you` : 'Nothing waiting', badge: h.pendingBookings || '' });
        body += feature({ href: '/admin/#/waivers', icon: 'doc', title: 'Waivers', sub: h.waiversToCountersign ? `${h.waiversToCountersign} to countersign` : 'All countersigned', badge: h.waiversToCountersign || '' });
        body += feature({ href: '/admin/#/hours', icon: 'clock', title: 'Hours', sub: h.onClock.length ? `On the clock: ${h.onClock.join(', ')}` : 'Nobody on the clock' });
        body += feature({ act: 'client-waivers', icon: 'pen', title: 'Send waivers to a client', sub: 'For lessons and visitors without an account' });
        body += feature({ act: 'instructor', icon: 'doc', title: 'Instructor and insurance', sub: 'What the riding waivers show in that box' });
        body += `<p class="section-label">Dashboard</p><div class="tiles">${tile('/admin/#/pricing', 'money', 'Pricing')}${tile('/admin/#/horses', 'horse', 'Horses')}${tile('/admin/#/people', 'people', 'People')}
          ${tile('/admin/#/stalls', 'stall', 'Stalls')}${tile('/stalls.html', 'map', 'Ranch map')}${tile('/home.html', 'globe', 'Website')}</div>`;
      }
    }
    view.innerHTML = `<div class="wrap"><div class="greeting"><p class="eyebrow">${hello()}</p><h1>${esc(first(S.me.name))}</h1></div>${body}</div>`;
  }

  function shiftCard(s) {
    if (!s) return `<div class="shift-card"><p class="state">You&rsquo;re off the clock</p><div style="margin-top:12px"><button class="btn btn--red btn--big" type="button" data-act="in">Clock in</button></div>
      <p class="muted" style="margin-top:8px;font-size:.9rem">We check you&rsquo;re at the ranch, so allow location.</p><p class="err" id="shift-err" role="alert"></p></div>`;
    return `<div class="shift-card ${s.onBreak ? 'brk' : 'on'}"><p class="state">${s.onBreak ? 'On break' : `On the clock since ${esc(time(s.since))}`}</p>
      <p class="worked">${dur(s.worked)} <small>worked</small></p>
      <div class="btns">${s.onBreak ? '<button class="btn btn--red" type="button" data-act="break-end">End break</button>' : '<button class="btn" type="button" data-act="break-start">Start break</button>'}
        <button class="btn ${s.onBreak ? '' : 'btn--red'}" type="button" data-act="out">Clock out</button></div><p class="err" id="shift-err" role="alert"></p></div>`;
  }

  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('This phone can’t share location.'));
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => reject(new Error(e.code === 1 ? 'Location is blocked. Allow it for this app in Settings, then try again.' : 'Couldn’t get your location. Try again outside.')),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }

  async function shiftAct(kind, btn) {
    const err = $('#shift-err');
    if (err) err.textContent = '';
    btn.disabled = true;
    try {
      if (kind === 'in') {
        let where = {};
        try { where = await locate(); } catch (ex) { where = null; if (err) err.textContent = ex.message; }
        await api('POST', '/admin/shift/clock-in', where || {});
        toast('Clocked in. Have a good shift.');
      } else if (kind === 'break-start' || kind === 'break-end') {
        await api('POST', '/admin/shift/break', { action: kind === 'break-start' ? 'start' : 'end' });
        toast(kind === 'break-start' ? 'Break started' : 'Back on the clock');
      } else if (kind === 'out') {
        return clockOutSheet();
      }
      homeView();
    } catch (ex) { if (err) err.textContent = ex.message; else toast(ex.message); btn.disabled = false; }
  }

  async function clockOutSheet() {
    const { shift } = await api('GET', '/admin/shift');
    const left = shift.checklist.flatMap((x) => x.items).filter((i) => !i.done).length;
    openSheet(`<h2>Clock out?</h2>
      <p>${left ? `${left} checklist task${left === 1 ? '' : 's'} not checked. Say what&rsquo;s not done.` : 'Checklist done. Nice work.'}</p>
      <form id="out" novalidate><div class="field" style="margin-top:12px"><label for="out-n">Note for management${left ? '' : ' (optional)'}</label><textarea id="out-n" rows="3"></textarea></div>
      <button class="btn btn--red btn--big" type="submit">Clock out</button><p class="err" id="out-err"></p></form>`, (sheet) => {
      $('#out', sheet).onsubmit = async (e) => {
        e.preventDefault();
        const note = $('#out-n', sheet).value.trim();
        if (left && !note) { $('#out-err', sheet).textContent = 'Add a quick note about what’s not done.'; return; }
        let where = {};
        try { where = await locate(); } catch (_) { where = {}; }
        try { const r = await api('POST', '/admin/shift/clock-out', { ...where, note }); sheet.close(); toast(`Clocked out. ${dur(r.shift.worked)} today.`); homeView(); }
        catch (ex) { $('#out-err', sheet).textContent = ex.message; }
      };
    });
  }

  // ------------------------------------------------------------------ checklist
  async function checklistView() {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    const { shift } = await api('GET', '/admin/shift');
    if (!shift) { view.innerHTML = `<div class="wrap"><a class="back" href="#/home">&lsaquo; Home</a><div class="empty">Clock in to start the checklist.</div></div>`; return; }
    const all = shift.checklist.flatMap((x) => x.items);
    const draw = () => { const d = all.filter((i) => i.done).length; $('#cl-count').textContent = `${d} of ${all.length} done`; $('#cl-bar').style.width = `${Math.round((d / all.length) * 100)}%`; };
    view.innerHTML = `<div class="wrap"><a class="back" href="#/home">&lsaquo; Home</a><h1 style="font-size:1.7rem">Shift checklist</h1>
      <p class="muted" id="cl-count"></p><div class="progress"><i id="cl-bar"></i></div>
      ${shift.checklist.map((sec, si) => `<section class="check-sec"><h3>${esc(sec.title)}</h3>${sec.items.map((it, ii) => `<label class="check-item"><input type="checkbox" data-s="${si}" data-i="${ii}"${it.done ? ' checked' : ''}><span>${esc(it.text)}</span></label>`).join('')}</section>`).join('')}</div>`;
    draw();
    view.onchange = async (e) => {
      const c = e.target.closest('[data-s]');
      if (!c) return;
      const it = shift.checklist[c.dataset.s].items[c.dataset.i];
      it.done = c.checked; draw();
      try { await api('PATCH', '/admin/shift/checklist', { section: +c.dataset.s, item: +c.dataset.i, done: c.checked }); }
      catch (ex) { c.checked = !c.checked; it.done = c.checked; draw(); toast(ex.message); }
    };
  }

  // ------------------------------------------------------------------ horse feed
  async function horseView(id) {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    const { horse, updates } = await api('GET', `/horses/${id}/updates`);
    api('POST', '/app/seen-updates').then(refreshCounts).catch(() => {});
    let lastDay = '';
    const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' });
    view.innerHTML = `<div class="wrap"><a class="back" href="#/home">&lsaquo; Home</a><h1 style="font-size:2rem">${esc(horse.name)}</h1><p class="muted">${esc([horse.breed, horse.stall].filter(Boolean).join(', '))}</p>
      ${horse.careNotes ? `<div class="care-box"><b>Feeding &amp; care</b><p>${esc(horse.careNotes)}</p></div>` : ''}
      ${updates.length ? updates.map((u) => {
        const d = day(u.createdAt); const head = d !== lastDay ? `<p class="day">${esc(d)}</p>` : ''; lastDay = d;
        const imgs = u.media.filter((m) => m.type === 'image'), vids = u.media.filter((m) => m.type === 'video');
        return `${head}<article class="post"><div class="post__head"><b>${esc(u.authorName)}</b><span>${esc(time(u.createdAt))}</span></div>
          ${u.caption ? `<p class="post__text">${esc(u.caption)}</p>` : '<div style="height:10px"></div>'}
          ${imgs.length || vids.length ? `<div class="post__media${imgs.length === 1 && !vids.length ? ' one' : ''}">${imgs.map((m) => `<button type="button" data-full="${esc(m.url)}"><img src="${esc(m.url)}" alt="Photo of ${esc(horse.name)}" loading="lazy"></button>`).join('')}${vids.map((m) => `<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>`).join('')}</div>` : ''}</article>`;
      }).join('') : '<div class="empty" style="margin-top:16px">No updates yet.</div>'}</div>`;
  }

  // ------------------------------------------------------------------ messages (they work like the Winning App's chats)
  // The list: cards with "N new", newest first, a search box, refreshed every 8 seconds.
  // A conversation: the latest 300 messages fetched every 5 seconds and compared with what's on screen
  // (new ones added, edited or reacted ones redrawn, removed ones taken out), days separated, "seen by",
  // hold a message for its menu (react, reply, copy, edit, remove, report, block), double tap for ❤️,
  // swipe right to reply, messages show "Sending…" until they're in and can be sent again if they fail.
  const QUICK_REACTIONS = ['❤️', '😆', '😮', '😢', '😠', '👍', '🔥'];
  const URL_RX = /(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  const fullUrl = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
  // @mentions the server recognized show highlighted (@everyone, @barnmanager, @Name)
  const withMentions = (html, mentions) => (!mentions || !mentions.length ? html
    : html.replace(/(^|[^\w@])@([A-Za-z][A-Za-z0-9]*)/g, (all, pre, h) => (mentions.includes(h.toLowerCase()) ? `${pre}<span class="msg-mention">@${h}</span>` : all)));
  function richText(text, mentions) {
    const out = []; let last = 0;
    String(text).replace(URL_RX, (mm, at) => { out.push([0, text.slice(last, at)]); out.push([1, mm]); last = at + mm.length; return mm; });
    out.push([0, String(text).slice(last)]);
    return out.map(([isUrl, t]) => (isUrl ? `<a class="msg-link" href="${esc(fullUrl(t))}" target="_blank" rel="noopener noreferrer">${esc(t.length > 60 ? t.slice(0, 57) + '…' : t)}</a>` : withMentions(esc(t), mentions))).join('');
  }
  const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
  function dayLabel(iso) {
    const k = dayKey(iso), today = dayKey(new Date().toISOString()), yesterday = dayKey(new Date(Date.now() - 864e5).toISOString());
    if (k === today) return 'Today';
    if (k === yesterday) return 'Yesterday';
    return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' });
  }
  const msgWhen = (iso) => (dayKey(iso) === dayKey(new Date().toISOString()) ? time(iso)
    : new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }) + ', ' + time(iso));
  const fullWhen = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
  // PDFs open in the app's viewer (it has a Close button); other documents open in a new tab
  const fileHref = (f) => (/\.pdf$/i.test(f.name || '') ? `/doc.html?src=${encodeURIComponent(f.url)}&title=${encodeURIComponent(f.name)}` : f.url);

  function loadFailed(ex, retry) {
    view.innerHTML = `<div class="wrap"><div class="empty">${esc(ex.message || 'That didn’t load.')}<br><button class="btn" type="button" id="retry" style="margin-top:12px">Try again</button></div></div>`;
    $('#retry').onclick = () => retry();
  }

  async function messagesView() {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    let chats, q = '';
    try { ({ chats } = await api('GET', '/chats')); } catch (ex) { return loadFailed(ex, messagesView); }
    const card = (c) => `<a class="chat-card${c.type === 'channel' ? ' chat-card--main' : ''}${c.unread ? ' has-new' : ''}" href="#/chat/${c.id}">
        <span class="chat-card__top"><b>${esc(c.title)}</b>${c.mentioned ? '<span class="new-pill at-pill">@you</span>' : ''}${c.unread ? `<span class="new-pill">${c.unread} new</span>` : ''}<span class="chat-card__ago">${c.last ? esc(ago(c.last.at)) : ''}</span></span>
        <span class="chat-card__last">${c.last ? `${c.last.by ? esc(c.last.by) + ': ' : ''}${esc(c.last.text)}` : esc(c.about || 'No messages yet')}</span></a>`;
    const paint = () => {
      const list = $('#chat-list');
      if (!list) return;
      const s = q.trim().toLowerCase();
      const shown = chats.filter((c) => !s || c.title.toLowerCase().includes(s));
      list.innerHTML = shown.map(card).join('') || `<div class="empty">${s ? 'No chat matches.' : 'No chats yet.'}</div>`;
    };
    view.innerHTML = `<div class="wrap"><div class="msgs-head"><h1 style="font-size:1.8rem">Messages</h1>${isStaff() ? '<button class="req-btn" type="button" id="new-chat">+ New</button>' : ''}</div>
      <input class="chat-search" id="chat-q" type="search" placeholder="Search chats" aria-label="Search chats" autocomplete="off"><div id="chat-list"></div></div>`;
    paint();
    $('#chat-q').oninput = (e) => { q = e.target.value; paint(); };
    const nb = $('#new-chat');
    if (nb) nb.onclick = newChatSheet;
    S.listPoll = setInterval(async () => {
      if (document.hidden || !$('#chat-list')) return;
      try { ({ chats } = await api('GET', '/chats')); paint(); } catch (_) { /* next time */ }
    }, 8000);
  }

  async function chatView(id) {
    const T = { id, rows: null, sig: '', inflight: false, queue: [], mode: null, pin: true, readAt: '', chat: null, msgs: {} };
    S.thread = T; // route() drops it when they leave, so a late answer never draws over another screen
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    let d;
    try { d = await api('GET', `/chats/${id}/messages`); } catch (ex) { if (S.thread === T) loadFailed(ex, () => chatView(id)); return; }
    if (S.thread !== T) return;
    T.chat = d.chat;
    const chat = d.chat;
    S.files = [];
    view.innerHTML = `<div class="wrap thread">
      <div class="thread__head"><a class="back" href="#/messages" style="margin:0" aria-label="Back to Messages">&lsaquo;</a>
        <button class="title-btn" type="button" id="chat-info"><b>${esc(chat.title)}</b><small id="chat-count">${chat.memberCount} ${chat.memberCount === 1 ? 'person' : 'people'}</small></button>
        <button class="head-btn" type="button" id="chat-people" aria-label="People in this chat">${ic('people')}<span>People</span></button>
        ${chat.type === 'owner' && isStaff() && pos() !== 'hand' ? '<button class="req-btn" type="button" id="req-sign">Request signature</button>' : ''}</div>
      <p class="thread__note" id="net" hidden>Reconnecting…</p>
      <div class="thread__msgs" id="msgs"></div><div id="pend"></div></div>
      <div class="composer"><div class="mention-box" id="mention-box" role="listbox" aria-label="Mention someone" hidden></div><div class="mode-bar" id="mode-bar" hidden></div><p class="pending" id="pending" hidden></p><form id="send" novalidate>
        <button class="attach" type="button" id="attach" aria-label="Add photos, videos or files">${ic('camera')}</button>
        <input type="file" id="file" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" multiple hidden>
        <textarea id="text" rows="1" placeholder="Message" aria-label="Message" autocapitalize="sentences" enterkeyhint="send"></textarea>
        <button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg></button></form></div>`;
    const box = $('#msgs'), ta = $('#text');

    // ---- scrolling: stay at the newest message unless they scrolled up to read
    const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
    const toBottom = () => window.scrollTo(0, document.documentElement.scrollHeight);
    const stick = () => { toBottom(); [150, 500, 1200].forEach((ms) => setTimeout(() => { if (T.pin && S.thread === T) toBottom(); }, ms)); };
    const onScroll = () => { if (S.thread === T) T.pin = nearBottom(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    T.cleanup = () => window.removeEventListener('scroll', onScroll);
    box.addEventListener('load', () => { if (T.pin && S.thread === T) toBottom(); }, true); // photos still loading push the list down

    // ---- one message
    const aggregate = (list) => {
      if (!list || !list.length) return null;
      const by = {};
      list.forEach((x) => { (by[x.e] = by[x.e] || []).push(x.name); });
      return { html: Object.keys(by).map((e) => `<span>${e}${by[e].length > 1 ? ' ' + by[e].length : ''}</span>`).join(''), names: Object.keys(by).map((e) => `${e} ${by[e].join(', ')}`).join('\n') };
    };
    function renderMsg(m) {
      const row = document.createElement('div');
      if (m.kind === 'system') { row.className = 'sys'; row.dataset.mid = m.id; row.textContent = `${m.text} · ${msgWhen(m.at)}`; return row; }
      row.className = 'msg-row' + (m.mine ? ' mine' : '');
      row.dataset.mid = m.id;
      const from = m.mine ? '' : `<div class="msg-from">${esc(m.by)}</div>`;
      const when = `<div class="msg-time" title="${esc(fullWhen(m.at))}">${m.editedAt ? 'edited · ' : ''}${esc(msgWhen(m.at))}</div>`;
      if (m.deleted) {
        row.innerHTML = `<div class="msg-wrap"><div class="msg-bubble msg-deleted">${from}<i>This message was deleted</i>${when}</div></div>`;
      } else if (m.kind === 'sign-request') {
        row.innerHTML = `<div class="msg-wrap"><div class="msg-bubble sign-bubble">${from}<div class="sign-card"><b>Signature requested</b>
          ${m.docs.map((x) => `<div class="sign-card__row"><span>${esc(x.title)}</span>${x.status === 'signed' ? '<em class="ok">Signed</em>' : x.status === 'cancelled' ? '<em>Cancelled</em>' : isStaff() ? '<em>Waiting</em>' : `<a class="sign-go" href="/sign.html?doc=${esc(x.id)}&app=1">Sign</a>`}</div>`).join('')}
          ${m.text.includes('. ') ? `<p class="muted">${esc(m.text.split('. ').slice(1).join('. '))}</p>` : ''}</div>${when}</div></div>`;
      } else {
        const q = m.replyTo ? `<button type="button" class="msg-quote${m.replyTo.img ? ' has-img' : ''}" data-jump="${esc(m.replyTo.id)}">${m.replyTo.img ? `<img class="mq-img" src="${esc(m.replyTo.img)}" alt="">` : ''}<b>${esc(m.replyTo.by)}</b><span>${esc(m.replyTo.text)}</span></button>` : '';
        const imgs = m.media.filter((x) => x.type === 'image'), vids = m.media.filter((x) => x.type === 'video'), files = m.media.filter((x) => x.type === 'file');
        const gallery = imgs.length ? `<div class="msg-gallery g${Math.min(imgs.length, 3)}">${imgs.map((x, i) => `<img class="msg-img" src="${esc(x.url)}" alt="Photo ${i + 1} of ${imgs.length}" data-full="${esc(x.url)}" loading="lazy">`).join('')}</div>` : '';
        const videos = vids.map((x) => `<video src="${esc(x.url)}" controls playsinline preload="metadata"></video>`).join('');
        const docs = files.map((x) => `<a class="msg-file" href="${esc(fileHref(x))}"${/\.pdf$/i.test(x.name || '') ? '' : ' target="_blank" rel="noopener"'}><span class="fi" aria-hidden="true">📄</span><span class="fn"><b>${esc(x.name)}</b><small>${esc(fmtSize(x.size))} · Tap to open</small></span></a>`).join('');
        const reacts = aggregate(m.reactions);
        row.innerHTML = `<div class="msg-wrap"><div class="msg-bubble${m.mentionsMe ? ' mentions-me' : ''}">${from}${q}${gallery}${videos}${docs}${m.text ? `<div class="msg-text">${richText(m.text, m.mentions)}</div>` : ''}${when}</div>
          ${reacts ? `<button type="button" class="msg-reacts" aria-label="Reactions: ${esc(reacts.names)}">${reacts.html}</button>` : ''}</div>`;
        const rb = row.querySelector('.msg-reacts');
        if (rb) rb.onclick = () => toast(reacts.names.replace(/\n/g, ' · '));
        const qb = row.querySelector('.msg-quote');
        if (qb) qb.onclick = (e) => { e.stopPropagation(); jumpTo(qb.dataset.jump); };
      }
      press(row.querySelector('.msg-bubble'), m);
      return row;
    }
    const sigOf = (m) => JSON.stringify([(m.mentions || []).join(), m.editedAt || '', m.deleted ? 1 : 0, (m.reactions || []).map((x) => x.uid + x.e).join(), m.text || '', (m.docs || []).map((x) => x.status).join(), m.media.length]);
    const dayBlock = (iso) => {
      const b = document.createElement('div');
      b.className = 'msg-dayblock'; b.dataset.day = dayKey(iso);
      b.innerHTML = `<div class="msg-day"><span>${esc(dayLabel(iso))}</span></div>`;
      box.appendChild(b);
      return b;
    };
    const append = (m) => {
      const blocks = box.querySelectorAll('.msg-dayblock');
      let b = blocks[blocks.length - 1];
      if (!b || b.dataset.day !== dayKey(m.at)) b = dayBlock(m.at);
      b.appendChild(renderMsg(m));
    };
    const rowEl = (mid) => box.querySelector(`[data-mid="${CSS.escape(mid)}"]`);
    function full(msgs) {
      box.innerHTML = '';
      if (!msgs.length) box.innerHTML = `<p class="muted thread__empty">${chat.type === 'channel' ? `Say hi to everyone in ${esc(chat.title)}.` : isStaff() ? 'Start the conversation.' : 'Ask the ranch anything. The team usually answers fast.'}</p>`;
      msgs.forEach(append);
    }
    // Only what changed: removed ones out, edited or reacted ones redrawn, new ones added at the end
    function patch(msgs, rows) {
      const prevIds = T.rows.map((x) => x[0]), nowIds = rows.map((x) => x[0]), now = new Set(nowIds);
      const kept = prevIds.filter((x) => now.has(x));
      for (let i = 0; i < kept.length; i++) if (nowIds[i] !== kept[i]) return false;
      prevIds.filter((x) => !now.has(x)).forEach((x) => { const el = rowEl(x); if (el) el.remove(); });
      box.querySelectorAll('.msg-dayblock').forEach((b) => { if (!b.querySelector('[data-mid]')) b.remove(); });
      const prevSig = new Map(T.rows);
      msgs.slice(0, kept.length).forEach((m, i) => { if (prevSig.get(m.id) !== rows[i][1]) { const el = rowEl(m.id); if (el) el.replaceWith(renderMsg(m)); } });
      const empty = box.querySelector('.thread__empty');
      if (empty && msgs.length) empty.remove();
      msgs.slice(kept.length).forEach(append);
      return true;
    }
    // "Seen by": each person's mark under the last message they had when they opened the chat
    function paintSeen(msgs, seen) {
      box.querySelectorAll('.msg-seen').forEach((el) => el.remove());
      const at = {};
      for (const p of seen) {
        let last = null;
        for (const m of msgs) { if (m.at <= p.at && m.kind !== 'system') last = m; else if (m.at > p.at) break; }
        if (last) (at[last.id] = at[last.id] || []).push(p);
      }
      for (const [mid, people] of Object.entries(at)) {
        const el = rowEl(mid);
        if (!el) continue;
        const names = people.map((p) => first(p.name));
        const row = document.createElement('div');
        row.className = 'msg-seen';
        row.title = people.map((p) => `${p.name} · ${fullWhen(p.at)}`).join('\n');
        row.innerHTML = `${people.slice(0, 5).map((p) => `<span class="ms-av" aria-hidden="true">${esc(p.name.slice(0, 1))}</span>`).join('')}<span class="ms-t">${people.length === seen.length && seen.length > 1 ? 'Seen by everyone' : `Seen by ${esc(names.length > 3 ? names.slice(0, 3).join(', ') + ' +' + (names.length - 3) : names.join(', '))}`}</span>`;
        row.onclick = () => toast(row.title.replace(/\n/g, ' · '));
        el.after(row);
      }
      return JSON.stringify(Object.entries(at).map(([k, v]) => [k, v.map((p) => p.id).join()]));
    }
    function draw(data, initial) {
      const msgs = data.messages;
      msgs.forEach((m) => { T.msgs[m.id] = m; });
      const rows = msgs.map((m) => [m.id, sigOf(m)]);
      const base = JSON.stringify(rows);
      const pinned = initial || T.pin;
      if (initial || !T.rows || base !== T.base) { if (initial || !T.rows || !patch(msgs, rows)) full(msgs); }
      T.seenSig = paintSeen(msgs, data.seen || []);
      T.rows = rows; T.base = base;
      if (pinned) { T.pin = true; stick(); }
      const latest = msgs.filter((m) => !m.mine).pop();
      if (latest && latest.at > T.readAt) { T.readAt = latest.at; api('POST', `/chats/${id}/read`).then(refreshCounts).catch(() => {}); }
    }
    const jumpTo = (mid) => {
      const el = rowEl(mid);
      if (!el) { toast('That message is further back.'); return; }
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.classList.add('msg-flash'); setTimeout(() => el.classList.remove('msg-flash'), 1400);
    };

    // ---- staying up to date: one request at a time, right away when the phone wakes up
    async function pull() {
      if (T.inflight || S.thread !== T) return;
      T.inflight = true;
      try {
        const data = await api('GET', `/chats/${id}/messages`);
        if (S.thread !== T) return;
        T.chat = data.chat;
        const cnt = $('#chat-count');
        if (cnt) cnt.textContent = `${data.chat.memberCount} ${data.chat.memberCount === 1 ? 'person' : 'people'}`;
        draw(data);
        const net = $('#net'); if (net) net.hidden = true;
      } catch (ex) {
        if (S.thread !== T) return;
        if (ex.status === 404) { toast('You’re not in that chat anymore.'); location.hash = '#/messages'; return; }
        const net = $('#net'); if (net) net.hidden = false;
      } finally { T.inflight = false; }
    }
    T.pull = pull;
    draw(d, true);
    S.threadPoll = setInterval(() => { if (!document.hidden) pull(); }, 5000);

    // ---- sending: shows right away, "Sending…" until it's in, tap to send again if it failed
    function renderPending() {
      const pend = $('#pend');
      if (!pend) return;
      pend.innerHTML = T.queue.map((j, i) => `<div class="msg-row mine"><div class="msg-wrap"><button type="button" class="msg-bubble msg-pending${j.state === 'failed' ? ' failed' : ''}" data-job="${i}">
        ${j.files.length ? `<div class="msg-pend-files">📎 ${j.files.length} ${j.files.length === 1 ? 'attachment' : 'attachments'}</div>` : ''}${j.text ? `<div class="msg-text">${esc(j.text)}</div>` : ''}
        <div class="msg-time">${j.state === 'failed' ? `⚠ Not sent · tap to try again${j.err ? ` (${esc(j.err)})` : ''}` : 'Sending…'}</div></button></div></div>`).join('');
      pend.querySelectorAll('[data-job]').forEach((b) => { b.onclick = () => {
        const j = T.queue[+b.dataset.job];
        if (!j || j.state !== 'failed') return;
        openSheet(`<h2>Not sent</h2><div style="display:grid;gap:10px;margin-top:12px"><button class="btn btn--red" type="button" data-x="retry">Try again</button><button class="btn" type="button" data-x="drop">Delete it</button></div>`, (sh) => {
          sh.querySelector('[data-x="retry"]').onclick = () => { sh.close(); deliver(j); };
          sh.querySelector('[data-x="drop"]').onclick = () => { sh.close(); T.queue = T.queue.filter((x) => x !== j); renderPending(); };
        });
      }; });
    }
    async function deliver(job) {
      job.state = 'sending'; renderPending();
      const fd = new FormData();
      fd.append('text', job.text); fd.append('clientKey', job.key);
      if (job.replyTo) fd.append('replyTo', job.replyTo);
      job.files.forEach((f) => fd.append('files', f));
      try {
        await upload(`/chats/${id}/messages`, fd);
        T.queue = T.queue.filter((x) => x !== job);
        if (S.thread === T) { renderPending(); T.pin = true; await pull(); }
      } catch (ex) { job.state = 'failed'; job.err = ex.message; if (S.thread === T) renderPending(); }
    }
    function setMode(mode) {
      T.mode = mode;
      const bar = $('#mode-bar');
      if (!mode) { bar.hidden = true; bar.innerHTML = ''; return; }
      const m = mode.m;
      bar.innerHTML = `<span class="mb-txt"><b>${mode.kind === 'edit' ? 'Editing your message' : `Replying to ${esc(m.mine ? 'yourself' : m.by)}`}</b><span>${esc(m.text || (m.media[0] ? (m.media[0].type === 'file' ? '📎 ' + m.media[0].name : '📷 Photo') : ''))}</span></span><button type="button" aria-label="Cancel">&times;</button>`;
      bar.hidden = false;
      bar.querySelector('button').onclick = () => { if (T.mode && T.mode.kind === 'edit') { ta.value = ''; grow(); } setMode(null); };
    }
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', grow);

    // ---- @mentions: typing @ suggests the people in this chat, @everyone and @barnmanager
    let handles = null;
    const mbox = $('#mention-box');
    const hideMentions = () => { mbox.hidden = true; mbox.innerHTML = ''; };
    async function suggest() {
      const upto = ta.value.slice(0, ta.selectionStart);
      const mm = upto.match(/(^|[^\w@])@([A-Za-z0-9]*)$/);
      if (!mm) return hideMentions();
      if (!handles) { try { handles = (await api('GET', `/chats/${id}/mentions`)).people; } catch (_) { handles = []; } }
      if (S.thread !== T) return;
      const q = mm[2].toLowerCase();
      const list = handles.filter((h) => !q || h.handle.toLowerCase().startsWith(q) || h.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))).slice(0, 6);
      if (!list.length) return hideMentions();
      mbox.innerHTML = list.map((h) => `<button type="button" role="option" data-handle="${esc(h.handle)}"><b>@${esc(h.handle)}</b><span>${esc(h.name)}${h.tag ? ` · ${esc(h.tag)}` : ''}</span></button>`).join('');
      mbox.hidden = false;
    }
    ta.addEventListener('input', suggest);
    ta.addEventListener('blur', () => setTimeout(hideMentions, 200));
    mbox.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard up
    mbox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-handle]');
      if (!b) return;
      const pos = ta.selectionStart, upto = ta.value.slice(0, pos);
      const start = upto.lastIndexOf('@');
      ta.value = ta.value.slice(0, start) + '@' + b.dataset.handle + ' ' + ta.value.slice(pos);
      const caret = start + b.dataset.handle.length + 2;
      ta.setSelectionRange(caret, caret);
      ta.focus();
      hideMentions(); grow();
    });
    async function send() {
      const text = ta.value.trim();
      if (T.mode && T.mode.kind === 'edit') {
        const m = T.mode.m;
        try { await api('PATCH', `/chats/${id}/messages/${m.id}`, { text }); setMode(null); ta.value = ''; grow(); pull(); } catch (ex) { toast(ex.message); }
        return;
      }
      if (!text && !S.files.length) return;
      const job = { key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, files: S.files.slice(), replyTo: T.mode && T.mode.kind === 'reply' ? T.mode.m.id : '', state: 'sending' };
      T.queue.push(job);
      ta.value = ''; grow(); hideMentions(); S.files = []; $('#file').value = ''; $('#pending').hidden = true; setMode(null);
      T.pin = true; renderPending(); stick();
      deliver(job);
    }
    $('#send').onsubmit = (e) => { e.preventDefault(); send(); };
    $('#attach').onclick = () => $('#file').click();
    $('#file').onchange = (e) => {
      S.files = [...e.target.files].slice(0, 6);
      const p = $('#pending');
      p.hidden = !S.files.length;
      p.textContent = `${S.files.length} ${S.files.length === 1 ? 'file' : 'files'} ready to send: ${S.files.map((f) => f.name).join(', ')}`;
    };

    // ---- a message's menu: hold it (or right-click); double tap = ❤️; swipe right = reply
    let clickBlock = 0;
    box.addEventListener('click', (e) => { if (Date.now() < clickBlock) { e.preventDefault(); e.stopPropagation(); } }, true);
    function press(el, m) {
      if (!el || m.kind === 'system') return;
      let t = null, sx = 0, sy = 0, lastTap = 0;
      const cancel = () => { clearTimeout(t); t = null; el.classList.remove('pressing'); };
      el.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        sx = e.clientX; sy = e.clientY; el.classList.add('pressing');
        t = setTimeout(() => { t = null; el.classList.remove('pressing'); clickBlock = Date.now() + 700; if (navigator.vibrate) navigator.vibrate(12); openMenu(m, el); }, 450);
      });
      el.addEventListener('pointermove', (e) => { if (t && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel(); });
      el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel); el.addEventListener('pointerleave', cancel);
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); openMenu(m, el); });
      if (m.deleted) return;
      el.addEventListener('pointerup', (e) => {
        if (e.button > 0 || e.target.closest('a, button.msg-quote, video, img')) { lastTap = 0; return; }
        const now = Date.now();
        if (now - lastTap < 350) { lastTap = 0; clickBlock = now + 500; react(m, '❤️'); } else lastTap = now;
      });
      let tx = 0, ty = 0, dx = 0, tracking = false, swiping = false;
      el.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; tx = e.touches[0].clientX; ty = e.touches[0].clientY; dx = 0; tracking = true; swiping = false; }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (!tracking) return;
        const x = e.touches[0].clientX - tx, y = e.touches[0].clientY - ty;
        if (!swiping) {
          if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) { tracking = false; return; }
          if (!(x > 12 && x > Math.abs(y) * 1.5)) return;
          swiping = true; cancel();
        }
        dx = Math.max(0, Math.min(x, 90));
        el.style.transform = `translateX(${dx}px)`;
        el.classList.toggle('swipe-ready', dx >= 60);
      }, { passive: true });
      const end = () => {
        if (!tracking) return;
        tracking = false;
        if (!swiping) return;
        swiping = false;
        el.classList.remove('swipe-ready');
        el.style.transition = 'transform .18s ease'; el.style.transform = ''; setTimeout(() => { el.style.transition = ''; }, 200);
        clickBlock = Date.now() + 400;
        if (dx >= 60) { setMode({ kind: 'reply', m }); ta.focus({ preventScroll: true }); }
      };
      el.addEventListener('touchend', end, { passive: true }); el.addEventListener('touchcancel', end, { passive: true });
    }
    async function react(m, e) {
      try { await api('POST', `/chats/${id}/messages/${m.id}/react`, { e }); pull(); } catch (ex) { toast(ex.message); }
    }
    function openMenu(m, el) {
      document.querySelectorAll('.msg-selected').forEach((x) => x.classList.remove('msg-selected'));
      el.classList.add('msg-selected');
      const acts = [];
      if (!m.deleted) {
        acts.push(['reply', '↩️', 'Reply']);
        if (m.text) acts.push(['copy', '📋', 'Copy']);
        if (m.mine && m.text && m.kind !== 'sign-request') acts.push(['edit', '✏️', 'Edit']);
        if (!m.mine && m.byId) acts.push(['report', '⚑', 'Report'], ['block', '🚫', `Block ${first(m.by)}`]);
        if (m.mine || (T.chat && T.chat.canModerate)) acts.push(['del_all', '🗑️', 'Remove for everyone', 'danger']);
      }
      acts.push(['del_me', '🙈', 'Remove for me', m.deleted ? 'danger' : '']);
      const mine = ((m.reactions || []).find((x) => x.uid === S.me.id) || {}).e;
      const ov = document.createElement('div');
      ov.id = 'msgMenu';
      ov.innerHTML = `<div class="mm-sheet" role="dialog" aria-label="Message actions">
          ${m.deleted || m.kind === 'sign-request' ? '' : `<div class="mm-reacts">${QUICK_REACTIONS.map((e) => `<button type="button" data-react="${e}" class="${mine === e ? 'on' : ''}" aria-label="React ${e}">${e}</button>`).join('')}</div>`}
          <div class="mm-preview">${esc(m.deleted ? 'This message was deleted' : m.text || (m.media[0] ? (m.media[0].type === 'file' ? '📎 ' + m.media[0].name : '📷 Photo') : ''))}</div>
          ${acts.map(([k, icon, label, cls]) => `<button type="button" class="mm-act ${cls || ''}" data-mm="${k}"><span aria-hidden="true">${icon}</span>${esc(label)}</button>`).join('')}
          <button type="button" class="mm-act mm-cancel" data-mm="cancel">Cancel</button></div>`;
      // The finger that opened it is still down: the sheet waits until it's lifted before taking taps
      let armed = Date.now() + 400;
      ov.addEventListener('click', (e) => { if (Date.now() < armed) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
      const close = () => { ov.remove(); el.classList.remove('msg-selected'); document.removeEventListener('keydown', onKey); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelectorAll('[data-react]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); close(); react(m, b.dataset.react); }; });
      ov.querySelectorAll('[data-mm]').forEach((b) => { b.onclick = async (e) => {
        e.stopPropagation();
        close();
        const a = b.dataset.mm;
        if (a === 'reply') { setMode({ kind: 'reply', m }); ta.focus({ preventScroll: true }); }
        else if (a === 'copy') { try { await navigator.clipboard.writeText(m.text); toast('Copied'); } catch (_) { toast('Couldn’t copy'); } }
        else if (a === 'edit') { setMode({ kind: 'edit', m }); ta.value = m.text; grow(); ta.focus(); }
        else if (a === 'report' || a === 'block') messageSheet(id, m.id, m.byId, m.by, a);
        else if (a === 'del_all') {
          if (!confirm('Remove this message for everyone?')) return;
          try { await api('DELETE', `/chats/${id}/messages/${m.id}?for=all`); pull(); } catch (ex) { toast(ex.message); }
        } else if (a === 'del_me') {
          try { await api('DELETE', `/chats/${id}/messages/${m.id}?for=me`); pull(); } catch (ex) { toast(ex.message); }
        }
      }; });
    }

    // ---- header
    $('#chat-info').onclick = () => peopleSheet(id);
    $('#chat-people').onclick = () => peopleSheet(id);
    const rq = $('#req-sign');
    if (rq) rq.onclick = () => openSheet(`<h2>Request a signature</h2><p class="muted">They get a card in this chat with a Sign button, and it shows in their Documents.</p>
      <form id="rq" novalidate style="margin-top:12px">
        ${[['boarding', 'Boarding agreement'], ['participant', 'Adult participant waiver'], ['minor', 'Minor participant consent']].map(([v, t]) => `<label class="pick"><input type="checkbox" value="${v}"> ${t}</label>`).join('')}
        <div class="field" style="margin-top:10px"><label for="rq-n">Note (optional)</label><input id="rq-n" placeholder="Before Saturday, please"></div>
        <button class="btn btn--red btn--big" type="submit">Send request</button><p class="err" id="rq-err"></p></form>`, (sheet) => {
      $('#rq', sheet).onsubmit = async (e) => {
        e.preventDefault();
        const docIds = [...sheet.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value);
        if (!docIds.length) { $('#rq-err', sheet).textContent = 'Pick at least one document.'; return; }
        try {
          const r = await api('POST', '/admin/sign-requests', { userId: chat.ownerId, docIds, note: $('#rq-n', sheet).value });
          sheet.close();
          toast(r.requested.length ? 'Request sent' : 'Those were already requested');
          pull();
        } catch (ex) { $('#rq-err', sheet).textContent = ex.message; }
      };
    });
  }

  // ------------------------------------------------------------------ report a message, block a person
  function messageSheet(chatId, mid, userId, name, start) {
    openSheet(`<h2>Message from ${esc(name)}</h2>
      <div style="display:grid;gap:10px;margin-top:14px"><button class="btn" type="button" data-x="report">Report this message</button>
      <button class="btn" type="button" data-x="block">Block ${esc(name)}</button></div>`, (sheet) => {
      sheet.querySelector('[data-x="report"]').onclick = () => {
        $('.sheet__body', sheet).innerHTML = `<h2>Report this message</h2><p class="muted">It disappears for you now. The ranch reviews reports within 24 hours and removes anything that breaks the rules.</p>
          <form id="rp" novalidate style="margin-top:10px">${['Spam', 'Harassment or hate', 'Inappropriate photo or video', 'Something else'].map((r, i) => `<label class="pick"><input type="radio" name="reason" value="${r}"${i ? '' : ' checked'}> ${r}</label>`).join('')}
          <div class="field" style="margin-top:10px"><label for="rp-d">More details (optional)</label><input id="rp-d" maxlength="500"></div>
          <button class="btn btn--red btn--big" type="submit">Send report</button><p class="err" id="rp-err"></p></form>`;
        $('#rp', sheet).onsubmit = async (e) => {
          e.preventDefault();
          try {
            await api('POST', `/chats/${chatId}/messages/${mid}/report`, { reason: sheet.querySelector('input[name=reason]:checked').value, details: $('#rp-d', sheet).value });
            sheet.close();
            const el = document.querySelector(`[data-mid="${CSS.escape(mid)}"]`); if (el) el.remove();
            toast('Reported. Thanks for letting us know.');
          } catch (ex) { $('#rp-err', sheet).textContent = ex.message; }
        };
      };
      sheet.querySelector('[data-x="block"]').onclick = () => {
        $('.sheet__body', sheet).innerHTML = `<h2>Block ${esc(name)}?</h2><p class="muted">You won&rsquo;t see their messages in any chat. They aren&rsquo;t told. You can unblock them from the menu at the top.</p>
          <button class="btn btn--red btn--big" type="button" id="bk" style="margin-top:12px">Block</button><p class="err" id="bk-err"></p>`;
        $('#bk', sheet).onclick = async () => {
          try { await api('POST', '/blocks', { userId }); sheet.close(); toast(`${name} is blocked`); route(); } catch (ex) { $('#bk-err', sheet).textContent = ex.message; }
        };
      };
      if (start) sheet.querySelector(`[data-x="${start}"]`).click();
    });
  }

  async function blockedSheet() {
    const { blocked } = await api('GET', '/blocks');
    openSheet(`<h2>Blocked people</h2>${blocked.length ? blocked.map((b) => `<div class="pick" style="justify-content:space-between"><span>${esc(b.name)}</span><button class="req-btn" type="button" data-unblock="${esc(b.id)}">Unblock</button></div>`).join('')
      : '<p class="muted">You haven&rsquo;t blocked anyone. To block someone, hold one of their messages and tap Block.</p>'}`, (sheet) => {
      sheet.onclick = async (e) => {
        if (e.target === sheet) return sheet.close();
        const b = e.target.closest('[data-unblock]');
        if (!b) return;
        try { await api('DELETE', `/blocks/${b.dataset.unblock}`); sheet.close(); toast('Unblocked'); route(); } catch (ex) { toast(ex.message); }
      };
    });
  }

  function deleteAccountSheet() {
    openSheet(`<h2>Delete your account</h2>
      <p class="muted">This closes your account for good. Your name, email, phone and password are erased and you&rsquo;re signed out. Documents you signed stay with the ranch, as the law requires. To use the app again, the ranch would invite you as a new account.</p>
      <form id="da" novalidate style="margin-top:10px"><div class="field"><label for="da-p">Your password</label><input id="da-p" type="password" autocomplete="current-password"></div>
        <button class="btn btn--red btn--big" type="submit">Delete my account</button><p class="err" id="da-err"></p></form>`, (sheet) => {
      $('#da', sheet).onsubmit = async (e) => {
        e.preventDefault();
        try { await api('POST', '/auth/delete-account', { password: $('#da-p', sheet).value }); sheet.close(); location.hash = ''; location.reload(); } catch (ex) { $('#da-err', sheet).textContent = ex.message; }
      };
    });
  }

  // Barn Management: reported messages
  async function reportsView() {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    const { reports } = await api('GET', '/reports');
    view.innerHTML = `<div class="wrap"><a class="back" href="#/home">&lsaquo; Home</a><h1 style="font-size:1.8rem">Reported messages</h1>
      <p class="muted">Remove anything that breaks the rules within 24 hours. A removed message disappears for everyone.</p>
      ${reports.map((r) => `<div class="shift-card" style="margin-top:14px"><p class="state" style="font-size:1rem">${esc(r.reason)} &middot; ${esc(r.chat)}</p>
        <p class="muted" style="margin:4px 0 8px">${esc(r.by)} reported a message from ${esc(r.about)}, ${esc(ago(r.at))}${r.details ? `: &ldquo;${esc(r.details)}&rdquo;` : ''}</p>
        <div class="msg"><div class="msg-bubble">${r.media.map((x) => x.type === 'video' ? `<video src="${esc(x.url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(x.url)}" alt="Photo" data-full="${esc(x.url)}">`).join('')}${esc(r.text)}</div></div>
        <div class="btns" style="margin-top:12px"><button class="btn btn--red" type="button" data-resolve="${esc(r.id)}" data-remove="1">Remove message</button><button class="btn" type="button" data-resolve="${esc(r.id)}">Keep it</button></div></div>`).join('')
        || '<div class="empty">No reported messages.</div>'}</div>`;
    view.querySelectorAll('[data-resolve]').forEach((b) => { b.onclick = async () => {
      try { await api('POST', `/reports/${b.dataset.resolve}/resolve`, { remove: !!b.dataset.remove }); toast(b.dataset.remove ? 'Message removed' : 'Kept'); reportsView(); refreshCounts(); } catch (ex) { toast(ex.message); }
    }; });
  }

  // ------------------------------------------------------------------ groups and direct messages
  async function newChatSheet() {
    const { people } = await api('GET', '/chats/people');
    const team = people.filter((x) => x.role === 'staff');
    openSheet(`<h2>New chat</h2>
      <div class="seg2"><button type="button" class="on" data-tab="group">Group</button><button type="button" data-tab="dm">Direct message</button></div>
      <form id="ng" novalidate>
        <div class="field"><label for="ng-t">Group name</label><input id="ng-t" placeholder="Morning crew" maxlength="60"></div>
        <p class="muted" style="margin:4px 0 2px">People</p>
        ${people.map((x) => `<label class="pick"><input type="checkbox" value="${x.id}"> ${esc(x.name)} <small class="muted">${x.role === 'owner' ? 'owner' : esc((ROLE[x.position] || 'team').toLowerCase())}</small></label>`).join('')}
        <button class="btn btn--red btn--big" type="submit" style="margin-top:12px">Create group</button><p class="err" id="ng-err"></p></form>
      <div id="dm" hidden>${team.map((x) => `<button class="chat-row" type="button" data-dm="${x.id}"><span class="avatar">${esc(x.name.slice(0, 1))}</span><span class="meta"><b>${esc(x.name)}</b><span>${esc(ROLE[x.position] || 'Team')}</span></span></button>`).join('') || '<p class="muted">Nobody else on the team yet.</p>'}</div>`, (sheet) => {
      sheet.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { sheet.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); $('#ng', sheet).hidden = b.dataset.tab !== 'group'; $('#dm', sheet).hidden = b.dataset.tab !== 'dm'; }; });
      $('#ng', sheet).onsubmit = async (e) => {
        e.preventDefault();
        const memberIds = [...sheet.querySelectorAll('#ng input[type=checkbox]:checked')].map((x) => x.value);
        try { const { chat } = await api('POST', '/chats', { type: 'group', title: $('#ng-t', sheet).value, memberIds }); sheet.close(); location.hash = '#/chat/' + chat.id; }
        catch (ex) { $('#ng-err', sheet).textContent = ex.message; }
      };
      sheet.querySelectorAll('[data-dm]').forEach((b) => { b.onclick = async () => {
        try { const { chat } = await api('POST', '/chats', { type: 'dm', userId: b.dataset.dm }); sheet.close(); location.hash = '#/chat/' + chat.id; } catch (ex) { toast(ex.message); }
      }; });
    });
  }

  // People in a chat: who's in it, add or remove people (managers, the office, Barn Management, a group's creator), rename, leave.
  // Works on every chat: Workers and Boarders keep their automatic lists plus whoever is added, an owner's chat can take
  // a co-owner or a trainer, and adding someone to a direct message turns it into a group.
  async function peopleSheet(chatId) {
    let p;
    try { p = await api('GET', `/chats/${chatId}/people`); } catch (ex) { toast(ex.message); return; }
    let q = '';
    const refreshThread = () => { if (S.thread && S.thread.id === chatId && S.thread.pull) S.thread.pull(); };
    openSheet(`<h2 id="ps-title">${esc(p.title)}</h2>
      ${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}
      ${p.canRename ? `<form id="ps-rn" class="row-form" novalidate style="margin-top:12px"><input id="ps-t" value="${esc(p.title)}" aria-label="Group name" maxlength="60"><button class="btn" type="submit">Rename</button></form>` : ''}
      <input class="chat-search" id="ps-q" type="search" placeholder="Search people" aria-label="Search people" autocomplete="off" style="margin-top:12px">
      <div id="ps-list"></div>
      ${p.canLeave ? '<button class="btn" type="button" id="ps-leave" style="margin-top:16px">Leave this chat</button>' : ''}<p class="err" id="ps-err"></p>`, (sheet) => {
      const list = $('#ps-list', sheet), err = (ex) => { $('#ps-err', sheet).textContent = ex.message; };
      const row = (x, act) => `<div class="cp-row"><span class="avatar cp-av" aria-hidden="true">${esc(x.name.slice(0, 1))}</span>
        <span class="cp-name"><b>${esc(x.name)}${x.you ? ' (you)' : ''}</b><small>${esc(x.tag)}${x.owner ? ' · owns this chat' : ''}${x.added ? ' · added' : ''}</small></span>${act}</div>`;
      const paint = () => {
        const s = q.trim().toLowerCase();
        const match = (x) => !s || x.name.toLowerCase().includes(s) || (x.tag || '').includes(s);
        const members = p.members.filter(match), others = p.others.filter(match);
        list.innerHTML = `<p class="section-label">In this chat · ${p.members.length}</p>
          ${members.map((x) => row(x, p.canManage && !x.you && !x.owner && p.type !== 'dm' ? `<button type="button" class="cp-btn" data-rm="${esc(x.id)}" data-name="${esc(x.name)}">Remove</button>` : '')).join('') || '<p class="muted">Nobody matches.</p>'}
          ${p.canManage ? `<p class="section-label">Add someone</p>${others.map((x) => row(x, `<button type="button" class="cp-btn cp-add" data-add="${esc(x.id)}">Add</button>`)).join('')
            || `<p class="muted">${s ? 'Nobody matches.' : 'Everyone is already in this chat.'}</p>`}`
            : '<p class="muted" style="margin-top:14px">To add someone, ask a manager or the office.</p>'}`;
      };
      paint();
      $('#ps-q', sheet).oninput = (e) => { q = e.target.value; paint(); };
      list.onclick = async (e) => {
        const b = e.target.closest('[data-add],[data-rm]');
        if (!b) return;
        if (b.dataset.rm && !confirm(`Remove ${b.dataset.name} from this chat?`)) return;
        b.disabled = true;
        try {
          p = await api('POST', `/chats/${chatId}/people`, b.dataset.add ? { add: [b.dataset.add] } : { remove: [b.dataset.rm] });
          $('#ps-err', sheet).textContent = '';
          $('#ps-title', sheet).textContent = p.title;
          paint();
          toast(b.dataset.add ? 'Added' : 'Removed');
          refreshThread();
        } catch (ex) { b.disabled = false; err(ex); }
      };
      const rn = $('#ps-rn', sheet);
      if (rn) rn.onsubmit = async (e) => {
        e.preventDefault();
        try { await api('PATCH', `/chats/${chatId}`, { title: $('#ps-t', sheet).value }); sheet.close(); toast('Renamed'); route(); } catch (ex) { err(ex); }
      };
      const lv = $('#ps-leave', sheet);
      if (lv) lv.onclick = async () => {
        if (!confirm('Leave this chat? Someone in it can add you back.')) return;
        try { await api('DELETE', `/chats/${chatId}/members/${S.me.id}`); sheet.close(); location.hash = '#/messages'; } catch (ex) { err(ex); }
      };
    });
  }

  // ------------------------------------------------------------------ waivers for clients (lesson program, office)
  // The "Instructor & insurance information" box on the riding waivers: filled in once here, copied into each signature
  async function instructorSheet() {
    const { fields, values } = await api('GET', '/admin/instructor');
    openSheet(`<h2>Instructor and insurance</h2>
      <p class="muted">This fills in the instructor and insurance box on the adult waiver and the minor consent. Each signature keeps what&rsquo;s here on the day it&rsquo;s signed.</p>
      <form id="ins" novalidate style="margin-top:12px">
        ${fields.map((f) => (f.options
          ? `<div class="field"><label for="ins-${f.key}">${esc(f.label)}</label><select id="ins-${f.key}" name="${f.key}"><option value="">Not answered</option>${f.options.map((o) => `<option${values[f.key] === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`
          : `<div class="field"><label for="ins-${f.key}">${esc(f.label)}</label><input id="ins-${f.key}" name="${f.key}" value="${esc(values[f.key] || '')}"${f.key === 'iEmail' ? ' type="email"' : f.key === 'iPhone' ? ' type="tel"' : ''} autocomplete="off"></div>`)).join('')}
        <button class="btn btn--red btn--big" type="submit">Save</button><p class="err" id="ins-err"></p></form>`, (sheet) => {
      $('#ins', sheet).onsubmit = async (e) => {
        e.preventDefault();
        try { await api('PATCH', '/admin/instructor', Object.fromEntries(new FormData(e.target))); sheet.close(); toast('Saved. New signatures show these details.'); }
        catch (ex) { $('#ins-err', sheet).textContent = ex.message; }
      };
    });
  }

  function clientWaiverSheet() {
    openSheet(`<h2>Send waivers</h2><p class="muted">The client gets an email with a button for each document. You can also text the links.</p>
      <form id="cw" novalidate style="margin-top:12px">
        <div class="field"><label for="cw-n">Client name</label><input id="cw-n" autocomplete="off"></div>
        <div class="field"><label for="cw-e">Email</label><input id="cw-e" type="email" autocomplete="off"></div>
        <div class="field"><label for="cw-p">Phone (to text the links)</label><input id="cw-p" type="tel" autocomplete="off"></div>
        ${[['participant', 'Adult participant waiver (18 and over)', true], ['minor', 'Minor participant consent (under 18, a parent signs)', false], ['boarding', 'Boarding agreement', false]].map(([v, t, on]) => `<label class="pick"><input type="checkbox" value="${v}"${on ? ' checked' : ''}> ${t}</label>`).join('')}
        <div class="field" style="margin-top:10px"><label for="cw-note">Note (optional)</label><input id="cw-note" placeholder="See you Saturday at 9"></div>
        <button class="btn btn--red btn--big" type="submit">Send</button><p class="err" id="cw-err"></p></form><div id="cw-done"></div>`, (sheet) => {
      $('#cw', sheet).onsubmit = async (e) => {
        e.preventDefault();
        const body = { name: $('#cw-n', sheet).value, email: $('#cw-e', sheet).value, phone: $('#cw-p', sheet).value, note: $('#cw-note', sheet).value,
          docIds: [...sheet.querySelectorAll('#cw input[type=checkbox]:checked')].map((x) => x.value) };
        try {
          const r = await api('POST', '/admin/client-waivers', body);
          const text = `Hi ${body.name.split(' ')[0]}, please sign before your lesson at Winning Ranch:\n` + r.links.map((l) => `${l.doc}: ${l.url}`).join('\n');
          $('#cw', sheet).hidden = true;
          $('#cw-done', sheet).innerHTML = `<p class="ok-line">${r.emailed ? `Emailed to ${esc(body.email)}.` : body.email ? `The email didn&rsquo;t go out (${esc(r.emailError || 'email not set up')}). Text the links instead.` : 'Ready to text.'}</p>
            ${body.phone ? `<a class="btn btn--red btn--big" href="sms:${esc(body.phone)}?&body=${encodeURIComponent(text)}">Text the links</a>` : ''}
            <button class="btn" type="button" id="cw-copy" style="margin-top:8px">Copy the links</button>`;
          $('#cw-copy', sheet).onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Links copied'); } catch (_) { toast('Couldn’t copy'); } };
        } catch (ex) { $('#cw-err', sheet).textContent = ex.message; }
      };
    });
  }

  async function sentView() {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    const { requests } = await api('GET', '/admin/client-waivers');
    view.innerHTML = `<div class="wrap"><a class="back" href="#/home">&lsaquo; Home</a><div class="msgs-head"><h1 style="font-size:1.8rem">Waivers you sent</h1><button class="req-btn" type="button" data-act="client-waivers">+ Send</button></div>
      ${requests.length ? requests.map((q) => `<article class="doc-card ${q.status === 'signed' ? 'signed' : 'requested'}"><div class="doc-card__top"><span class="feature__ic">${ic('pen')}</span>
        <div><h3>${esc(q.name)}</h3><p>${esc(q.doc)}: ${q.status === 'signed' ? `<b class="ok">signed ${esc(ago(q.signedAt))}</b>` : q.status === 'cancelled' ? 'cancelled' : `waiting, sent ${esc(ago(q.requestedAt))}`}</p>
        <p>${esc([q.email, q.phone].filter(Boolean).join(', '))}${pos() !== 'lessons' ? ` &middot; by ${esc(q.requestedBy)}` : ''}</p></div></div></article>`).join('')
        : '<div class="empty">Nothing sent yet. Tap Send to email a client their waivers.</div>'}</div>`;
  }

  // ------------------------------------------------------------------ documents
  async function documentsView() {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    const { docs, w9 } = await api('GET', '/my/documents');
    const date = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
    const card = (d) => {
      const latest = d.signed[0];
      const status = d.status === 'requested' ? `Requested by ${esc(d.request.by)}, ${esc(ago(d.request.at))}${d.request.note ? `: ${esc(d.request.note)}` : ''}`
        : d.status === 'signed' ? `Signed ${esc(date(latest.at))}${latest.horse ? ` for ${esc(latest.horse)}` : ''}${latest.countersigned ? ', countersigned by the ranch' : ''}`
          : `${esc(d.who)} About ${d.minutes} min.`;
      const more = d.signed.slice(1).map((w) => `<a class="textlink" href="/api/ranch/my/waivers/${w.id}/copy">${esc(date(w.at))}${w.horse ? `, ${esc(w.horse)}` : ''}</a>`).join(' ');
      return `<article class="doc-card ${d.status}"><div class="doc-card__top"><span class="feature__ic">${ic('pen')}</span><div><h3>${esc(d.title)}</h3><p>${status}</p></div></div>
        <div class="doc-card__actions">${d.status === 'signed'
          ? `<a class="btn" href="/api/ranch/my/waivers/${latest.id}/copy">View signed copy</a>${d.id === 'boarding' ? `<a class="btn" href="/sign.html?doc=boarding&app=1">Sign for another horse</a>` : ''}`
          : `<a class="btn btn--red" href="/sign.html?doc=${esc(d.id)}&app=1">Sign now</a>`}</div>
        ${more ? `<p class="muted doc-card__more">Earlier: ${more}</p>` : ''}</article>`;
    };
    const group = (title, list) => (list.length ? `<p class="section-label">${title}</p>${list.map(card).join('')}` : '');
    view.innerHTML = `<div class="wrap"><a class="back" href="#/home">&lsaquo; Home</a><h1 style="font-size:1.8rem">Documents</h1>
      <p class="muted">Sign right here on your phone. Your name and contact details are filled in for you.</p>
      ${group('To sign', docs.filter((d) => d.status === 'requested'))}
      ${group('Signed', docs.filter((d) => d.status === 'signed'))}
      ${group(docs.some((d) => d.status !== 'available') ? 'Other documents' : 'Your documents', docs.filter((d) => d.status === 'available'))}
      ${w9 ? `<p class="section-label">Tax form</p><article class="doc-card"><div class="doc-card__top"><span class="feature__ic">${ic('doc')}</span><div><h3>Form W-9</h3><p>Download it, fill it out and hand it to the office. We don&rsquo;t collect Social Security numbers online.</p></div></div>
        <div class="doc-card__actions"><a class="btn" href="/doc.html?file=w9">Open the W-9</a></div></article>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ post an update (team)
  const QUICK_TAGS = ['✅ Fed', '💧 Watered', '🧹 Stall cleaned', '🧥 Blanket on', '🪰 Fly mask on', '🏇 Turned out'];
  async function postSheet() {
    const { horses } = await api('GET', '/admin/horses');
    const active = horses.filter((x) => x.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    if (!active.length) { toast('Add a horse in the dashboard first.'); return; }
    const lastId = localStorage.getItem('wr-last-horse');
    openSheet(`<h2>Post an update</h2><form id="post" novalidate>
      <div class="field"><label for="p-h">Horse</label><select id="p-h">${active.map((x) => `<option value="${x.id}"${x.id === lastId ? ' selected' : ''}>${esc(x.name)}${x.stallName ? `, ${esc(x.stallName)}` : ''}</option>`).join('')}</select></div>
      <div class="quick-tags" role="group" aria-label="Quick notes">${QUICK_TAGS.map((t) => `<button type="button" class="qt" data-tag="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}</div>
      <div class="field"><label for="p-c">What&rsquo;s new?</label><textarea id="p-c" rows="3" placeholder="Ate all his breakfast, then an hour in the round pen."></textarea></div>
      <input type="file" id="p-f" accept="image/*,video/*" multiple hidden>
      <button class="btn" type="button" id="p-add">${ic('camera')}&nbsp; Add photos or videos</button>
      <div class="thumbs" id="p-t"></div><div class="bar" id="p-bar" hidden><i></i></div>
      <button class="btn btn--red btn--big" type="submit" style="margin-top:10px">Post to the owner</button><p class="err" id="p-err"></p></form>`, (sheet) => {
      let files = [];
      // Fed, watered…: one tap adds the line to the note (tap again to take it out), then add a photo of the horse or stall
      const cap = $('#p-c', sheet);
      sheet.querySelectorAll('[data-tag]').forEach((b) => { b.onclick = () => {
        const tag = b.dataset.tag;
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        // the picked ones first, in the order of the buttons, then whatever they typed
        const typed = cap.value.split(/\r?\n/).filter((l) => !QUICK_TAGS.includes(l.trim()));
        const picked = QUICK_TAGS.filter((t) => sheet.querySelector(`[data-tag="${t}"]`).getAttribute('aria-pressed') === 'true');
        cap.value = [...picked, ...typed].join(String.fromCharCode(10)).trim();
      }; });
      $('#p-add', sheet).onclick = () => $('#p-f', sheet).click();
      $('#p-f', sheet).onchange = (e) => { files = files.concat([...e.target.files]); $('#p-t', sheet).innerHTML = files.map((f) => f.type.startsWith('image') ? `<img src="${URL.createObjectURL(f)}" alt="">` : '<span class="muted">Video</span>').join(''); };
      $('#post', sheet).onsubmit = async (e) => {
        e.preventDefault();
        const caption = $('#p-c', sheet).value.trim();
        if (!caption && !files.length) { $('#p-err', sheet).textContent = 'Add a photo, a video or a note.'; return; }
        const fd = new FormData(); fd.append('horseId', $('#p-h', sheet).value); fd.append('caption', caption); files.forEach((f) => fd.append('files', f));
        const bar = $('#p-bar', sheet); bar.hidden = !files.length;
        try {
          await upload('/admin/updates', fd, (p) => { bar.firstElementChild.style.width = Math.round(p * 100) + '%'; });
          localStorage.setItem('wr-last-horse', $('#p-h', sheet).value);
          sheet.close(); toast('Posted. The owner sees it now.');
        } catch (ex) { $('#p-err', sheet).textContent = ex.message; }
      };
    });
  }

  // ------------------------------------------------------------------ chrome: sheet, lightbox, menu, bell
  function openSheet(html, wire) {
    const s = $('#sheet');
    // The X closes natively (method="dialog") and stays in reach while a long sheet scrolls
    s.innerHTML = `<form method="dialog" class="sheet__bar"><button class="sheet__x" aria-label="Close">&times;</button></form><div class="sheet__body">${html}</div>`;
    s.showModal();
    s.onclick = (e) => { if (e.target === s) s.close(); };
    wire(s);
  }
  document.addEventListener('click', (e) => {
    const full = e.target.closest('[data-full]');
    if (full) { const lb = $('#lightbox'); $('img', lb).src = full.dataset.full; lb.showModal(); return; }
    const a = e.target.closest('[data-act]');
    if (a) { if (a.dataset.act === 'post') postSheet(); else if (a.dataset.act === 'client-waivers') clientWaiverSheet(); else if (a.dataset.act === 'instructor') instructorSheet(); else shiftAct(a.dataset.act, a); }
  });
  $('#lightbox').onclick = () => $('#lightbox').close();
  $('#fab').onclick = () => postSheet();
  $('#role-chip').onclick = (e) => { e.stopPropagation(); $('#notif').hidden = true; $('#menu').hidden = !$('#menu').hidden; };
  $('#menu').onclick = async (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    if (b.dataset.menu === 'theme') { const t = document.documentElement.dataset.theme === 'dark' ? 'ranch' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('wr-app-theme', t); }
    if (b.dataset.menu === 'logout') { await api('POST', '/auth/logout').catch(() => {}); location.hash = ''; location.reload(); }
    $('#menu').hidden = true;
    if (b.dataset.menu === 'blocked') blockedSheet().catch((ex) => toast(ex.message));
    if (b.dataset.menu === 'delete') deleteAccountSheet();
  };
  $('#bell').onclick = async (e) => {
    e.stopPropagation(); $('#menu').hidden = true;
    const n = $('#notif');
    if (!n.hidden) { n.hidden = true; return; }
    await refreshCounts();
    const h = S.home; const items = [];
    if (h.toSign) items.push(`<a href="#/documents"><b>The ranch asked you to sign ${h.toSign} document${h.toSign === 1 ? '' : 's'}</b><small>Open Documents</small></a>`);
    if (h.unread) items.push(`<a href="#/messages"><b>${h.unread} unread message${h.unread === 1 ? '' : 's'}</b><small>Open Messages</small></a>`);
    h.horses.filter((x) => x.fresh).forEach((x) => items.push(`<a href="#/horse/${x.id}"><b>${x.fresh} new update${x.fresh === 1 ? '' : 's'} on ${esc(x.name)}</b><small>${esc(x.latest ? x.latest.caption || 'New photo' : '')}</small></a>`));
    if (h.pendingBookings) items.push(`<a href="/admin/#/bookings"><b>${h.pendingBookings} booking request${h.pendingBookings === 1 ? '' : 's'}</b><small>Waiting for you</small></a>`);
    if (h.reports) items.push(`<a href="#/reports"><b>${h.reports} reported message${h.reports === 1 ? '' : 's'}</b><small>Review within 24 hours</small></a>`);
    if (h.shiftRequests) items.push(`<a href="/admin/#/schedule"><b>${h.shiftRequests} shift request${h.shiftRequests === 1 ? '' : 's'} to approve</b><small>Open the schedule</small></a>`);
    (h.shiftAnswers || []).forEach((q) => items.push(`<a href="/admin/#/schedule"><b>${q.status === 'approved' ? 'Approved' : 'Declined'}: ${esc(q.kind === 'swap' ? `your swap for ${q.withName}’s ${q.toLabel}` : `taking ${q.withName}’s ${q.toLabel}`)}</b><small>${esc(q.decidedBy ? `By ${q.decidedBy}` : 'Open the schedule')}</small></a>`));
    if (h.waiversToCountersign) items.push(`<a href="/admin/#/waivers"><b>${h.waiversToCountersign} waiver${h.waiversToCountersign === 1 ? '' : 's'} to countersign</b><small>Open Waivers</small></a>`);
    n.innerHTML = `<h3>Notifications</h3>${items.join('') || '<p class="muted" style="padding:8px 10px">You&rsquo;re all caught up.</p>'}`;
    n.hidden = false;
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu, .notif, #bell, #role-chip')) { $('#menu').hidden = true; $('#notif').hidden = true; } });

  boot();
})();
