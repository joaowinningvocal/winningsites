/* Hours, for the ranch manager and office: who's on the clock, each day's shifts with
   corrections, the pay-week totals for payroll, and the time clock settings. */
window.WRHours = (() => {
  const { api, esc, toast } = window.WR;
  const st = { mode: 'day', day: null, editing: null, adding: false };
  let root;

  const laToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) : '');
  const hm = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '');
  const dur = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m) % 60).padStart(2, '0')}m`;
  const dec = (m) => (m ? (Math.round((m / 60) * 100) / 100).toFixed(2) : '');
  const dayName = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  async function view(container) {
    root = container;
    st.day = st.day || laToday();
    root.innerHTML = '<div class="wrap"><p class="muted">Loading hours…</p></div>';
    const [cfg, main] = await Promise.all([
      api('GET', '/admin/hours/settings'),
      st.mode === 'day' ? api('GET', `/admin/hours/day?day=${st.day}`) : api('GET', `/admin/hours/week?day=${st.day}`),
    ]);
    const onShift = st.mode === 'day' ? main.onShift : (await api('GET', `/admin/hours/day?day=${laToday()}`)).onShift;
    root.innerHTML = `
      <div class="wrap hours">
        <div class="pricing__head">
          <div><h1>Hours</h1><p class="muted">Clock-ins are checked against the ranch location. Breaks are taken out of the hours.</p></div>
          <div class="hours__pick">
            <div class="seg" role="group" aria-label="View"><button type="button" data-mode="day" aria-pressed="${st.mode === 'day'}">Day</button><button type="button" data-mode="week" aria-pressed="${st.mode === 'week'}">Pay week</button></div>
            <input type="date" id="h-day" value="${esc(st.day)}" aria-label="Date">
          </div>
        </div>
        <section class="panel now-on">
          <h2>On the clock now</h2>
          ${onShift.length ? `<ul class="now-list">${onShift.map((s) => `<li><strong>${esc(s.name)}</strong> since ${esc(time(s.in.at))}${s.onBreak ? ' <span class="status status--pending">on break</span>' : ''}${s.flags.includes('No clock-out') ? ' <span class="status status--cancelled">forgot to clock out?</span>' : ''}</li>`).join('')}</ul>` : '<p class="muted">Nobody right now.</p>'}
        </section>
        ${st.mode === 'day' ? dayHtml(main, cfg) : weekHtml(main)}
        ${settingsHtml(cfg)}
      </div>`;
    bind(cfg, main);
  }

  // ---------------------------------------------------------------- day
  function dayHtml(main, cfg) {
    const people = cfg.team.filter((u) => u.position !== 'office');
    const total = main.shifts.reduce((t, s) => t + s.worked, 0);
    const notes = main.shifts.flatMap((s) => s.notes.map((n) => ({ ...n, name: s.name })));
    const editForm = (s) => `
      <tr class="edit-row"><td colspan="8"><form class="form-grid" data-edit="${s.id}" novalidate>
        <div class="field"><label>Clock in</label><input type="time" name="inTime" value="${hm(s.in.at)}"></div>
        <div class="field"><label>Clock out</label><input type="time" name="outTime" value="${hm(s.out && s.out.at)}"></div>
        <div class="field"><label>Break minutes</label><input name="breakMinutes" inputmode="numeric" value="${Math.round(s.breakMinutes)}"></div>
        <div class="field"><label>Reason for the change</label><input name="note" placeholder="Forgot to clock out" required></div>
        <p class="inline-error full" data-err></p>
        <div class="form-actions full"><button class="btn btn--red btn--sm" type="submit">Save</button><button class="btn btn--sm btn--ghost" type="button" data-cancel>Cancel</button><button class="btn btn--sm btn--ghost" type="button" data-del-shift="${s.id}">Delete shift</button></div>
      </form></td></tr>`;
    return `
      <section class="panel">
        <div class="history__head"><h2>${esc(dayName(st.day))}</h2><span class="muted">${main.shifts.length} shift${main.shifts.length === 1 ? '' : 's'}, ${dur(total)}</span></div>
        <div class="sheet-wrap"><table class="hours-table">
          <thead><tr><th>Name</th><th>In</th><th>Out</th><th>Breaks</th><th>Worked</th><th class="hide-sm">Checklist</th><th>Check</th><th></th></tr></thead>
          <tbody>${main.shifts.map((s) => `
            <tr><td><strong>${esc(s.name)}</strong></td><td>${esc(time(s.in.at))}</td><td>${s.out ? esc(time(s.out.at)) : '<span class="status status--pending">on</span>'}</td>
              <td>${Math.round(s.breakMinutes)} min</td><td><strong>${dur(s.worked)}</strong></td><td class="hide-sm">${s.stats.total ? `${s.stats.done}/${s.stats.total}` : ''}</td>
              <td>${s.flags.length ? `<span class="flag">${esc(s.flags.join('; '))}</span>` : '<span class="ok">OK</span>'}</td>
              <td><button class="btn btn--sm btn--ghost" type="button" data-edit-open="${s.id}">Fix</button></td></tr>
            ${st.editing === s.id ? editForm(s) : ''}`).join('') || '<tr><td colspan="8" class="muted">No shifts this day.</td></tr>'}
          </tbody></table></div>
        ${st.adding ? `
          <form class="form-grid add-shift" id="add-shift" novalidate>
            <h3 class="full" style="margin:0">Add a missed shift</h3>
            <div class="field"><label>Person</label><select name="userId">${people.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Date</label><input type="date" name="day" value="${esc(st.day)}"></div>
            <div class="field"><label>Clock in</label><input type="time" name="inTime"></div>
            <div class="field"><label>Clock out</label><input type="time" name="outTime"></div>
            <div class="field"><label>Break minutes</label><input name="breakMinutes" inputmode="numeric" value="0"></div>
            <div class="field"><label>Reason</label><input name="note" placeholder="Phone died, worked 7 to 3"></div>
            <p class="inline-error full" data-err></p>
            <div class="form-actions full"><button class="btn btn--red btn--sm" type="submit">Add shift</button><button class="btn btn--sm btn--ghost" type="button" data-add-cancel>Cancel</button></div>
          </form>` : `<p style="margin-top:14px"><button class="btn btn--sm" type="button" data-add${people.length ? '' : ' disabled'}>Add a missed shift</button>${people.length ? '' : ' <small class="muted">Add ranch hands in People first.</small>'}</p>`}
        ${notes.length ? `<h3 style="margin-top:22px">Notes from the shifts</h3><ul class="notes">${notes.map((n) => `<li>${n.urgent ? '<b class="urgent">Urgent</b> ' : ''}<strong>${esc(n.name)}</strong>, ${esc(time(n.at))}: ${esc(n.text)}</li>`).join('')}</ul>` : ''}
        <p class="muted" style="margin-top:14px"><a class="textlink" href="/api/ranch/admin/hours/preview?kind=daily&day=${esc(st.day)}" target="_blank" rel="noopener">See this day&rsquo;s email</a></p>
      </section>`;
  }

  // ---------------------------------------------------------------- week
  function weekHtml(main) {
    const total = main.per.reduce((t, p) => t + p.total, 0);
    return `
      <section class="panel">
        <div class="history__head"><h2>${esc(dayName(main.start))} to ${esc(dayName(main.days[6]))}</h2><span class="muted">${dec(total) || '0.00'} hours in total</span></div>
        <div class="sheet-wrap"><table class="hours-table">
          <thead><tr><th>Name</th>${main.days.map((d) => `<th>${esc(dayName(d).split(',')[0])}</th>`).join('')}<th>Total</th><th>Check</th></tr></thead>
          <tbody>${main.per.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td>${p.byDay.map((m) => `<td>${dec(m)}</td>`).join('')}<td><strong>${dec(p.total) || '0.00'}</strong></td>
            <td>${[p.flagged ? `${p.flagged} flagged` : '', p.total > 2400 ? 'Over 40 h' : '', p.over8 ? `${p.over8} day${p.over8 === 1 ? '' : 's'} over 8 h` : ''].filter(Boolean).map((t) => `<span class="flag">${t}</span>`).join(' ') || '<span class="ok">OK</span>'}</td></tr>`).join('')
            || `<tr><td colspan="10" class="muted">No hours this week.</td></tr>`}</tbody></table></div>
        <div class="btn-row" style="margin-top:16px">
          <a class="btn btn--sm btn--red" href="/api/ranch/admin/hours/week.csv?day=${esc(st.day)}">Download for payroll (CSV)</a>
          <a class="btn btn--sm btn--ghost" href="/api/ranch/admin/hours/preview?kind=weekly&day=${esc(st.day)}" target="_blank" rel="noopener">See the weekly email</a>
          <button class="btn btn--sm btn--ghost" type="button" data-send="weekly">Email it now</button>
        </div>
        <p class="muted" style="margin-top:10px">Hours are decimal (7.50 = 7 hours 30 minutes). Click a day in Day view to fix a shift.</p>
      </section>`;
  }

  // ---------------------------------------------------------------- settings
  function settingsHtml(cfg) {
    const c = cfg.settings;
    const last = cfg.log.daily.slice(-1)[0];
    return `
      <details class="panel hours-settings"${c.geo && c.reportTo ? '' : ' open'}>
        <summary><h2>Time clock settings</h2></summary>
        <form class="form-grid" id="tc-form" novalidate>
          <div class="full geo-box">
            <strong>Ranch location</strong>
            <p class="muted">${c.geo ? `Set by ${esc(c.geo.setBy || 'a manager')}. People can clock in within ${c.radius} m (about ${Math.round(c.radius * 3.281)} ft) of it.` : 'Not set. Stand at the barn with your phone and tap the button, so clock-ins are checked against the ranch.'}</p>
            <div class="btn-row"><button class="btn btn--sm ${c.geo ? 'btn--ghost' : 'btn--red'}" type="button" data-geo>${c.geo ? 'Reset to where I am now' : 'Use where I am now'}</button>
              <label class="field inline-field">Radius in meters <input name="radius" inputmode="numeric" value="${c.radius}"><small class="muted">150 m is about 500 ft</small></label></div>
          </div>
          <div class="field full"><label>Send reports to</label><input name="reportTo" value="${esc(c.reportTo)}" placeholder="jenna@winningranch.com, randy@winningranch.com"><small class="muted">Separate several emails with commas.</small></div>
          <div class="field"><label>Daily report time (Las Vegas)</label><input type="time" name="dailyTime" value="${esc(c.dailyTime)}"><small class="muted">Sends the day before, every morning.</small></div>
          <div class="field"><label>Pay week starts on</label><select name="weekStart">${WEEKDAYS.map((d, i) => `<option value="${i}"${i === c.weekStart ? ' selected' : ''}>${d}</option>`).join('')}</select><small class="muted">The payroll report goes out that morning.</small></div>
          <p class="full muted">${cfg.email === 'none' ? '<span class="flag">Email isn&rsquo;t connected yet.</span> Add RESEND_API_KEY in Railway (see the README).' : `Reports are sent by ${cfg.email}.`} ${last ? `Last daily report: ${esc(last[0])}, ${last[1].ok ? 'sent' : `not sent (${esc(last[1].error || 'pending')})`}.` : ''}</p>
          <div class="field full"><label>Shift checklist</label><textarea name="checklistText" rows="12">${esc(c.checklistText)}</textarea>
            <small class="muted">Start a section with # and put one task per line. Changes apply from the next clock-in.</small></div>
          <p class="inline-error full" data-err></p>
          <div class="form-actions full"><button class="btn btn--red btn--sm" type="submit">Save settings</button><button class="btn btn--sm btn--ghost" type="button" data-send="daily">Send yesterday&rsquo;s report now</button></div>
        </form>
      </details>`;
  }

  // ---------------------------------------------------------------- actions
  function bind() {
    const wrap = root.querySelector('.hours');
    wrap.addEventListener('change', (e) => {
      if (e.target.id === 'h-day' && e.target.value) { st.day = e.target.value; st.editing = null; view(root); }
    });
    wrap.addEventListener('click', async (e) => {
      const t = e.target;
      const m = t.closest('[data-mode]');
      if (m) { st.mode = m.dataset.mode; st.editing = null; return view(root); }
      const ed = t.closest('[data-edit-open]');
      if (ed) { st.editing = st.editing === ed.dataset.editOpen ? null : ed.dataset.editOpen; return view(root); }
      if (t.closest('[data-cancel]')) { st.editing = null; return view(root); }
      if (t.closest('[data-add]')) { st.adding = true; return view(root); }
      if (t.closest('[data-add-cancel]')) { st.adding = false; return view(root); }
      const del = t.closest('[data-del-shift]');
      if (del) {
        if (!confirm('Delete this shift? It comes off the reports.')) return;
        try { await api('DELETE', `/admin/hours/shifts/${del.dataset.delShift}`); st.editing = null; toast('Shift deleted'); view(root); } catch (ex) { toast(ex.message); }
        return;
      }
      const send = t.closest('[data-send]');
      if (send) {
        const day = send.dataset.send === 'daily' ? new Date(new Date(laToday() + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10) : st.day;
        send.disabled = true;
        try { const r = await api('POST', '/admin/hours/send', { kind: send.dataset.send, day }); toast(`Report sent by ${r.via}`); } catch (ex) { toast(ex.message); }
        send.disabled = false;
        return;
      }
      if (t.closest('[data-geo]')) {
        if (!navigator.geolocation) { toast('This browser can’t share location.'); return; }
        toast('Getting your location…');
        navigator.geolocation.getCurrentPosition(async (p) => {
          try {
            await api('PATCH', '/admin/hours/settings', { geo: { lat: p.coords.latitude, lng: p.coords.longitude } });
            toast(`Ranch location saved (accurate to about ${Math.round(p.coords.accuracy)} m)`);
            view(root);
          } catch (ex) { toast(ex.message); }
        }, () => toast('Allow location for this site and try again.'), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      }
    });
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = f.querySelector('[data-err]');
      if (err) err.textContent = '';
      const body = Object.fromEntries(new FormData(f));
      try {
        if (f.dataset.edit) {
          await api('PATCH', `/admin/hours/shifts/${f.dataset.edit}`, body);
          st.editing = null; toast('Shift fixed. The change is noted in the report.');
        } else if (f.id === 'add-shift') {
          await api('POST', '/admin/hours/shifts', body);
          st.adding = false; st.day = body.day; toast('Shift added');
        } else if (f.id === 'tc-form') {
          await api('PATCH', '/admin/hours/settings', { radius: body.radius, reportTo: body.reportTo, dailyTime: body.dailyTime, weekStart: Number(body.weekStart), checklistText: body.checklistText });
          toast('Settings saved');
        }
        view(root);
      } catch (ex) { if (err) err.textContent = ex.message; else toast(ex.message); }
    });
  }

  return { view };
})();
