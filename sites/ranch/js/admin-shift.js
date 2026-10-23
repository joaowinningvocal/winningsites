/* "My shift" for ranch hands and the ranch manager:
   clock in at the ranch (location checked), breaks, the shift checklist, notes, clock out. */
window.WRShift = (() => {
  const { api, esc, toast, timeAgo } = window.WR;
  let root, data, ticker = 0;

  const TZ = 'America/Los_Angeles'; // ranch time, wherever the phone thinks it is
  const time = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const dur = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m) % 60).padStart(2, '0')}m`;

  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('This browser can’t share your location.'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => reject(new Error(e.code === 1
          ? 'Location is blocked for this site. Allow location in your phone or browser settings, then try again.'
          : 'Couldn’t get your location. Step outside or check that location is on, then try again.')),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      );
    });
  }

  async function view(container) {
    root = container;
    clearInterval(ticker);
    root.innerHTML = '<div class="wrap"><p class="muted">Loading your shift…</p></div>';
    data = await api('GET', '/admin/shift');
    paint();
    ticker = setInterval(() => { if (!document.hidden && data.shift && document.body.contains(root.querySelector('.clock'))) paintClock(); }, 30000);
  }

  function workedNow(s) {
    // Server sends minutes as of the request; add the time since for a live counter
    const since = (Date.now() - fetchedAt) / 60000;
    return s.onBreak ? s.worked : s.worked + since;
  }
  let fetchedAt = Date.now();

  function paint() {
    fetchedAt = Date.now();
    const s = data.shift;
    root.innerHTML = `
      <div class="wrap shift">
        <section class="clock panel" id="clock"></section>
        ${s ? `
          <section class="panel">
            <div class="check-head"><h2>Shift checklist</h2><span class="check-count" id="check-count"></span></div>
            ${s.checklist.map((sec, si) => `
              <fieldset class="check-sec"><legend>${esc(sec.title)}</legend>
                ${sec.items.map((it, ii) => `<label class="check-item"><input type="checkbox" data-s="${si}" data-i="${ii}"${it.done ? ' checked' : ''}><span>${esc(it.text)}</span></label>`).join('')}
              </fieldset>`).join('')}
          </section>
          <section class="panel">
            <h2>Notes for management</h2>
            <p class="muted">Injuries, unusual behavior, supply needs or anything left undone. Notes go in the daily report.</p>
            <form id="note-form" class="stack" novalidate>
              <div class="field"><label for="note-text">Note</label><textarea id="note-text" rows="3" placeholder="Stall 7 water bucket is cracked"></textarea></div>
              <label class="choice"><input type="checkbox" id="note-urgent"><span>Urgent: email management now</span></label>
              <button class="btn btn--sm" type="submit">Send note</button>
            </form>
            ${s.notes.length ? `<ul class="notes">${s.notes.slice().reverse().map((n) => `<li>${n.urgent ? '<b class="urgent">Urgent</b> ' : ''}${esc(n.text)} <small class="muted">${esc(time(n.at))}</small></li>`).join('')}</ul>` : ''}
          </section>` : `
          <section class="panel">
            <h2>Your recent shifts</h2>
            ${data.recent.length ? `<ul class="recent">${data.recent.map((r) => `<li><span>${esc(new Date(r.in.at).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }))}</span><span>${esc(time(r.in.at))} to ${esc(time(r.out.at))}</span><strong>${dur(r.worked)}</strong></li>`).join('')}</ul>` : '<p class="muted">Nothing yet. Your shifts show up here.</p>'}
          </section>`}
      </div>
      <dialog class="sheet out-sheet" id="out-sheet"></dialog>`;
    paintClock();
    if (s) paintCount();
    bind();
  }

  function paintClock() {
    const s = data.shift;
    const box = root.querySelector('#clock');
    if (!box) return;
    if (!s) {
      box.className = 'clock panel is-off';
      box.innerHTML = `
        <p class="clock__state">You&rsquo;re off the clock</p>
        <button class="btn btn--red clock__big" type="button" data-act="in">Clock in</button>
        <p class="muted clock__hint">${data.geoReady ? 'We check that you&rsquo;re at the ranch when you clock in, so allow location when your phone asks.' : 'The ranch location isn&rsquo;t set up yet, so clock-ins aren&rsquo;t location-checked.'}</p>
        <p class="inline-error" id="clock-error" role="alert"></p>`;
      return;
    }
    const brk = s.breaks.find((b) => !b.end);
    box.className = `clock panel ${brk ? 'is-break' : 'is-on'}`;
    box.innerHTML = `
      <p class="clock__state">${brk ? `On break since ${esc(time(brk.start))}` : `On the clock since ${esc(time(s.in.at))}`}</p>
      <p class="clock__time">${dur(workedNow(s))} <small>worked</small></p>
      <div class="clock__actions">
        ${brk ? '<button class="btn btn--red" type="button" data-act="break-end">End break</button>' : '<button class="btn" type="button" data-act="break-start">Start break</button>'}
        <button class="btn ${brk ? '' : 'btn--red'}" type="button" data-act="out">Clock out</button>
      </div>
      <p class="muted clock__hint">${s.breakMinutes ? `${Math.round(s.breakMinutes)} min of breaks so far, taken out of your hours.` : 'Breaks are taken out of your hours.'}</p>
      <p class="inline-error" id="clock-error" role="alert"></p>`;
  }

  function paintCount() {
    const items = data.shift.checklist.flatMap((s) => s.items);
    const done = items.filter((i) => i.done).length;
    const el = root.querySelector('#check-count');
    if (el) el.textContent = `${done} of ${items.length} done`;
  }

  async function act(kind, btn) {
    const err = root.querySelector('#clock-error');
    if (err) err.textContent = '';
    if (btn) btn.disabled = true;
    try {
      if (kind === 'in') {
        let where = null;
        try { where = await locate(); } catch (ex) { if (data.geoReady) throw ex; }
        data.shift = (await api('POST', '/admin/shift/clock-in', where || {})).shift;
        toast('Clocked in. Have a good shift.');
        return paint();
      }
      if (kind === 'break-start' || kind === 'break-end') {
        data.shift = (await api('POST', '/admin/shift/break', { action: kind === 'break-start' ? 'start' : 'end' })).shift;
        toast(kind === 'break-start' ? 'Break started' : 'Back on the clock');
        fetchedAt = Date.now();
        return paintClock();
      }
      if (kind === 'out') return openOut();
    } catch (ex) {
      if (err) err.textContent = ex.message; else toast(ex.message);
    } finally { if (btn) btn.disabled = false; }
  }

  function openOut() {
    const items = data.shift.checklist.flatMap((s) => s.items);
    const left = items.filter((i) => !i.done).length;
    const dlg = root.querySelector('#out-sheet');
    dlg.innerHTML = `
      <div class="sheet__body">
        <h2>Clock out?</h2>
        <p>${left ? `<strong>${left} task${left === 1 ? '' : 's'} on the checklist ${left === 1 ? 'isn&rsquo;t' : 'aren&rsquo;t'} checked.</strong> Say what&rsquo;s not done so the next person knows.` : 'Every task on the checklist is done. Nice work.'}</p>
        <form id="out-form" class="stack" novalidate>
          <div class="field"><label for="out-note">Note for management${left ? '' : ' (optional)'}</label><textarea id="out-note" rows="3"></textarea></div>
          <p class="inline-error" id="out-error" role="alert"></p>
          <div class="btn-row"><button class="btn btn--red" type="submit">Clock out</button><button class="btn" type="button" data-close>Keep working</button></div>
        </form>
      </div>`;
    dlg.showModal();
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.querySelector('#out-form').onsubmit = async (e) => {
      e.preventDefault();
      const note = dlg.querySelector('#out-note').value.trim();
      const errEl = dlg.querySelector('#out-error');
      if (left && !note) { errEl.textContent = 'Add a quick note about what’s not done.'; return; }
      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      let where = null;
      try { where = await locate(); } catch (_) { /* clocking out still works without location */ }
      try {
        const { shift } = await api('POST', '/admin/shift/clock-out', { ...(where || {}), note });
        dlg.close();
        toast(`Clocked out. ${dur(shift.worked)} worked today.`);
        view(root);
      } catch (ex) { errEl.textContent = ex.message; btn.disabled = false; }
    };
  }

  function bind() {
    const wrap = root.querySelector('.shift');
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) act(b.dataset.act, b);
    });
    wrap.addEventListener('change', async (e) => {
      const c = e.target.closest('[data-s]');
      if (!c) return;
      const item = data.shift.checklist[c.dataset.s].items[c.dataset.i];
      item.done = c.checked;
      paintCount();
      try { await api('PATCH', '/admin/shift/checklist', { section: +c.dataset.s, item: +c.dataset.i, done: c.checked }); }
      catch (ex) { c.checked = !c.checked; item.done = c.checked; paintCount(); toast(ex.message); }
    });
    const nf = wrap.querySelector('#note-form');
    if (nf) nf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = wrap.querySelector('#note-text').value.trim();
      if (!text) { toast('Write the note first.'); return; }
      try {
        const r = await api('POST', '/admin/shift/note', { text, urgent: wrap.querySelector('#note-urgent').checked });
        data.shift = r.shift;
        toast(r.emailed ? 'Note sent and emailed to management' : 'Note saved for the daily report');
        paint();
      } catch (ex) { toast(ex.message); }
    });
  }

  return { view, stop: () => clearInterval(ticker) };
})();
