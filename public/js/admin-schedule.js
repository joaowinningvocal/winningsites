/* Schedule: who works the AM and PM shift each day.
   Managers and office drag names between shifts (press and hold on a phone), from the Team list onto a
   shift, or onto another name to swap the two. "Usual week" is the template every week starts from;
   a change in "This week" only changes that day. Ranch hands tap a coworker's shift to ask to take it
   or swap it for one of theirs, and a manager approves. */
window.WRSchedule = (() => {
  const { api, esc, toast } = window.WR;
  const st = { day: null, mode: 'week', data: null };
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let root;

  const laToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayName = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const hm12 = (hm) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const nameOf = (id) => (st.data.team.find((u) => u.id === id) || {}).name || 'Someone';

  async function view(container) {
    root = container;
    st.day = st.day || laToday();
    root.innerHTML = '<div class="wrap"><p class="muted">Loading the schedule…</p></div>';
    await refresh();
  }

  async function refresh() {
    st.data = await api('GET', `/admin/schedule?day=${st.day}`);
    if (!st.data.canEdit) st.mode = 'week';
    render();
  }

  // The slots on screen: this week's days, or the usual week by weekday
  const rows = () => (st.mode === 'usual'
    ? st.data.usual.map((u) => ({ key: 'w' + u.weekday, label: WEEKDAYS[u.weekday], am: u.am, pm: u.pm, weekday: u.weekday }))
    : st.data.days.map((d) => ({ key: d.day, label: dayName(d.day), am: d.am, pm: d.pm, day: d.day, changed: d.changed, past: d.day < st.data.today, today: d.day === st.data.today })));
  const rowOf = (key) => rows().find((r) => r.key === key);
  const change = (row, slot, userIds) => (st.mode === 'usual' ? { usual: true, weekday: row.weekday, slot, userIds } : { day: row.day, slot, userIds });

  function render() {
    const d = st.data;
    const t = d.times;
    const chip = (row, slot, id) => `<span class="sched-chip${id === d.me ? ' is-me' : ''}" data-user="${id}" data-row="${row.key}" data-slot="${slot}"${!d.canEdit && id !== d.me && !row.past ? ' role="button" tabindex="0"' : ''}>${esc(nameOf(id))}${d.canEdit ? `<button type="button" class="sched-x" data-remove aria-label="Take ${esc(nameOf(id))} off this shift">&times;</button>` : ''}</span>`;
    const cell = (row, slot) => `<div class="sched-slot${row.past ? ' is-past' : ''}" data-row="${row.key}" data-slot="${slot}">${row[slot].map((id) => chip(row, slot, id)).join('') || '<span class="sched-empty">Nobody</span>'}</div>`;
    root.innerHTML = `
      <div class="wrap hours schedule">
        <div class="pricing__head">
          <div><h1>Schedule</h1><p class="muted">AM ${esc(hm12(t.am.start))} to ${esc(hm12(t.am.end))}, PM ${esc(hm12(t.pm.start))} to ${esc(hm12(t.pm.end))}.
            ${d.canEdit ? 'Tap a shift to pick who works it, or press and hold a name to drag it to another shift (drop it on a name to swap the two).' : 'Tap a coworker&rsquo;s shift to ask to take it or swap it for one of yours. A manager approves it.'}</p></div>
          <div class="hours__pick">
            ${d.canEdit ? `<div class="seg" role="group" aria-label="Which week"><button type="button" data-mode="week" aria-pressed="${st.mode === 'week'}">This week</button><button type="button" data-mode="usual" aria-pressed="${st.mode === 'usual'}">Usual week</button></div>` : ''}
            ${st.mode === 'week' ? `<button class="btn btn--sm btn--ghost" type="button" data-week="-7" aria-label="Previous week">&lsaquo;</button><input type="date" id="s-day" value="${esc(st.day)}" aria-label="Week of"><button class="btn btn--sm btn--ghost" type="button" data-week="7" aria-label="Next week">&rsaquo;</button>` : ''}
          </div>
        </div>
        ${requestsHtml()}
        ${d.canEdit ? `<section class="panel sched-team"><h2>Team</h2><div class="sched-slot sched-palette">${d.team.map((u) => `<span class="sched-chip" data-user="${u.id}" data-row="" data-slot="">${esc(u.name)}</span>`).join('') || '<span class="muted">Add ranch hands in People first.</span>'}</div>
          <p class="muted" style="margin:8px 0 0">Drag a name onto a shift to add them.</p></section>` : ''}
        <section class="panel">
          ${st.mode === 'usual' ? '<p class="muted" style="margin-top:0">The usual week fills every week. A change here shows on every day that hasn&rsquo;t been changed by hand.</p>' : ''}
          <div class="sched-grid">
            <div class="sched-h"></div><div class="sched-h">AM</div><div class="sched-h">PM</div>
            ${rows().map((r) => `<div class="sched-day${r.today ? ' is-today' : ''}"><strong>${esc(r.label)}</strong>${r.changed ? '<small>changed</small>' : ''}</div>${cell(r, 'am')}${cell(r, 'pm')}`).join('')}
          </div>
          ${d.canEdit && st.mode === 'week' && d.days.some((x) => x.changed) ? '<p style="margin:14px 0 0"><button class="btn btn--sm btn--ghost" type="button" data-reset>Set this week back to the usual week</button></p>' : ''}
        </section>
        ${d.canEdit ? `<details class="panel hours-settings"><summary><h2>Shift times</h2></summary>
          <form class="form-grid" id="sched-times" novalidate>
            <div class="field"><label>AM starts</label><input type="time" name="amStart" value="${esc(t.am.start)}"></div>
            <div class="field"><label>AM ends</label><input type="time" name="amEnd" value="${esc(t.am.end)}"></div>
            <div class="field"><label>PM starts</label><input type="time" name="pmStart" value="${esc(t.pm.start)}"></div>
            <div class="field"><label>PM ends</label><input type="time" name="pmEnd" value="${esc(t.pm.end)}"></div>
            <p class="inline-error full" data-err></p>
            <div class="form-actions full"><button class="btn btn--red btn--sm" type="submit">Save times</button></div>
          </form></details>` : ''}
      </div>`;
    bind();
  }

  function requestsHtml() {
    const d = st.data;
    if (!d.requests.length) return '';
    const text = (q) => (q.kind === 'swap'
      ? `<strong>${esc(q.byName)}</strong> wants to swap their ${esc(q.fromLabel)} for ${esc(q.withName)}&rsquo;s ${esc(q.toLabel)}`
      : `<strong>${esc(q.byName)}</strong> wants to take ${esc(q.withName)}&rsquo;s ${esc(q.toLabel)}`);
    const status = (q) => `<span class="status status--${q.status === 'approved' ? 'confirmed' : q.status === 'pending' ? 'pending' : 'cancelled'}">${q.status === 'pending' ? 'waiting for a manager' : esc(q.status)}${q.decidedBy && q.status !== 'pending' ? ` by ${esc(q.decidedBy)}` : ''}</span>`;
    return `<section class="panel sched-requests"><h2>${d.canEdit ? 'Shift requests' : 'Your shift requests'}</h2><ul>
      ${d.requests.map((q) => `<li><p>${text(q)}${q.note ? `<br><small class="muted">&ldquo;${esc(q.note)}&rdquo;</small>` : ''}</p>
        <div class="btn-row">${status(q)}
          ${q.status === 'pending' && d.canEdit ? `<button class="btn btn--sm btn--red" type="button" data-decide="${q.id}" data-approve="1">Approve</button><button class="btn btn--sm btn--ghost" type="button" data-decide="${q.id}">Decline</button>` : ''}
          ${q.status === 'pending' && !d.canEdit && q.byUserId === d.me ? `<button class="btn btn--sm btn--ghost" type="button" data-cancel-req="${q.id}">Cancel</button>` : ''}</div></li>`).join('')}
      </ul></section>`;
  }

  // ---------------------------------------------------------------- managers: save, with undo
  async function save(changes, done) {
    const before = changes.map((c) => {
      const row = rowOf(c.usual ? 'w' + c.weekday : c.day);
      return { ...c, userIds: row[c.slot].slice() };
    });
    try {
      await api('POST', '/admin/schedule/set', { changes });
      await refresh();
      toast(done, { action: 'Undo', onAction: async () => {
        try { await api('POST', '/admin/schedule/set', { changes: before }); toast('Undone'); refresh(); } catch (ex) { toast(ex.message); }
      } });
    } catch (ex) { toast(ex.message); }
  }

  // A name dropped somewhere: onto a shift (move or add) or onto a name in another shift (swap)
  function drop(src, target) {
    const user = src.dataset.user;
    const from = src.dataset.row ? rowOf(src.dataset.row) : null;
    const fromSlot = src.dataset.slot;
    const toRow = rowOf(target.dataset.row);
    const toSlot = target.dataset.slot;
    if (!toRow) return;
    const onName = target.classList.contains('sched-chip') ? target.dataset.user : null;
    const same = from && from.key === toRow.key && fromSlot === toSlot;
    if (same) return;
    const label = (row, slot) => `${row.label} ${slot.toUpperCase()}`;
    if (from && onName && onName !== user && !from[fromSlot].includes(onName) && !toRow[toSlot].includes(user)) {
      return save([
        change(from, fromSlot, from[fromSlot].map((id) => (id === user ? onName : id))),
        change(toRow, toSlot, toRow[toSlot].map((id) => (id === onName ? user : id))),
      ], `Swapped ${nameOf(user)} and ${nameOf(onName)}.`);
    }
    if (toRow[toSlot].includes(user)) return toast(`${nameOf(user)} is already on ${label(toRow, toSlot)}.`);
    const changes = [change(toRow, toSlot, [...toRow[toSlot], user])];
    if (from) changes.unshift(change(from, fromSlot, from[fromSlot].filter((id) => id !== user)));
    save(changes, from ? `Moved ${nameOf(user)} to ${label(toRow, toSlot)}.` : `Added ${nameOf(user)} to ${label(toRow, toSlot)}.`);
  }

  // ---------------------------------------------------------------- ranch hands: ask to take or swap
  function askSheet(chipEl) {
    const d = st.data;
    const row = rowOf(chipEl.dataset.row);
    const slot = chipEl.dataset.slot;
    const them = chipEl.dataset.user;
    const label = `${row.label} ${slot.toUpperCase()}`;
    const mine = rows().filter((r) => !r.past).flatMap((r) => ['am', 'pm'].filter((s) => r[s].includes(d.me) && !r[s].includes(them)).map((s) => ({ r, s })));
    const dlg = document.createElement('dialog');
    dlg.className = 'sched-dialog';
    dlg.innerHTML = `<form method="dialog" class="sched-dialog__x"><button aria-label="Close">&times;</button></form>
      <h2>${esc(nameOf(them))}&rsquo;s ${esc(label)}</h2>
      <p class="muted">A manager approves it before the schedule changes.</p>
      <div class="field"><label for="sched-note">Note for the manager (optional)</label><input id="sched-note" maxlength="300" placeholder="Doctor’s appointment that morning"></div>
      <button class="btn btn--red" type="button" data-ask="take" style="width:100%;margin-top:12px">Ask to take this shift</button>
      ${mine.length ? `<p style="margin:18px 0 8px"><strong>Or swap it for one of yours</strong></p>${mine.map(({ r, s }) => `<button class="btn btn--ghost" type="button" data-ask="swap" data-from-day="${r.day}" data-from-slot="${s}" style="width:100%;margin-top:8px">Give ${esc(nameOf(them))} my ${esc(r.label)} ${s.toUpperCase()}</button>`).join('')}`
        : '<p class="muted" style="margin-top:14px">You have no shifts this week to swap.</p>'}
      <p class="inline-error" data-err style="margin-top:10px"></p>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', async (e) => {
      if (e.target === dlg) return dlg.close();
      const b = e.target.closest('[data-ask]');
      if (!b) return;
      b.disabled = true;
      const body = { kind: b.dataset.ask, to: { day: row.day, slot, userId: them }, note: dlg.querySelector('#sched-note').value };
      if (body.kind === 'swap') body.from = { day: b.dataset.fromDay, slot: b.dataset.fromSlot };
      try { await api('POST', '/admin/schedule/requests', body); dlg.close(); toast('Sent. A manager will approve it.'); refresh(); } catch (ex) { dlg.querySelector('[data-err]').textContent = ex.message; b.disabled = false; }
    });
    dlg.showModal();
  }

  // ---------------------------------------------------------------- managers: pick who works a shift
  function pickSheet(slotEl) {
    const d = st.data;
    const row = rowOf(slotEl.dataset.row);
    const slot = slotEl.dataset.slot;
    if (!row) return;
    const label = `${row.label} ${slot.toUpperCase()}`;
    const dlg = document.createElement('dialog');
    dlg.className = 'sched-dialog';
    dlg.innerHTML = `<form method="dialog" class="sched-dialog__x"><button aria-label="Close">&times;</button></form>
      <h2>${esc(label)}</h2><p class="muted">${st.mode === 'usual' ? 'Every week, unless a day is changed by hand.' : 'Only this day.'}</p>
      <form id="sched-pick" novalidate>${d.team.map((u) => `<label class="choice" style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)"><input type="checkbox" value="${u.id}"${row[slot].includes(u.id) ? ' checked' : ''} style="width:22px;height:22px;accent-color:var(--red)"> ${esc(u.name)}</label>`).join('') || '<p class="muted">Add ranch hands in People first.</p>'}
        <button class="btn btn--red" type="submit" style="width:100%;margin-top:14px">Save</button></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.querySelector('#sched-pick').addEventListener('submit', (e) => {
      e.preventDefault();
      const picked = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value);
      // keep the order already on the shift, new names at the end
      const ids = [...row[slot].filter((id) => picked.includes(id)), ...picked.filter((id) => !row[slot].includes(id))];
      dlg.close();
      if (ids.join() === row[slot].join()) return;
      save([change(row, slot, ids)], `${label}: ${ids.length ? ids.map(nameOf).join(', ') : 'nobody'}.`);
    });
    dlg.showModal();
  }

  // ---------------------------------------------------------------- actions
  function bind() {
    const wrap = root.querySelector('.schedule');
    wrap.addEventListener('change', (e) => { if (e.target.id === 's-day' && e.target.value) { st.day = e.target.value; refresh(); } });
    wrap.addEventListener('click', async (e) => {
      if (drag.justDropped) return;
      const t = e.target;
      const m = t.closest('[data-mode]');
      if (m) { st.mode = m.dataset.mode; return render(); }
      const w = t.closest('[data-week]');
      if (w) { st.day = addDays(st.day, Number(w.dataset.week)); return refresh(); }
      if (t.closest('[data-remove]')) {
        const c = t.closest('.sched-chip');
        const row = rowOf(c.dataset.row);
        return save([change(row, c.dataset.slot, row[c.dataset.slot].filter((id) => id !== c.dataset.user))], `Took ${nameOf(c.dataset.user)} off ${row.label} ${c.dataset.slot.toUpperCase()}.`);
      }
      if (t.closest('[data-reset]')) {
        if (!confirm('Set every day this week back to the usual week? The changes made by hand this week go away.')) return;
        try { await api('POST', '/admin/schedule/reset', { days: st.data.days.map((x) => x.day) }); toast('This week matches the usual week again'); refresh(); } catch (ex) { toast(ex.message); }
        return;
      }
      const dec = t.closest('[data-decide]');
      if (dec) {
        dec.disabled = true;
        try { const r = await api('POST', `/admin/schedule/requests/${dec.dataset.decide}/decide`, { approve: !!dec.dataset.approve }); toast(r.request.status === 'approved' ? 'Approved. The schedule is updated.' : 'Declined'); refresh(); } catch (ex) { toast(ex.message); dec.disabled = false; }
        return;
      }
      const can = t.closest('[data-cancel-req]');
      if (can) {
        try { await api('POST', `/admin/schedule/requests/${can.dataset.cancelReq}/cancel`); toast('Request cancelled'); refresh(); } catch (ex) { toast(ex.message); }
        return;
      }
      const c = t.closest('.sched-chip[role="button"]');
      if (c) return askSheet(c);
      // Managers: tap a shift (not a name) to pick who works it; works on any day without dragging
      const slotEl = t.closest('.sched-slot:not(.sched-palette):not(.is-past)');
      if (slotEl && st.data.canEdit && !t.closest('.sched-chip')) pickSheet(slotEl);
    });
    wrap.addEventListener('keydown', (e) => { const c = e.target.closest && e.target.closest('.sched-chip[role="button"]'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); askSheet(c); } });
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const b = Object.fromEntries(new FormData(f));
      try {
        await api('PATCH', '/admin/schedule/settings', { am: { start: b.amStart, end: b.amEnd }, pm: { start: b.pmStart, end: b.pmEnd } });
        toast('Shift times saved'); refresh();
      } catch (ex) { f.querySelector('[data-err]').textContent = ex.message; }
    });
  }

  // ---------------------------------------------------------------- drag (same feel as the Stall board)
  // Phones: press and hold ~0.4 s, then drag (moving sooner just scrolls). Mouse: drag right away.
  const drag = { el: null, pointerId: null, startX: 0, startY: 0, active: false, over: null, ghost: null, timer: 0, justDropped: false, x: 0, y: 0, scroller: 0 };
  // Near the top or bottom edge the page scrolls by itself, so a name from the Team list reaches Sunday on a phone
  function edgeScroll() {
    clearInterval(drag.scroller);
    drag.scroller = setInterval(() => {
      if (!drag.active) return clearInterval(drag.scroller);
      const edge = 80, h = window.innerHeight;
      const dy = drag.y < edge ? -Math.ceil((edge - drag.y) / 4) : drag.y > h - edge ? Math.ceil((drag.y - (h - edge)) / 4) : 0;
      if (dy) { window.scrollBy(0, dy); follow(drag.x, drag.y); }
    }, 16);
  }
  const canDrag = (el) => el && st.data && st.data.canEdit && root && root.contains(el) && !el.closest('.sched-slot.is-past');

  function lift(x, y) {
    drag.active = true;
    drag.el.classList.add('is-lifted');
    drag.ghost = drag.el.cloneNode(true);
    drag.ghost.classList.add('drag-ghost');
    document.body.appendChild(drag.ghost);
    if (navigator.vibrate) navigator.vibrate(12);
    follow(x, y);
    edgeScroll();
  }
  function follow(x, y) {
    drag.x = x; drag.y = y;
    drag.ghost.style.transform = `translate(${x - drag.ghost.offsetWidth / 2}px, ${y - 30}px)`;
    const hit = document.elementFromPoint(x, y);
    const chipHit = hit && hit.closest('.sched-slot:not(.sched-palette):not(.is-past) .sched-chip');
    const slotHit = hit && hit.closest('.sched-slot:not(.sched-palette):not(.is-past)');
    const t = chipHit && chipHit !== drag.el ? chipHit : slotHit;
    if (t !== drag.over) {
      if (drag.over) drag.over.classList.remove('is-target');
      if (t) t.classList.add('is-target');
      drag.over = t;
    }
  }
  function endDrag() {
    clearTimeout(drag.timer);
    clearInterval(drag.scroller);
    if (drag.ghost) drag.ghost.remove();
    if (drag.el) drag.el.classList.remove('is-lifted');
    if (drag.over) drag.over.classList.remove('is-target');
    Object.assign(drag, { el: null, pointerId: null, active: false, over: null, ghost: null });
  }
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest && e.target.closest('.sched-chip');
    if (!canDrag(el) || e.button > 0 || e.target.closest('[data-remove]')) return;
    endDrag();
    Object.assign(drag, { el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY });
    if (e.pointerType !== 'mouse') drag.timer = setTimeout(() => lift(drag.startX, drag.startY), 400);
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag.el || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const far = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (e.pointerType === 'mouse' && far > 6) lift(e.clientX, e.clientY);
      else if (far > 10) return endDrag();
      else return;
    }
    follow(e.clientX, e.clientY);
  });
  document.addEventListener('pointerup', (e) => {
    if (!drag.el || e.pointerId !== drag.pointerId) return;
    const { active, el, over } = drag;
    endDrag();
    if (!active) return;
    drag.justDropped = true;
    setTimeout(() => { drag.justDropped = false; }, 350);
    if (over) drop(el, over);
  });
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (drag.el && e.target.closest && e.target.closest('.sched-chip')) e.preventDefault(); });

  return { view };
})();
