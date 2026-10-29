/* Winning Ranch app (POC). One login for owners and the ranch team, like the Winning App:
   Home (by role) + Messages in the bottom bar, the camera button for the team, a bell for news. */
(() => {
  const API = '/api/ranch';
  const TZ = 'America/Los_Angeles';
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { me: null, home: null, poll: 0, threadPoll: 0, files: [] };
  const ROLE = { owner: 'Owner', hand: 'Ranch hand', manager: 'Ranch manager', office: 'Office', lessons: 'Lesson program' };
  const inChats = () => pos() !== 'lessons';
  const pos = () => (S.me && S.me.role === 'staff' ? S.me.position || 'office' : 'owner');
  const isStaff = () => S.me && S.me.role === 'staff';

  // ------------------------------------------------------------------ helpers
  async function api(method, path, body) {
    const o = { method, headers: {} };
    if (body instanceof FormData) o.body = body;
    else if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    const res = await fetch(API + path, o);
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
    clearInterval(S.threadPoll);
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
    return homeView();
  }
  window.addEventListener('hashchange', () => S.me && route());

  async function refreshCounts() {
    try {
      S.home = await api('GET', '/app/home');
      const fresh = S.home.horses.reduce((t, x) => t + x.fresh, 0);
      const extra = (S.home.pendingBookings || 0) + (S.home.waiversToCountersign || 0);
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
        <p>No login yet? The ranch sends you a link when your horse checks in.</p>
        <div class="visit"><span>Visiting the ranch?</span>
          <a href="/stalls.html">Book a stall</a><a href="/waivers.html">Sign waivers</a><a href="/home.html">Explore the ranch</a></div>
      </form></div>`;
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/auth/login', { email: $('#li-e').value, password: $('#li-p').value }); location.hash = '#/home'; boot(); }
      catch (ex) { $('#li-err').textContent = ex.message; }
    };
  }

  // ------------------------------------------------------------------ invite link: create a password
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
      body += feature({ act: 'client-waivers', icon: 'pen', title: 'Send waivers', sub: 'Lesson packet and liability waiver, by email or text' });
      body += feature({ href: '#/sent', icon: 'doc', title: 'Waivers you sent', sub: 'See who signed and who still needs to' });
      body += `<p class="section-label">More</p><div class="tiles">${tile('/waivers.html', 'doc', 'Waivers page')}${tile('/stalls.html', 'map', 'Ranch map')}${tile('/home.html', 'globe', 'Website')}</div>`;
    } else {
      if (h.shift !== null && h.shift !== undefined) body += shiftCard(h.shift);
      body += `<p class="section-label">Today</p>`;
      if (h.shift) body += feature({ href: '#/checklist', icon: 'check', title: 'Shift checklist', sub: `${h.shift.done.done} of ${h.shift.done.total} done` });
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
      ${updates.length ? updates.map((u) => {
        const d = day(u.createdAt); const head = d !== lastDay ? `<p class="day">${esc(d)}</p>` : ''; lastDay = d;
        const imgs = u.media.filter((m) => m.type === 'image'), vids = u.media.filter((m) => m.type === 'video');
        return `${head}<article class="post"><div class="post__head"><b>${esc(u.authorName)}</b><span>${esc(time(u.createdAt))}</span></div>
          ${u.caption ? `<p class="post__text">${esc(u.caption)}</p>` : '<div style="height:10px"></div>'}
          ${imgs.length || vids.length ? `<div class="post__media${imgs.length === 1 && !vids.length ? ' one' : ''}">${imgs.map((m) => `<button type="button" data-full="${esc(m.url)}"><img src="${esc(m.url)}" alt="Photo of ${esc(horse.name)}" loading="lazy"></button>`).join('')}${vids.map((m) => `<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>`).join('')}</div>` : ''}</article>`;
      }).join('') : '<div class="empty" style="margin-top:16px">No updates yet.</div>'}</div>`;
  }

  // ------------------------------------------------------------------ messages
  async function messagesView() {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    const { chats } = await api('GET', '/chats');
    view.innerHTML = `<div class="wrap"><div class="msgs-head"><h1 style="font-size:1.8rem">Messages</h1>${isStaff() ? '<button class="req-btn" type="button" id="new-chat">+ New</button>' : ''}</div>
      ${chats.map((c) => `<a class="chat-row" href="#/chat/${c.id}"><span class="avatar ${c.type === 'channel' ? 'team' : ''}">${esc((c.title || '?').slice(0, 1))}</span>
        <span class="meta"><b>${esc(c.title)}</b><span>${c.last ? `${esc(c.last.by)}: ${esc(c.last.text)}` : c.about ? esc(c.about) : 'No messages yet'}</span></span>
        <span class="side">${c.last ? esc(ago(c.last.at)) : ''}${c.unread ? `<br><b class="unread">${c.unread}</b>` : ''}</span></a>`).join('') || '<div class="empty">No chats yet.</div>'}</div>`;
    const nb = $('#new-chat');
    if (nb) nb.onclick = newChatSheet;
  }

  async function chatView(id) {
    view.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    const { chat, messages } = await api('GET', `/chats/${id}/messages`);
    let last = messages.length ? messages[messages.length - 1].at : '';
    S.files = [];
    view.innerHTML = `<div class="wrap thread">
      <div class="thread__head"><a class="back" href="#/messages" style="margin:0">&lsaquo;</a><span class="avatar ${chat.type === 'channel' ? 'team' : ''}" style="width:38px;height:38px">${esc(chat.title.slice(0, 1))}</span>${chat.type === 'group' || chat.type === 'channel' ? `<button class="title-btn" type="button" id="group-info"><b>${esc(chat.title)}</b><small>${chat.members.length} people</small></button>` : `<b>${esc(chat.title)}</b>`}
        ${chat.type === 'owner' && isStaff() && pos() !== 'hand' ? '<button class="req-btn" type="button" id="req-sign">Request signature</button>' : ''}</div>
      <div class="thread__msgs" id="msgs"></div></div>
      <div class="composer"><p class="pending" id="pending" hidden></p><form id="send" novalidate>
        <button class="attach" type="button" id="attach" aria-label="Add a photo">${ic('camera')}</button>
        <input type="file" id="file" accept="image/*,video/*" multiple hidden>
        <textarea id="text" rows="1" placeholder="Message" aria-label="Message"></textarea>
        <button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg></button></form></div>`;
    const box = $('#msgs');
    const team = chat.type !== 'owner' || isStaff(); // show who wrote each message, except in an owner's own chat with the ranch
    let prevBy = null;
    const add = (list) => {
      box.insertAdjacentHTML('beforeend', list.map((m) => {
        const who = !m.mine && team && m.by !== prevBy ? `<span class="who">${esc(m.by)}</span>` : '';
        prevBy = m.mine ? null : m.by;
        if (m.kind === 'system') { prevBy = null; return `<p class="sys">${esc(m.text)} &middot; ${esc(time(m.at))}</p>`; }
        if (m.kind === 'sign-request') {
          return `<div class="msg ${m.mine ? 'mine' : ''}">${who}<div class="sign-card"><b>Signature requested</b>
            ${m.docs.map((d) => `<div class="sign-card__row"><span>${esc(d.title)}</span>${d.status === 'signed' ? '<em class="ok">Signed</em>' : d.status === 'cancelled' ? '<em>Cancelled</em>' : isStaff() ? '<em>Waiting</em>' : `<a class="sign-go" href="/sign.html?doc=${esc(d.id)}&app=1">Sign</a>`}</div>`).join('')}
            ${m.text.includes('. ') ? `<p class="muted">${esc(m.text.split('. ').slice(1).join('. '))}</p>` : ''}</div><time>${esc(time(m.at))}</time></div>`;
        }
        return `<div class="msg ${m.mine ? 'mine' : ''}">${who}<div class="msg-bubble">${m.media.map((x) => x.type === 'video' ? `<video src="${esc(x.url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(x.url)}" alt="Photo" data-full="${esc(x.url)}">`).join('')}${esc(m.text)}</div><time>${esc(time(m.at))}</time></div>`;
      }).join(''));
      window.scrollTo(0, document.body.scrollHeight);
    };
    add(messages);
    if (!messages.length) box.innerHTML = `<p class="muted" style="text-align:center;margin-top:30px">${chat.type === 'channel' ? `Say hi to everyone in ${esc(chat.title)}.` : isStaff() ? 'Start the conversation with this owner.' : 'Ask the ranch anything. The team usually answers fast.'}</p>`;
    api('POST', `/chats/${id}/read`).then(refreshCounts).catch(() => {});
    const pull = async (includeMine) => {
      try {
        const r = await api('GET', `/chats/${id}/messages?after=${encodeURIComponent(last)}`);
        const fresh = r.messages.filter((m) => includeMine || !m.mine);
        if (r.messages.length) { if (!last) box.innerHTML = ''; last = r.messages[r.messages.length - 1].at; if (fresh.length) { add(fresh); api('POST', `/chats/${id}/read`).catch(() => {}); } }
      } catch (_) {}
    };
    S.threadPoll = setInterval(() => { if (!document.hidden) pull(false); }, 4000);
    const gi = $('#group-info');
    if (gi) gi.onclick = () => groupSheet(chat);
    const rq = $('#req-sign');
    if (rq) rq.onclick = () => openSheet(`<h2>Request a signature</h2><p class="muted">They get a card in this chat with a Sign button, and it shows in their Documents.</p>
      <form id="rq" novalidate style="margin-top:12px">
        ${[['boarding', 'Boarding agreement'], ['lesson', 'Adult lesson packet'], ['liability', 'Adult liability waiver']].map(([v, t]) => `<label class="pick"><input type="checkbox" value="${v}"> ${t}</label>`).join('')}
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
          pull(true);
        } catch (ex) { $('#rq-err', sheet).textContent = ex.message; }
      };
    });
    const ta = $('#text');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
    $('#attach').onclick = () => $('#file').click();
    $('#file').onchange = (e) => { S.files = [...e.target.files].slice(0, 6); const p = $('#pending'); p.hidden = !S.files.length; p.textContent = `${S.files.length} photo${S.files.length === 1 ? '' : 's'} ready to send`; };
    $('#send').onsubmit = async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text && !S.files.length) return;
      const fd = new FormData(); fd.append('text', text); S.files.forEach((f) => fd.append('files', f));
      const btn = e.target.querySelector('.send'); btn.disabled = true;
      try {
        const { message } = await upload(`/chats/${id}/messages`, fd);
        if (!last) box.innerHTML = '';
        last = message.at; add([message]);
        ta.value = ''; ta.style.height = 'auto'; S.files = []; $('#file').value = ''; $('#pending').hidden = true;
      } catch (ex) { toast(ex.message); } finally { btn.disabled = false; }
    };
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

  async function groupSheet(chat) {
    const fixed = chat.type === 'channel'; // the fixed chats keep their names; only Barn Management has a hand-picked list
    const { people: all } = chat.canManage ? await api('GET', '/chats/people') : { people: [] };
    const people = fixed ? all.filter((p) => p.role === 'staff') : all;
    const inGroup = new Set(chat.members.map((m) => m.id));
    openSheet(`<h2>${esc(chat.title)}</h2>
      ${fixed ? `<p class="muted">${chat.key === 'management' ? 'Only the people below see this chat. Anyone in it can add or remove people.' : `${esc(chat.about)} are in this chat automatically.`}</p>` : ''}
      ${chat.canManage && !fixed ? `<form id="gr" class="row-form" novalidate><input id="gr-t" value="${esc(chat.title)}" aria-label="Group name" maxlength="60"><button class="btn" type="submit">Rename</button></form>` : ''}
      <p class="section-label">${chat.members.length} people</p>
      ${chat.members.map((m) => `<div class="member"><span class="avatar" style="width:36px;height:36px;font-size:.9rem">${esc(m.name.slice(0, 1))}</span><span>${esc(m.name)}${m.id === S.me.id ? ' (you)' : ''}</span>
        ${chat.canManage && m.id !== S.me.id ? `<button type="button" class="linkish" data-rm="${m.id}">Remove</button>` : ''}</div>`).join('')}
      ${chat.canManage && people.some((p) => !inGroup.has(p.id)) ? `<p class="section-label">Add people</p><form id="ga" novalidate>${people.filter((p) => !inGroup.has(p.id)).map((p) => `<label class="pick"><input type="checkbox" value="${p.id}"> ${esc(p.name)}</label>`).join('')}<button class="btn" type="submit" style="margin-top:10px">Add to ${fixed ? 'this chat' : 'group'}</button></form>` : ''}
      ${!fixed || chat.key === 'management' ? `<button class="btn" type="button" id="g-leave" style="margin-top:16px">Leave ${fixed ? 'this chat' : 'group'}</button>` : ''}<p class="err" id="g-err"></p>`, (sheet) => {
      const err = (ex) => { $('#g-err', sheet).textContent = ex.message; };
      const done = (msg) => { sheet.close(); toast(msg); route(); };
      const rn = $('#gr', sheet);
      if (rn) rn.onsubmit = async (e) => { e.preventDefault(); try { await api('PATCH', `/chats/${chat.id}`, { title: $('#gr-t', sheet).value }); done('Group renamed'); } catch (ex) { err(ex); } };
      const ga = $('#ga', sheet);
      if (ga) ga.onsubmit = async (e) => { e.preventDefault(); const userIds = [...ga.querySelectorAll('input:checked')].map((x) => x.value); try { await api('POST', `/chats/${chat.id}/members`, { userIds }); done('Added'); } catch (ex) { err(ex); } };
      sheet.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { try { await api('DELETE', `/chats/${chat.id}/members/${b.dataset.rm}`); done('Removed'); } catch (ex) { err(ex); } }; });
      const lv = $('#g-leave', sheet);
      if (lv) lv.onclick = async () => { if (!confirm(fixed ? 'Leave this chat? Someone in it can add you back.' : 'Leave this group?')) return; try { await api('DELETE', `/chats/${chat.id}/members/${S.me.id}`); sheet.close(); location.hash = '#/messages'; } catch (ex) { err(ex); } };
    });
  }

  // ------------------------------------------------------------------ waivers for clients (lesson program, office)
  function clientWaiverSheet() {
    openSheet(`<h2>Send waivers</h2><p class="muted">The client gets an email with a button for each document. You can also text the links.</p>
      <form id="cw" novalidate style="margin-top:12px">
        <div class="field"><label for="cw-n">Client name</label><input id="cw-n" autocomplete="off"></div>
        <div class="field"><label for="cw-e">Email</label><input id="cw-e" type="email" autocomplete="off"></div>
        <div class="field"><label for="cw-p">Phone (to text the links)</label><input id="cw-p" type="tel" autocomplete="off"></div>
        ${[['lesson', 'Adult lesson packet', true], ['liability', 'Adult liability waiver', true], ['boarding', 'Boarding agreement', false]].map(([v, t, on]) => `<label class="pick"><input type="checkbox" value="${v}"${on ? ' checked' : ''}> ${t}</label>`).join('')}
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
      const more = d.signed.slice(1).map((w) => `<a class="textlink" href="/api/ranch/my/waivers/${w.id}/copy" target="_blank" rel="noopener">${esc(date(w.at))}${w.horse ? `, ${esc(w.horse)}` : ''}</a>`).join(' ');
      return `<article class="doc-card ${d.status}"><div class="doc-card__top"><span class="feature__ic">${ic('pen')}</span><div><h3>${esc(d.title)}</h3><p>${status}</p></div></div>
        <div class="doc-card__actions">${d.status === 'signed'
          ? `<a class="btn" href="/api/ranch/my/waivers/${latest.id}/copy" target="_blank" rel="noopener">View signed copy</a>${d.id === 'boarding' ? `<a class="btn" href="/sign.html?doc=boarding&app=1">Sign for another horse</a>` : ''}`
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
        <div class="doc-card__actions"><a class="btn" href="/docs/w9.pdf" download>Download W-9</a></div></article>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ post an update (team)
  async function postSheet() {
    const { horses } = await api('GET', '/admin/horses');
    const active = horses.filter((x) => x.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    if (!active.length) { toast('Add a horse in the dashboard first.'); return; }
    const lastId = localStorage.getItem('wr-last-horse');
    openSheet(`<h2>Post an update</h2><form id="post" novalidate>
      <div class="field"><label for="p-h">Horse</label><select id="p-h">${active.map((x) => `<option value="${x.id}"${x.id === lastId ? ' selected' : ''}>${esc(x.name)}${x.stallName ? `, ${esc(x.stallName)}` : ''}</option>`).join('')}</select></div>
      <div class="field"><label for="p-c">What&rsquo;s new?</label><textarea id="p-c" rows="3" placeholder="Ate all his breakfast, then an hour in the round pen."></textarea></div>
      <input type="file" id="p-f" accept="image/*,video/*" multiple hidden>
      <button class="btn" type="button" id="p-add">${ic('camera')}&nbsp; Add photos or videos</button>
      <div class="thumbs" id="p-t"></div><div class="bar" id="p-bar" hidden><i></i></div>
      <button class="btn btn--red btn--big" type="submit" style="margin-top:10px">Post to the owner</button><p class="err" id="p-err"></p></form>`, (sheet) => {
      let files = [];
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
    s.innerHTML = `<div class="sheet__body">${html}</div>`;
    s.showModal();
    s.onclick = (e) => { if (e.target === s) s.close(); };
    wire(s);
  }
  document.addEventListener('click', (e) => {
    const full = e.target.closest('[data-full]');
    if (full) { const lb = $('#lightbox'); $('img', lb).src = full.dataset.full; lb.showModal(); return; }
    const a = e.target.closest('[data-act]');
    if (a) { if (a.dataset.act === 'post') postSheet(); else if (a.dataset.act === 'client-waivers') clientWaiverSheet(); else shiftAct(a.dataset.act, a); }
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
    if (h.waiversToCountersign) items.push(`<a href="/admin/#/waivers"><b>${h.waiversToCountersign} waiver${h.waiversToCountersign === 1 ? '' : 's'} to countersign</b><small>Open Waivers</small></a>`);
    n.innerHTML = `<h3>Notifications</h3>${items.join('') || '<p class="muted" style="padding:8px 10px">You&rsquo;re all caught up.</p>'}`;
    n.hidden = false;
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu, .notif, #bell, #role-chip')) { $('#menu').hidden = true; $('#notif').hidden = true; } });

  boot();
})();
