(() => {
  const { api, upload, esc, toast, timeAgo, fmtDay, money, me, logout, loginView, inviteView, $ } = window.WR;
  const root = $('#app');
  const tabs = $('#tabs');
  let user = null;

  $('#logout').addEventListener('click', logout);

  const resetHandlers = () => { root.onclick = null; root.onsubmit = null; root.onchange = null; root.oninput = null; };

  async function route() {
    resetHandlers();
    if (window.WRShift) window.WRShift.stop();
    const hash = location.hash || '';
    const invite = hash.match(/^#\/invite\/(.+)$/);
    if (invite) {
      tabs.hidden = true;
      return inviteView(root, decodeURIComponent(invite[1]), { onSuccess: (u) => { user = u; location.hash = '#/post'; route(); } });
    }
    if (!user) user = await me();
    if (!user || user.role !== 'staff') {
      tabs.hidden = true; $('#logout').hidden = !user; $('#portal-link').hidden = true;
      if (user) {
        root.innerHTML = `<div class="auth"><div class="auth__card"><h1>Ranch team only</h1><p>This page is for the ranch team. Your horse&rsquo;s photos and videos are in the owner portal.</p><a class="btn btn--red" style="width:100%" href="/">Open the Winning Ranch app</a></div></div>`;
        return;
      }
      return loginView(root, {
        title: 'Staff login', intro: 'Post updates, manage bookings and stalls.',
        foot: 'Need access? Ask the ranch manager for a login link.',
        onSuccess: (u) => { user = u; route(); },
      });
    }
    tabs.hidden = false; $('#logout').hidden = false; $('#portal-link').hidden = false;
    const pos = user.position || 'office';
    tabs.querySelectorAll('li[data-roles]').forEach((li) => { li.hidden = !li.dataset.roles.split(' ').includes(pos); });
    const allowed = [...tabs.querySelectorAll('li[data-roles]')].filter((li) => !li.hidden).map((li) => li.querySelector('a').getAttribute('href').slice(2));
    let name = (hash.match(/^#\/(\w+)/) || [])[1];
    if (!name || !allowed.includes(name)) name = pos === 'office' ? 'post' : 'shift';
    tabs.querySelectorAll('a').forEach((a) => { if (a.getAttribute('href') === '#/' + name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (pos !== 'hand') refreshPending();
    const views = { shift: () => window.WRShift.view(root), hours: () => window.WRHours.view(root), post: postView, bookings: bookingsView, horses: horsesView, people: peopleView, pricing: () => window.WRPricing.view(root), board: () => window.WRBoard.view(root), stalls: stallsView, waivers: waiversView };
    try { await (views[name] || postView)(); } catch (ex) {
      if (ex.status === 401) { user = null; return route(); }
      root.innerHTML = `<div class="wrap"><div class="empty-box"><h2>That didn’t load</h2><p>${esc(ex.message)}</p></div></div>`;
    }
  }
  window.addEventListener('hashchange', route);

  async function refreshPending() {
    try {
      const { bookings } = await api('GET', '/admin/bookings');
      $('#pending-count').textContent = bookings.filter((b) => b.status === 'pending').length || '';
    } catch (_) {}
  }

  const loading = () => { root.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>'; };

  // ================================================================ POST UPDATE
  async function postView() {
    loading();
    const { horses } = await api('GET', '/admin/horses');
    const active = horses.filter((h) => h.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    if (!active.length) {
      root.innerHTML = `<div class="wrap"><div class="empty-box"><h2>No horses yet</h2><p>Add a horse and its owner first, then you can post photos and videos for them.</p><p><a class="btn btn--red" href="#/horses">Add a horse</a></p></div></div>`;
      return;
    }
    const last = localStorage.getItem('wr-last-horse');
    const files = [];
    root.innerHTML = `
      <div class="wrap">
        <form class="panel" id="post-form" novalidate>
          <h2>Post an update</h2>
          <p class="muted">The owner sees it in the app right away.</p>
          <div class="stack">
            <div class="field"><label for="p-horse">Horse</label>
              <select id="p-horse" name="horseId">${active.map((h) => `<option value="${h.id}"${h.id === last ? ' selected' : ''}>${esc(h.name)}${h.stallName ? `, ${esc(h.stallName)}` : ''} (${esc(h.ownerName || 'no owner')})</option>`).join('')}</select></div>
            <div class="field"><label for="p-caption">What&rsquo;s new?</label><textarea id="p-caption" name="caption" rows="3" placeholder="Ate all his breakfast, then an hour in the round pen."></textarea></div>
            <label class="uploader"><input type="file" id="p-files" accept="image/*,video/*" multiple>
              <strong>Add photos or videos</strong><span class="muted">Take them now or pick from your phone. Videos up to 300 MB.</span></label>
            <div class="thumbs" id="p-thumbs"></div>
            <div class="progress" id="p-progress" hidden><i></i></div>
            <p class="inline-error" id="p-error" role="alert"></p>
            <button class="btn btn--red" type="submit">Post update</button>
          </div>
        </form>
        <section class="panel" id="recent"></section>
      </div>`;

    const thumbs = $('#p-thumbs', root);
    function drawThumbs() {
      thumbs.innerHTML = files.map((f, i) => `<figure>${f.type.startsWith('video') ? `<video src="${f.url}" muted></video><figcaption>Video</figcaption>` : `<img src="${f.url}" alt="">`}<button type="button" data-remove="${i}" aria-label="Remove">&times;</button></figure>`).join('');
    }
    $('#p-files', root).addEventListener('change', (e) => {
      for (const file of e.target.files) files.push({ file, type: file.type, url: URL.createObjectURL(file) });
      e.target.value = '';
      drawThumbs();
    });
    $('#p-horse', root).addEventListener('change', (e) => { localStorage.setItem('wr-last-horse', e.target.value); loadRecent(e.target.value); });

    root.onclick = async (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) { const [f] = files.splice(+rm.dataset.remove, 1); URL.revokeObjectURL(f.url); drawThumbs(); return; }
      const del = e.target.closest('[data-del-update]');
      if (del && confirm('Delete this update? The owner won’t see it anymore.')) {
        try { await api('DELETE', '/admin/updates/' + del.dataset.delUpdate); toast('Update deleted'); loadRecent($('#p-horse', root).value); } catch (ex) { toast(ex.message); }
      }
    };

    root.onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const err = $('#p-error', root);
      err.textContent = '';
      const caption = form.caption.value.trim();
      if (!caption && !files.length) { err.textContent = 'Add a photo, a video or a note.'; return; }
      const fd = new FormData();
      fd.append('horseId', form.horseId.value);
      fd.append('caption', caption);
      files.forEach((f) => fd.append('files', f.file));
      const btn = form.querySelector('[type="submit"]');
      const bar = $('#p-progress', root);
      btn.disabled = true; btn.textContent = 'Posting…';
      bar.hidden = !files.length;
      try {
        const res = await upload('/admin/updates', fd, (p) => { bar.firstElementChild.style.width = Math.round(p * 100) + '%'; });
        localStorage.setItem('wr-last-horse', form.horseId.value);
        files.splice(0).forEach((f) => URL.revokeObjectURL(f.url));
        drawThumbs();
        form.caption.value = '';
        const horse = active.find((h) => h.id === form.horseId.value);
        toast(`Posted to ${horse ? horse.name : 'the'} feed` + (res.skipped && res.skipped.length ? `. Skipped ${res.skipped.length} file(s) that weren’t photos or videos.` : ''));
        loadRecent(form.horseId.value);
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false; btn.textContent = 'Post update'; bar.hidden = true; bar.firstElementChild.style.width = '0';
      }
    };

    async function loadRecent(horseId) {
      const box = $('#recent', root);
      box.innerHTML = '<p class="muted">Loading recent posts…</p>';
      try {
        const { horse, updates } = await api('GET', `/horses/${horseId}/updates`);
        box.innerHTML = `<h2>Recent posts for ${esc(horse.name)}</h2>` + (updates.length ? `<ol class="feed">${updates.slice(0, 10).map((u) => `
          <li class="post">
            <div class="post__head"><span><strong>${esc(u.authorName)}</strong></span><time>${esc(timeAgo(u.createdAt))}</time></div>
            ${u.caption ? `<p class="post__caption">${esc(u.caption)}</p>` : ''}
            ${u.media.length ? `<div class="post__media${u.media.length === 1 ? ' one' : ''}">${u.media.map((m) => m.type === 'video' ? `<video controls playsinline preload="metadata" src="${esc(m.url)}"></video>` : `<button type="button" tabindex="-1"><img src="${esc(m.url)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
            <div class="post__tools" style="padding-top:10px"><button class="btn btn--sm btn--ghost" type="button" data-del-update="${u.id}">Delete</button></div>
          </li>`).join('')}</ol>` : '<p class="muted">Nothing posted yet.</p>');
      } catch (ex) { box.innerHTML = `<p class="inline-error">${esc(ex.message)}</p>`; }
    }
    loadRecent($('#p-horse', root).value);
  }

  // ================================================================ BOOKINGS
  let bookingFilter = 'pending';
  async function bookingsView() {
    loading();
    const { bookings } = await api('GET', '/admin/bookings');
    const counts = { pending: 0, confirmed: 0 };
    bookings.forEach((b) => { if (b.status in counts) counts[b.status]++; });
    const shown = bookingFilter === 'all' ? bookings : bookings.filter((b) => b.status === bookingFilter);
    const careLabel = { self: 'Self care', full: 'Full care' };
    root.innerHTML = `
      <div class="wrap">
        <h1>Bookings</h1>
        <div class="toolbar-row" role="group" aria-label="Filter">
          <button class="chip" data-filter="pending" aria-pressed="${bookingFilter === 'pending'}">Waiting for you (${counts.pending})</button>
          <button class="chip" data-filter="confirmed" aria-pressed="${bookingFilter === 'confirmed'}">Confirmed (${counts.confirmed})</button>
          <button class="chip" data-filter="all" aria-pressed="${bookingFilter === 'all'}">All</button>
        </div>
        ${shown.length ? `<div class="cards">${shown.map((b) => `
          <article class="card" data-id="${b.id}">
            <div class="card__top"><h3>${esc(b.name)}</h3><span class="status status--${b.status}">${esc(b.status)}</span><span class="muted">${esc(b.ref)}, sent ${esc(timeAgo(b.createdAt))}</span></div>
            <dl>
              <dt>Dates</dt><dd>${esc(fmtDay(b.from))} to ${esc(fmtDay(b.to))}, ${b.nights} night${b.nights === 1 ? '' : 's'}</dd>
              <dt>Stalls</dt><dd>${esc(b.stallNames.join(', '))}</dd>
              <dt>Horses</dt><dd>${esc(b.horses.join(', '))}</dd>
              <dt>Care</dt><dd>${careLabel[b.care]}${b.parking ? ', trailer or RV parking' : ''}</dd>
              <dt>Contact</dt><dd><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>, <a href="mailto:${esc(b.email)}">${esc(b.email)}</a></dd>
              ${b.estimate != null ? `<dt>Stalls total</dt><dd>${money(b.estimate)}</dd>` : ''}
              ${b.notes ? `<dt>Their note</dt><dd>${esc(b.notes)}</dd>` : ''}
            </dl>
            <div class="field" style="margin-bottom:12px"><label for="note-${b.id}">Team note</label><textarea id="note-${b.id}" rows="2" data-note placeholder="Paid by Zelle, arriving 6pm">${esc(b.staffNote || '')}</textarea></div>
            <div class="btn-row">
              ${b.status === 'pending' ? '<button class="btn btn--red btn--sm" data-status="confirmed">Confirm</button><button class="btn btn--sm btn--ghost" data-status="declined">Decline</button>' : ''}
              ${b.status === 'confirmed' ? '<button class="btn btn--sm" data-status="completed">Mark as done</button><button class="btn btn--sm btn--ghost" data-status="cancelled">Cancel booking</button>' : ''}
              ${['declined', 'cancelled'].includes(b.status) ? '<button class="btn btn--sm btn--ghost" data-status="pending">Reopen</button>' : ''}
              <button class="btn btn--sm btn--ghost" data-save-note>Save note</button>
            </div>
          </article>`).join('')}</div>` : `<div class="empty-box"><h2>Nothing here</h2><p>${bookingFilter === 'pending' ? 'No booking requests are waiting. New requests from the stall map show up here.' : 'No bookings in this list.'}</p></div>`}
      </div>`;

    root.onclick = async (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) { bookingFilter = f.dataset.filter; return bookingsView(); }
      const card = e.target.closest('.card');
      if (!card) return;
      const s = e.target.closest('[data-status]');
      const save = e.target.closest('[data-save-note]');
      if (!s && !save) return;
      const body = { staffNote: card.querySelector('[data-note]').value };
      if (s) {
        if (s.dataset.status === 'declined' && !confirm('Decline this request? The stalls open up again.')) return;
        if (s.dataset.status === 'cancelled' && !confirm('Cancel this booking? The stalls open up again.')) return;
        body.status = s.dataset.status;
      }
      try {
        await api('PATCH', '/admin/bookings/' + card.dataset.id, body);
        toast(s ? { confirmed: 'Booking confirmed. Call or email them.', declined: 'Request declined', completed: 'Marked as done', cancelled: 'Booking cancelled', pending: 'Reopened' }[body.status] : 'Note saved');
        if (s) { refreshPending(); bookingsView(); }
      } catch (ex) { toast(ex.message); }
    };
  }

  // ================================================================ HORSES
  async function horsesView(editId) {
    loading();
    const [{ horses }, { users }, { stalls }] = await Promise.all([api('GET', '/admin/horses'), api('GET', '/admin/users'), api('GET', '/admin/stalls')]);
    const owners = users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name));
    const byName = (a, b) => a.name.localeCompare(b.name);
    const active = horses.filter((h) => h.active !== false);
    const here = active.filter((h) => h.stay && h.stay.now).sort(byName);
    const coming = active.filter((h) => h.stay && !h.stay.now).sort(byName);
    const noStall = active.filter((h) => !h.stay).sort(byName);
    const gone = horses.filter((h) => h.active === false).sort(byName);

    // The stalls come from the Stall board: one with a horse in it today can't be picked (one of ours can: it moves)
    const form = (h = {}) => `
      <form class="form-grid" data-horse-form="${h.id || 'new'}" novalidate>
        <div class="field"><label>Name</label><input name="name" value="${esc(h.name || '')}" required></div>
        <div class="field"><label>Stall</label><select name="stallId"><option value="">No stall</option>${stalls.filter((s) => s.status === 'available').map((s) => {
          const taken = s.horse && s.horse.id !== h.id && !s.horse.ours;
          return `<option value="${s.id}"${s.id === h.stallId ? ' selected' : ''}${taken ? ' disabled' : ''}>${esc(s.name)}${s.horse && s.horse.id !== h.id ? `, ${esc(s.horse.name)}${s.horse.ours ? ' (ours, can move)' : ''}` : ''}</option>`;
        }).join('')}</select></div>
        <div class="field"><label>Owner with the app</label><select name="ownerId"><option value="">No app account yet</option>${owners.map((u) => `<option value="${u.id}"${u.id === h.ownerId ? ' selected' : ''}>${esc(u.name)}${u.role === 'staff' ? ' (staff)' : ''}</option>`).join('')}</select></div>
        <div class="field"><label>Owner&rsquo;s name</label><input name="ownerName" value="${esc(h.hasAccount ? '' : h.ownerName || '')}" placeholder="When they don&rsquo;t have the app yet"></div>
        <div class="field"><label>Breed</label><input name="breed" value="${esc(h.breed || '')}"></div>
        <div class="field"><label>Arrived on</label><input name="arrivedOn" type="date" value="${esc(h.arrivedOn || new Date().toISOString().slice(0, 10))}"></div>
        <div class="field full"><label>Team notes (owners don&rsquo;t see these)</label><textarea name="notes" rows="2">${esc(h.notes || '')}</textarea></div>
        <p class="inline-error full" data-err></p>
        <div class="form-actions full">
          <button class="btn btn--red btn--sm" type="submit">${h.id ? 'Save' : 'Add horse'}</button>
          <button class="btn btn--sm btn--ghost" type="button" data-cancel>Cancel</button>
          ${h.id ? `<button class="btn btn--sm btn--ghost" type="button" data-active="${h.active === false ? 1 : 0}">${h.active === false ? 'Back at the ranch' : 'Left the ranch'}</button>` : ''}
        </div>
      </form>`;

    const stayText = (s) => (s.ours ? 'Ours' : s.kind === 'monthly' ? 'Monthly boarder' : 'Nightly')
      + (s.now ? (s.to ? `, leaves ${fmtDay(s.to)}` : '') : `, arrives ${fmtDay(s.from)}`);
    const card = (h) => h.id === editId ? `<article class="card">${form(h)}</article>` : `
      <article class="card">
        <div class="card__top"><h3>${esc(h.name)}</h3><span class="muted">${esc(h.stallName || 'No stall')}</span></div>
        <dl>${h.stay ? `<dt>Stay</dt><dd>${esc(stayText(h.stay))} <a class="textlink" href="#/board">(${esc(h.stay.ref)})</a></dd>` : ''}
          <dt>Owner</dt><dd>${esc(h.ownerName || 'None')}${h.ownerName && !h.hasAccount ? ' <small class="muted">(no app account yet)</small>' : ''}</dd>
          <dt>Updates</dt><dd>${h.updates}</dd>${h.breed ? `<dt>Breed</dt><dd>${esc(h.breed)}</dd>` : ''}</dl>
        <div class="btn-row"><a class="btn btn--sm btn--red" href="#/post" data-post="${h.id}">Post update</a><button class="btn btn--sm btn--ghost" data-edit="${h.id}">Edit</button></div>
      </article>`;
    const group = (title, list) => (list.length ? `<h2 style="margin-top:32px">${title} <small class="muted">(${list.length})</small></h2><div class="cards">${list.map(card).join('')}</div>` : '');

    root.innerHTML = `
      <div class="wrap">
        <h1>Horses</h1>
        <p class="muted">The same horses as the <a class="textlink" href="#/board">Stall board</a>: a horse added there shows up here, and the stall you pick here moves it there.</p>
        ${editId === 'new' ? `<div class="panel">${form()}</div>` : '<p><button class="btn btn--red" data-edit="new">Add a horse</button></p>'}
        ${group('At the ranch', here)}${group('Coming', coming)}${group('No stall', noStall)}
        ${active.length ? '' : '<p class="muted" style="margin-top:18px">No horses yet. Add one here or on the Stall board.</p>'}
        ${group('Left the ranch', gone)}
      </div>`;

    root.onclick = (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) return horsesView(ed.dataset.edit);
      if (e.target.closest('[data-cancel]')) return horsesView();
      const p = e.target.closest('[data-post]');
      if (p) localStorage.setItem('wr-last-horse', p.dataset.post);
      const act = e.target.closest('[data-active]');
      if (act) {
        const id = act.closest('form').dataset.horseForm;
        api('PATCH', '/admin/horses/' + id, { active: act.dataset.active === '1' })
          .then(() => { toast(act.dataset.active === '1' ? 'Welcome back' : 'Marked as left. The stall is free again.'); horsesView(); })
          .catch((ex) => toast(ex.message));
      }
    };
    root.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const id = f.dataset.horseForm;
      const body = Object.fromEntries(new FormData(f));
      try {
        if (id === 'new') await api('POST', '/admin/horses', body);
        else await api('PATCH', '/admin/horses/' + id, body);
        toast(id === 'new' ? `${body.name} added` : 'Saved');
        horsesView();
      } catch (ex) { f.querySelector('[data-err]').textContent = ex.message; }
    };
  }

  // ================================================================ PEOPLE
  async function peopleView(showAdd) {
    loading();
    const [{ users }, { status: docStatus }] = await Promise.all([api('GET', '/admin/users'), api('GET', '/admin/documents/status')]);
    users.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'staff' ? 1 : -1));
    const inviteBox = (url, person) => {
      const msg = `Hi ${person.split(' ')[0]}, here's your Winning Ranch login link: ${url}`;
      return `<div class="invite-box"><strong>Send this link to ${esc(person)}</strong>
        <p class="muted" style="margin:4px 0 0">They open it, create a password, and they&rsquo;re in. It works once and expires in 14 days.</p>
        <code>${esc(url)}</code>
        <div class="btn-row"><button class="btn btn--sm btn--red" type="button" data-copy="${esc(url)}">Copy link</button>
        <a class="btn btn--sm btn--ghost" href="sms:?&body=${encodeURIComponent(msg)}">Text it</a>
        <a class="btn btn--sm btn--ghost" href="mailto:?subject=${encodeURIComponent('Your Winning Ranch login')}&body=${encodeURIComponent(msg)}">Email it</a></div></div>`;
    };
    root.innerHTML = `
      <div class="wrap">
        <h1>People</h1>
        <p class="muted">Owners log in to see their horses. Staff log in here.</p>
        ${showAdd ? `<form class="panel form-grid" id="add-person" novalidate>
            <h2 class="full" style="margin:0">Add a person</h2>
            <div class="field"><label>Name</label><input name="name" required></div>
            <div class="field"><label>Email</label><input name="email" type="email" required></div>
            <div class="field"><label>Phone</label><input name="phone" type="tel"></div>
            <div class="field"><label>Role</label><select name="role"><option value="owner">Horse owner</option><option value="staff">Ranch team</option></select></div>
            <div class="field"><label>Position (ranch team)</label><select name="position"><option value="hand">Ranch hand: shift, checklist, posts updates</option><option value="manager">Ranch manager: everything, clocks in</option><option value="office" selected>Office: everything, no time clock</option><option value="lessons">Lesson program: sends waivers to clients</option></select></div>
            <p class="inline-error full" data-err></p>
            <div class="form-actions full"><button class="btn btn--red btn--sm" type="submit">Add and get login link</button><button class="btn btn--sm btn--ghost" type="button" data-cancel>Cancel</button></div>
            <div class="full" id="new-invite"></div>
          </form>` : `<div class="btn-row"><button class="btn btn--red" data-add>Add a person</button><button class="btn" data-bulk>Add several at once</button></div>
          <form class="panel" id="bulk" hidden novalidate style="margin-top:14px"><h2 style="margin:0 0 6px">Add several at once</h2>
            <p class="muted">One person per line: name, email, phone, position (ranch hand, ranch manager, office, lesson program or owner). Each one gets an invite email.</p>
            <div class="field"><textarea name="lines" rows="7" placeholder="Gabi, gabi@example.com, 702-555-0100, ranch manager"></textarea></div>
            <div class="form-actions"><button class="btn btn--red btn--sm" type="submit">Add and email invites</button></div><div id="bulk-out"></div></form>`}
        <div class="cards" style="margin-top:18px">${users.map((u) => `
          <article class="card" data-id="${u.id}" data-name="${esc(u.name)}">
            <div class="card__top"><h3>${esc(u.name)}</h3><span class="muted">${u.master ? 'Master' : u.role === 'staff' ? ({ hand: 'Ranch hand', manager: 'Ranch manager', office: 'Office', lessons: 'Lesson program' }[u.position] || 'Ranch team') : 'Owner'}</span>
              ${!u.active ? '<span class="status status--cancelled">Access off</span>' : !u.hasPassword ? '<span class="status status--invite">Hasn’t logged in yet</span>' : ''}</div>
            <dl><dt>Email</dt><dd>${esc(u.email)}</dd>${u.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(u.phone)}">${esc(u.phone)}</a></dd>` : ''}${u.role === 'owner' ? `<dt>Horses</dt><dd>${esc(u.horses.join(', ') || 'None yet')}</dd>` : ''}</dl>
            <div class="doc-chips">${Object.entries(docStatus[u.id] || {}).map(([, s]) => `<span class="doc-chip ${s.signedAt ? 'is-signed' : s.requested ? 'is-req' : ''}">${esc(s.title)}: ${s.signedAt ? `signed ${esc(fmtDay(s.signedAt))}` : s.requested ? 'requested' : 'not signed'}</span>`).join('')}
              ${u.active && Object.values(docStatus[u.id] || {}).some((s) => !s.signedAt && !s.requested) ? `<select class="pos-select" data-req-doc aria-label="Document to request">${Object.entries(docStatus[u.id]).filter(([, s]) => !s.signedAt && !s.requested).map(([id, s]) => `<option value="${id}">${esc(s.title)}</option>`).join('')}</select><button class="btn btn--sm btn--ghost" type="button" data-request-doc>Request signature</button>` : ''}</div>
            <div class="btn-row">${u.master && !user.master ? '' : `<button class="btn btn--sm btn--ghost" data-invite>${u.hasPassword ? 'New login link' : 'Get login link'}</button>${!u.hasPassword ? '<button class="btn btn--sm btn--ghost" data-invite-email>Email the invite</button>' : ''}`}
              ${u.role === 'staff' && u.id !== user.id && !u.master ? `<select class="pos-select" data-position aria-label="Position">${['hand', 'manager', 'office', 'lessons'].map((p) => `<option value="${p}"${u.position === p ? ' selected' : ''}>${{ hand: 'Ranch hand', manager: 'Ranch manager', office: 'Office', lessons: 'Lesson program' }[p]}</option>`).join('')}</select>` : ''}
              ${u.id !== user.id && !u.master ? `<button class="btn btn--sm btn--ghost" data-toggle="${u.active ? 0 : 1}">${u.active ? 'Turn off access' : 'Turn on access'}</button>` : ''}</div>
            <div data-invite-box></div>
          </article>`).join('')}</div>
      </div>`;

    root.onclick = async (e) => {
      if (e.target.closest('[data-add]')) return peopleView(true);
      if (e.target.closest('[data-bulk]')) { $('#bulk', root).hidden = false; $('#bulk textarea', root).focus(); return; }
      const em = e.target.closest('[data-invite-email]');
      if (em) {
        try { const r = await api('POST', `/admin/users/${em.closest('.card').dataset.id}/invite`, { email: true }); toast(r.emailed ? 'Invite emailed' : `Not emailed: ${r.emailError}`); } catch (ex) { toast(ex.message); }
        return;
      }
      if (e.target.closest('[data-cancel]')) return peopleView();
      const copy = e.target.closest('[data-copy]');
      if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Link copied'); } catch { toast('Select the link and copy it'); } return; }
      const card = e.target.closest('.card');
      if (!card) return;
      if (e.target.closest('[data-request-doc]')) {
        const docId = card.querySelector('[data-req-doc]').value;
        try { await api('POST', '/admin/sign-requests', { userId: card.dataset.id, docIds: [docId] }); toast('Request sent. It shows in their app.'); peopleView(); } catch (ex) { toast(ex.message); }
        return;
      }
      if (e.target.closest('[data-invite]')) {
        try { const { inviteUrl } = await api('POST', `/admin/users/${card.dataset.id}/invite`); card.querySelector('[data-invite-box]').innerHTML = inviteBox(inviteUrl, card.dataset.name); } catch (ex) { toast(ex.message); }
      }
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        if (tg.dataset.toggle === '0' && !confirm('Turn off this person’s access? They’re logged out right away.')) return;
        try { await api('PATCH', '/admin/users/' + card.dataset.id, { active: tg.dataset.toggle === '1' }); peopleView(); } catch (ex) { toast(ex.message); }
      }
    };
    root.onchange = async (e) => {
      const sel = e.target.closest('[data-position]');
      if (!sel) return;
      try { await api('PATCH', '/admin/users/' + sel.closest('.card').dataset.id, { position: sel.value }); toast('Position updated'); peopleView(); } catch (ex) { toast(ex.message); }
    };
    root.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        if (f.id === 'bulk') {
          const { results } = await api('POST', '/admin/users/bulk', { lines: f.lines.value });
          $('#bulk-out', root).innerHTML = `<ul class="bulk-res">${results.map((x) => `<li>${esc(x.name || x.line)}: ${x.error ? `<b class="inline-error">${esc(x.error)}</b>` : x.emailed ? 'added, invite emailed' : `added, invite not emailed (${esc(x.emailError || '')}). <a class="textlink" href="sms:?&body=${encodeURIComponent('Your Winning Ranch login: ' + x.inviteUrl)}">Text it</a>`}</li>`).join('')}</ul>`;
          f.lines.value = '';
          toast('Done');
          return;
        }
        const { user: u, inviteUrl, emailed } = await api('POST', '/admin/users', Object.fromEntries(new FormData(f)));
        f.querySelectorAll('input').forEach((i) => { i.value = ''; });
        f.querySelector('[data-err]').textContent = '';
        $('#new-invite', root).innerHTML = (emailed ? `<p class="ok-line">Invite emailed to ${esc(u.email)}.</p>` : '') + inviteBox(inviteUrl, u.name);
        toast(`${u.name} added`);
      } catch (ex) { f.querySelector('[data-err]').textContent = ex.message; }
    };
  }

  // ================================================================ STALLS
  let openStall = null;
  async function stallsView() {
    const fromPricing = sessionStorage.getItem('wr-open-stall');
    if (fromPricing) { openStall = fromPricing; sessionStorage.removeItem('wr-open-stall'); }
    loading();
    const { stalls, settings } = await api('GET', '/admin/stalls');
    const groups = [['main', 'Main barn'], ['outdoor', 'Outdoor stalls']];
    const row = (s) => `
      <div class="stall-row" data-id="${s.id}">
        <button type="button" data-toggle-row aria-expanded="${openStall === s.id}">
          <strong>${esc(s.name)}${s.smaller ? ' <small class="muted">(smaller)</small>' : ''}${s.ponyOnly ? ' <small class="muted">(ponies only)</small>' : ''}</strong>
          <span class="hide-sm">${s.nightly != null ? money(s.nightly) + ' / night' : '<span class="tbd">no nightly price</span>'}</span>
          <span class="hide-sm">${s.photos.length} photo${s.photos.length === 1 ? '' : 's'}</span>
          <span>${s.horse ? esc(s.horse.name) : s.status === 'unavailable' ? 'Not in use' : 'Open'}</span>
        </button>
        ${openStall === s.id ? `
        <div class="stall-row__edit">
          <form class="form-grid" data-stall-form="${s.id}" novalidate>
            <p class="full muted" style="margin:0">Prices live on the <a class="textlink" href="#/pricing">Pricing board</a>.</p>
            <div class="field"><label>Size</label><input name="size" value="${esc(s.size)}" placeholder="12' x 24'"></div>
            <div class="field"><label>Status</label><select name="status"><option value="available"${s.status === 'available' ? ' selected' : ''}>In use</option><option value="unavailable"${s.status === 'unavailable' ? ' selected' : ''}>Not in use</option></select></div>
            <div class="field full"><label>Description</label><textarea name="description" rows="2">${esc(s.description)}</textarea></div>
            ${s.group === 'main' ? `<label class="choice full"><input type="checkbox" name="ponyOnly"${s.ponyOnly ? ' checked' : ''}><span>Ponies only</span></label>` : ''}
            <label class="choice full"><input type="checkbox" name="applyToGroup"><span>Use this size for every ${s.group === 'main' ? 'main barn' : 'outdoor'} stall${s.smaller ? ' like this one (smaller)' : s.group === 'main' ? ' (except the smaller one)' : ''}</span></label>
            <p class="inline-error full" data-err></p>
            <div class="form-actions full"><button class="btn btn--red btn--sm" type="submit">Save stall</button></div>
          </form>
          <h3 style="font-size:1.1rem;margin:22px 0 4px">Photos</h3>
          <p class="muted" style="margin:0">They show up when visitors hover or tap this stall on the map.</p>
          <div class="photo-strip">${s.photos.map((p) => `<figure><img src="${esc(p.url)}" alt="">${p.builtIn ? '<figcaption>Barn photo</figcaption>' : ''}<button type="button" data-del-photo="${p.id}" aria-label="Remove photo">&times;</button></figure>`).join('')}</div>
          <label class="uploader" style="padding:14px"><input type="file" accept="image/*" multiple data-add-photos><strong>Add photos</strong></label>
        </div>` : ''}
      </div>`;

    root.innerHTML = `
      <div class="wrap">
        <h1>Stalls</h1>
        <p class="muted">Photos, size, status and description of each stall. Prices are on the <a class="textlink" href="#/pricing">Pricing board</a>.</p>
        ${groups.map(([g, title]) => `<section class="panel"><h2>${title}</h2><div class="stall-rows">${stalls.filter((s) => s.group === g).sort((a, b) => a.number - b.number).map(row).join('')}</div></section>`).join('')}
      </div>`;

    root.onclick = async (e) => {
      const t = e.target.closest('[data-toggle-row]');
      if (t) { const id = t.closest('.stall-row').dataset.id; openStall = openStall === id ? null : id; return stallsView(); }
      const del = e.target.closest('[data-del-photo]');
      if (del && confirm('Remove this photo from the stall?')) {
        try { await api('DELETE', `/admin/stalls/${del.closest('.stall-row').dataset.id}/photos/${del.dataset.delPhoto}`); stallsView(); } catch (ex) { toast(ex.message); }
      }
    };
    root.onchange = async (e) => {
      if (!e.target.matches('[data-add-photos]') || !e.target.files.length) return;
      const id = e.target.closest('.stall-row').dataset.id;
      const fd = new FormData();
      [...e.target.files].forEach((f) => fd.append('files', f));
      toast('Uploading…');
      try { await upload(`/admin/stalls/${id}/photos`, fd); toast('Photos added'); stallsView(); } catch (ex) { toast(ex.message); }
    };
    root.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = f.querySelector('[data-err]');
      err.textContent = '';
      const fd = Object.fromEntries(new FormData(f));
      try {
        const body = { size: fd.size, status: fd.status, description: fd.description, applyToGroup: f.applyToGroup.checked, ...(f.ponyOnly ? { ponyOnly: f.ponyOnly.checked } : {}) };
        const res = await api('PATCH', '/admin/stalls/' + f.dataset.stallForm, body);
        toast(res.updated.length > 1 ? `Size saved for ${res.updated.length} stalls` : 'Stall saved');
        stallsView();
      } catch (ex) { err.textContent = ex.message; }
    };
  }


  // ================================================================ WAIVERS
  let waiverDoc = 'all';
  let waiverQuery = '';
  async function waiversView() {
    loading();
    const { docs, waivers, deleted } = await api('GET', `/admin/waivers${waiverDoc === 'deleted' ? '?deleted=1' : ''}`);
    const count = (id) => waivers.filter((w) => id === 'all' || w.docId === id).length;
    const signBase = `${location.origin}/sign.html?doc=`;
    root.innerHTML = `
      <div class="wrap">
        <h1>Waivers</h1>
        <p class="muted">Everything signed online, newest first. Open a signed copy to print it or save it as a PDF.</p>
        <div class="toolbar-row">
          <input type="search" id="w-q" class="search" placeholder="Search name, email, phone or horse" value="${esc(waiverQuery)}" aria-label="Search waivers">
        </div>
        <div class="toolbar-row" role="group" aria-label="Document">
          ${waiverDoc === 'deleted' ? '<button class="chip" data-doc="all" aria-pressed="false">Back to signed documents</button><button class="chip" aria-pressed="true">Deleted (' + waivers.length + ')</button>'
            : [{ id: 'all', title: 'All' }, ...docs].map((d) => `<button class="chip" data-doc="${d.id}" aria-pressed="${waiverDoc === d.id}">${esc(d.title)} (${count(d.id)})</button>`).join('') + (deleted ? `<button class="chip" data-doc="deleted" aria-pressed="false">Deleted (${deleted})</button>` : '')}
        </div>
        <div class="cards" id="w-list"></div>
        <section class="panel" style="margin-top:24px">
          <h2>Send a signing link</h2>
          <p class="muted">Text or email it so people sign before they arrive. It opens the document ready to sign.</p>
          <div class="cards">${docs.map((d) => `
            <div class="card link-row"><strong>${esc(d.title)}</strong>
              <div class="btn-row"><button class="btn btn--sm btn--red" type="button" data-copy-link="${esc(signBase + d.id)}">Copy link</button>
              <a class="btn btn--sm btn--ghost" href="sms:?&body=${encodeURIComponent(`Please sign the Winning Ranch ${d.title.toLowerCase()} before you arrive: ${signBase + d.id}`)}">Text it</a></div></div>`).join('')}</div>
        </section>
      </div>`;

    function drawList() {
      const q = waiverQuery.trim().toLowerCase();
      const shown = waivers.filter((w) => (waiverDoc === 'all' || waiverDoc === 'deleted' || w.docId === waiverDoc)
        && (!q || [w.name, w.signerName, w.email, w.phone, w.horse].join(' ').toLowerCase().includes(q)));
      $('#w-list', root).innerHTML = shown.length ? shown.map((w) => `
        <article class="card" data-id="${w.id}">
          <div class="card__top"><h3>${esc(w.name || w.signerName)}</h3>
            <span class="status ${w.countersign ? 'status--confirmed' : 'status--pending'}">${w.countersign ? 'Countersigned' : 'Needs countersign'}</span>
            <span class="muted">${esc(w.docTitle)}, ${esc(timeAgo(w.signedAt))}</span></div>
          <dl>
            ${w.minor ? `<dt>Signed by</dt><dd>${esc(w.signerName)}, parent or guardian</dd>` : ''}
            ${w.horse ? `<dt>Horse</dt><dd>${esc(w.horse)}</dd>` : ''}
            <dt>Contact</dt><dd>${w.phone ? `<a href="tel:${esc(w.phone)}">${esc(w.phone)}</a>` : ''}${w.phone && w.email ? ', ' : ''}${w.email ? `<a href="mailto:${esc(w.email)}">${esc(w.email)}</a>` : ''}</dd>
            ${w.countersign ? `<dt>Countersigned</dt><dd>${esc(w.countersign.by)}, ${esc(fmtDay(w.countersign.at))}</dd>` : ''}
          </dl>
          <div class="btn-row">
            <a class="btn btn--sm btn--red" href="/api/ranch/admin/waivers/${w.id}/print" target="_blank" rel="noopener">Open signed copy</a>
            ${w.deletedAt ? `<button class="btn btn--sm" type="button" data-restore>Restore</button><span class="muted">Deleted by ${esc(w.deletedBy)}${w.deleteReason ? `: ${esc(w.deleteReason)}` : ''}</span>`
              : `${w.countersign ? '' : '<button class="btn btn--sm btn--ghost" type="button" data-countersign>Countersign for the ranch</button>'}<button class="btn btn--sm btn--ghost btn--danger" type="button" data-delete>Delete</button>`}
          </div>
        </article>`).join('')
        : `<div class="empty-box"><h2>${waivers.length ? 'No matches' : 'Nothing signed yet'}</h2><p>${waivers.length ? 'Try another name or clear the search.' : 'When someone signs on the website, it shows up here.'}</p></div>`;
    }
    drawList();

    $('#w-q', root).addEventListener('input', (e) => { waiverQuery = e.target.value; drawList(); });
    root.onclick = async (e) => {
      const d = e.target.closest('[data-doc]');
      if (d) { waiverDoc = d.dataset.doc; return waiversView(); }
      const cp = e.target.closest('[data-copy-link]');
      if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copyLink); toast('Link copied'); } catch { toast(cp.dataset.copyLink); } return; }
      const cs = e.target.closest('[data-countersign]');
      const delW = e.target.closest('[data-delete]');
      if (delW) {
        const reason = prompt('Delete this signed document? It disappears from the list and the signer’s copy link stops working. You can restore it from Deleted.\n\nReason (optional):', 'Filled out wrong');
        if (reason === null) return;
        try { await api('DELETE', `/admin/waivers/${delW.closest('.card').dataset.id}`, { reason }); toast('Deleted. Find it under Deleted to restore it.'); waiversView(); } catch (ex) { toast(ex.message); }
        return;
      }
      const rs = e.target.closest('[data-restore]');
      if (rs) {
        try { await api('POST', `/admin/waivers/${rs.closest('.card').dataset.id}/restore`); toast('Restored'); waiversView(); } catch (ex) { toast(ex.message); }
        return;
      }
      if (cs) {
        const card = cs.closest('.card');
        if (!confirm('Countersign this document for Winning Ranch? Your name and today’s date go on the signed copy.')) return;
        try { await api('POST', `/admin/waivers/${card.dataset.id}/countersign`); toast('Countersigned'); waiversView(); } catch (ex) { toast(ex.message); }
      }
    };
  }

  route();
})();
