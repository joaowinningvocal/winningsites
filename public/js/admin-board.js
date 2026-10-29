/* Stall board for the staff app (#/board)
   - The barn on a given day the way the ranch numbers it: right side 1-10, left side 11-20, 1 and 11 at the bottom
   - Two weeks ahead, stall by stall, to see what's booked and what's free
   - Add horses to stalls to block them out: monthly boarders, nightly stays, or one of our own horses (can move)
   - The stall assistant: "5 horses coming Nov 15 - Nov 17" picks stalls close together and books them
   - Without the assistant, "Find stalls" does the same picking and the team books with one tap */
window.WRBoard = (() => {
  const { api, esc, toast, fmtDay } = window.WR;
  const DAYS = 14;
  const state = { day: null, data: null, chat: [], found: null, finder: null };
  let root = null;

  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const short = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const weekday = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
  const byId = (id) => state.data.stalls.find((s) => s.id === id);
  const label = (s) => (s.group === 'main' ? `Stall ${s.number}` : `Outdoor ${s.number}`);
  const order = (a, b) => (a.group === b.group ? a.number - b.number : a.group === 'main' ? -1 : 1);
  const covers = (x, day) => x.from <= day && (!x.to || day < x.to);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const horseIn = (stay, stallId) => stay.horses[stay.stallIds.indexOf(stallId)] || '';
  const whoIn = (stay, stallId) => horseIn(stay, stallId) || stay.name || (stay.ours ? 'Our horse' : stay.kind === 'monthly' ? 'Boarder' : 'Guest');
  const KIND = { free: 'Free', off: 'Not in use', horse: 'Horses tab', monthly: 'Monthly', nightly: 'Nightly', ours: 'Ours' };

  // What a stall holds on a day
  function cell(s, day) {
    if (s.status !== 'available') return { kind: 'off' };
    const horse = state.data.horses.find((h) => h.stallId === s.id);
    const here = state.data.stays.filter((x) => x.stallIds.includes(s.id) && covers(x, day));
    const hard = here.find((x) => !x.ours);
    const ours = here.find((x) => x.ours);
    if (horse) return { kind: 'horse', horse, move: ours };
    if (hard) return { kind: hard.kind === 'monthly' ? 'monthly' : 'nightly', stay: hard, move: ours };
    if (ours) return { kind: 'ours', stay: ours };
    return { kind: 'free' };
  }

  async function load() {
    state.data = await api('GET', `/admin/board?from=${state.day || ''}&days=${DAYS}`);
    if (!state.day) state.day = state.data.today;
  }

  // ---------------------------------------------------------------- the view
  async function view(el) {
    root = el;
    root.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    await load();
    draw();
    root.onclick = onClick;
    root.onsubmit = onSubmit;
    root.onchange = (e) => { if (e.target.id === 'b-day' && e.target.value) go(e.target.value); };
  }

  function draw() {
    const d = state.data;
    const day = state.day;
    const inUse = d.stalls.filter((s) => s.status === 'available');
    const cells = inUse.map((s) => cell(s, day));
    const count = (k) => cells.filter((c) => c.kind === k).length;
    root.innerHTML = `
      <div class="wrap board-page">
        <h1>Stall board</h1>
        <p class="muted">Who&rsquo;s in each stall. Tap a stall to add a horse, change a booking or move someone out.</p>
        ${d.ai ? assistantPanel() : ''}
        ${finderPanel(!d.ai)}
        <section class="panel">
          <div class="board-day">
            <button class="chip" type="button" data-go="-1" aria-label="Day before">&lsaquo;</button>
            <input type="date" id="b-day" value="${day}" aria-label="Day">
            <button class="chip" type="button" data-go="1" aria-label="Next day">&rsaquo;</button>
            ${day !== d.today ? '<button class="chip" type="button" data-go="today">Today</button>' : ''}
            <strong class="board-day__label">${esc(fmtDay(day))}${day === d.today ? ', today' : ''}</strong>
          </div>
          <div class="kpis">
            <div class="kpi kpi--dark"><span>Free</span><strong>${count('free')}</strong><small>of ${inUse.length} stalls in use</small></div>
            <div class="kpi"><span>Monthly boarders</span><strong>${count('monthly') + count('horse')}</strong></div>
            <div class="kpi"><span>Nightly</span><strong>${count('nightly')}</strong></div>
            <div class="kpi"><span>Our horses</span><strong>${count('ours')}</strong><small>can move to free a stall</small></div>
          </div>
          ${barn(day)}
          ${legend()}
        </section>
        <section class="panel">
          <h2>Next two weeks</h2>
          <p class="muted">Each row is a stall. Tap a day to open that stall.</p>
          ${calendar()}
        </section>
      </div>`;
    const log = root.querySelector('.ai-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function tile(s, day) {
    const c = cell(s, day);
    const tags = [s.ponyOnly ? 'Ponies only' : '', s.smaller ? s.size || 'Shorter' : ''].filter(Boolean);
    let who = '', sub = '';
    if (c.kind === 'free') who = 'Free';
    else if (c.kind === 'off') who = 'Not in use';
    else if (c.kind === 'horse') { who = c.horse.name; sub = c.horse.owner ? `Boarder, ${c.horse.owner}` : 'Boarder'; }
    else {
      who = whoIn(c.stay, s.id);
      sub = c.kind === 'ours' ? 'Ours, can move' : c.kind === 'monthly' ? (c.stay.to ? `Monthly until ${short(c.stay.to)}` : 'Monthly') : `Nightly, leaves ${short(c.stay.to)}`;
      if (c.stay.name && c.stay.name !== who) sub += `, ${c.stay.name}`;
    }
    return `<button type="button" class="stall-tile is-${c.kind}" data-stall="${s.id}" ${s.status !== 'available' ? 'disabled' : ''} aria-label="${esc(`${label(s)}: ${who}${sub ? `, ${sub}` : ''}`)}">
      <span class="stall-tile__num">${s.group === 'main' ? s.number : `O${s.number}`}</span>
      <span class="stall-tile__who">${esc(who)}</span>
      ${sub ? `<span class="stall-tile__sub">${esc(sub)}</span>` : ''}
      ${tags.length ? `<span class="stall-tile__tags">${tags.map(esc).join(' · ')}</span>` : ''}
      ${c.move ? `<span class="stall-tile__warn">Move our horse out (${esc(whoIn(c.move, s.id))})</span>` : ''}
    </button>`;
  }

  // The barn the way it is numbered: left side 20 (top) to 11, right side 10 (top) to 1, the aisle between
  function barn(day) {
    const m = (n) => byId('M' + n);
    let rows = '';
    for (let pos = 10; pos >= 1; pos--) rows += `${m(pos + 10) ? tile(m(pos + 10), day) : '<span></span>'}<span class="barn__aisle" aria-hidden="true"></span>${m(pos) ? tile(m(pos), day) : '<span></span>'}`;
    const outdoor = state.data.stalls.filter((s) => s.group === 'outdoor').sort(order);
    return `<div class="barn" role="group" aria-label="Main barn">
        <span class="barn__side">Left side</span><span class="barn__aisle barn__aisle--head">Aisle</span><span class="barn__side">Right side</span>
        ${rows}
        <span></span><span class="barn__aisle barn__aisle--foot">Barn doors</span><span></span>
      </div>
      ${outdoor.length ? `<h3 class="board-sub">Outdoor stalls</h3><div class="outdoor">${outdoor.map((s) => tile(s, day)).join('')}</div>` : ''}`;
  }

  function legend() {
    return `<p class="board-legend">${['free', 'monthly', 'nightly', 'ours', 'off'].map((k) => `<span><i class="sw is-${k}"></i>${KIND[k]}</span>`).join('')}</p>`;
  }

  function calendar() {
    const d = state.data;
    const days = Array.from({ length: DAYS }, (_, i) => addDays(state.day, i));
    const stalls = d.stalls.slice().sort(order);
    const head = `<tr><th scope="col">Stall</th>${days.map((x) => `<th scope="col" class="${x === d.today ? 'is-today' : ''}"><small>${weekday(x)}</small>${short(x)}</th>`).join('')}</tr>`;
    const body = stalls.map((s) => {
      let prev = null;
      return `<tr><th scope="row">${esc(label(s))}${s.ponyOnly ? ' <small>pony</small>' : ''}</th>${days.map((x) => {
        const c = cell(s, x);
        const key = c.stay ? c.stay.id : c.horse ? c.horse.id : c.kind;
        const start = key !== prev;
        prev = key;
        const name = c.stay ? whoIn(c.stay, s.id) : c.horse ? c.horse.name : '';
        const title = `${label(s)}, ${fmtDay(x)}: ${name || KIND[c.kind]}${c.move ? ' (move our horse out)' : ''}`;
        return `<td class="cal is-${c.kind}${start ? ' is-start' : ''}${c.move ? ' is-move' : ''}" ${c.kind === 'off' ? '' : `data-cell="${s.id}" data-day="${x}"`} title="${esc(title)}">${start && name ? `<span>${esc(name)}</span>` : ''}</td>`;
      }).join('')}</tr>`;
    }).join('');
    return `<div class="cal-wrap"><table class="cal-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- assistant
  function assistantPanel() {
    return `<section class="panel board-ai">
      <h2>Stall assistant</h2>
      <p class="muted">Tell it who&rsquo;s coming. It books the stalls it picks and keeps horses that come together side by side. You can undo right here.</p>
      ${state.chat.length ? `<div class="ai-log">${state.chat.map((m) => `<div class="ai-msg ai-msg--${m.role}"><p>${esc(m.text).replace(/\n/g, '<br>')}</p>
        ${m.stays && m.stays.length ? `<div class="btn-row">${m.undone ? '<span class="muted">Undone</span>' : `<button class="btn btn--sm btn--ghost" type="button" data-undo="${m.stays.map((x) => x.id).join(',')}">Undo ${m.stays.length === 1 ? 'this booking' : 'these bookings'}</button>`}</div>` : ''}</div>`).join('')}</div>` : ''}
      <form id="ai-form" class="ai-form" novalidate>
        <textarea name="m" rows="2" aria-label="Message for the stall assistant" placeholder="I have 5 horses coming in Nov 15 - Nov 17. What stalls can I put them in?"></textarea>
        <button class="btn btn--red" type="submit">Ask</button>
      </form>
      <p class="inline-error" id="ai-err" role="alert"></p>
    </section>`;
  }

  async function ask(form) {
    const text = form.m.value.trim();
    if (!text) return;
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Thinking…';
    $('#ai-err').textContent = '';
    try {
      const history = state.chat.map((m) => ({ role: m.role, text: m.text }));
      const r = await api('POST', '/admin/stays/ai', { message: text, history });
      state.chat.push({ role: 'user', text }, { role: 'assistant', text: r.reply, stays: r.stays });
      await load();
      draw();
      root.querySelector('#ai-form textarea').focus();
    } catch (ex) {
      $('#ai-err').textContent = ex.message;
      btn.disabled = false; btn.textContent = 'Ask';
    }
  }

  // ---------------------------------------------------------------- find stalls (works without the assistant)
  function finderPanel(open) {
    const f = state.finder || { count: 1, ponies: 0, kind: 'nightly', from: state.day, to: addDays(state.day, 1) };
    return `<details class="panel board-find"${open || state.found ? ' open' : ''}>
      <summary><h2>Find stalls${state.data.ai ? ' yourself' : ''}</h2></summary>
      <form id="find-form" class="find-grid" novalidate>
        <div class="field"><label for="f-n">Horses</label><input id="f-n" name="count" type="number" min="1" max="20" value="${f.count}"></div>
        <div class="field"><label for="f-p">Ponies among them</label><input id="f-p" name="ponies" type="number" min="0" max="20" value="${f.ponies}"></div>
        <div class="field"><label for="f-k">Stay</label><select id="f-k" name="kind"><option value="nightly"${f.kind === 'nightly' ? ' selected' : ''}>Nightly</option><option value="monthly"${f.kind === 'monthly' ? ' selected' : ''}>Monthly</option></select></div>
        <div class="field"><label for="f-f">Arrives</label><input id="f-f" name="from" type="date" value="${f.from}"></div>
        <div class="field"><label for="f-t">Leaves</label><input id="f-t" name="to" type="date" value="${f.to || ''}"><small class="muted">Monthly: leave empty if there&rsquo;s no end date</small></div>
        <div class="form-actions"><button class="btn btn--red btn--sm" type="submit">Find stalls</button></div>
      </form>
      <p class="inline-error" id="find-err" role="alert"></p>
      ${state.found ? (state.found.options.length ? `<div class="cards">${state.found.options.map((o, i) => `<article class="card find-opt">
          <div class="card__top"><h3>${i === 0 ? 'Best: ' : ''}${esc(o.note[0].toUpperCase() + o.note.slice(1))}</h3></div>
          ${o.ours.length ? `<p class="flag">Uses ${plural(o.ours.length, 'stall', 'stalls')} with our horses: ${o.ours.map((id) => esc(label(byId(id)))).join(', ')}. They&rsquo;d move to the other ranch.</p>` : '<p class="muted">All free, nobody has to move.</p>'}
          <div class="btn-row"><button class="btn btn--sm ${i === 0 ? 'btn--red' : ''}" type="button" data-book="${i}">Book these</button></div></article>`).join('')}</div>`
        : `<div class="empty-box"><p>Not enough room for ${plural(state.found.count, 'horse', 'horses')} on those dates. ${state.found.free} free, ${state.found.ours} with our horses.</p></div>`) : ''}
    </details>`;
  }

  async function find(form) {
    const f = Object.fromEntries(new FormData(form));
    state.finder = f;
    $('#find-err').textContent = '';
    try {
      const r = await api('POST', '/admin/stays/plan', { count: +f.count, ponies: +f.ponies || 0, from: f.from, to: f.to || null });
      state.found = { ...r, count: +f.count };
      draw();
    } catch (ex) { $('#find-err').textContent = ex.message; }
  }

  // ---------------------------------------------------------------- stall details and the add / edit form
  function dialog(html, wire) {
    let dlg = document.querySelector('dialog.board-dlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'board-dlg';
      dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<div class="board-dlg__body"><button type="button" class="board-dlg__x" data-close aria-label="Close">&times;</button>${html}</div>`;
    if (!dlg.open) dlg.showModal();
    wire(dlg);
    return dlg;
  }

  function openStall(id, day) {
    const s = byId(id);
    const d = state.data;
    const stays = d.stays.filter((x) => x.stallIds.includes(id)).sort((a, b) => a.from.localeCompare(b.from));
    const horse = d.horses.find((h) => h.stallId === id);
    const c = cell(s, day);
    const card = (x) => `<article class="card stay-card is-${x.ours ? 'ours' : x.kind}">
      <div class="card__top"><h3>${esc(whoIn(x, id))}</h3><span class="status ${x.ours ? '' : 'status--confirmed'}">${x.ours ? 'Ours, can move' : x.kind === 'monthly' ? 'Monthly' : 'Nightly'}</span><span class="muted">${esc(x.ref)}</span></div>
      <dl><dt>Dates</dt><dd>${esc(fmtDay(x.from))} to ${x.to ? esc(fmtDay(x.to)) : 'no end date'}${x.nights ? `, ${plural(x.nights, 'night', 'nights')}` : ''}</dd>
        ${x.stallIds.length > 1 ? `<dt>Together with</dt><dd>${x.stallIds.filter((o) => o !== id).map((o) => esc(`${label(byId(o))}${horseIn(x, o) ? ` (${horseIn(x, o)})` : ''}`)).join(', ')}</dd>` : ''}
        ${x.name ? `<dt>Owner</dt><dd>${esc(x.name)}</dd>` : ''}
        ${x.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(x.phone)}">${esc(x.phone)}</a></dd>` : ''}
        ${x.notes ? `<dt>Notes</dt><dd>${esc(x.notes)}</dd>` : ''}
        <dt>Added by</dt><dd>${esc(x.source === 'web' ? 'Website request' : x.source === 'ai' ? `Stall assistant, for ${x.createdBy}` : x.createdBy || 'The team')}</dd></dl>
      ${x.source === 'web' ? '<p class="muted">From the website. Change it in <a class="textlink" href="#/bookings">Bookings</a>.</p>' : `<div class="btn-row">
        <button class="btn btn--sm btn--red" type="button" data-edit="${x.id}">Edit</button>
        ${!x.to || x.to > addDays(day, 1) ? `<button class="btn btn--sm btn--ghost" type="button" data-end="${x.id}">Moves out ${esc(short(day > x.from ? day : addDays(x.from, 1)))}</button>` : ''}
        <button class="btn btn--sm btn--ghost btn--danger" type="button" data-remove="${x.id}">Remove</button></div>`}
    </article>`;
    dialog(`<h2>${esc(label(s))}${s.ponyOnly ? ' <small class="muted">ponies only</small>' : ''}</h2>
      <p class="muted">${esc(fmtDay(day))}: ${esc(c.kind === 'free' ? 'free' : c.kind === 'horse' ? `${c.horse.name} (Horses tab)` : whoIn(c.stay, id))}${s.size ? ` &middot; ${esc(s.size)}` : ''}</p>
      ${horse ? `<p class="flag">${esc(horse.name)}${horse.owner ? ` (${esc(horse.owner)})` : ''} is assigned to this stall in <a class="textlink" href="#/horses">Horses</a>, so it stays taken until they leave.</p>` : ''}
      ${stays.length ? stays.map(card).join('') : '<p>Nothing booked here in the next two weeks.</p>'}
      ${c.kind === 'free' || c.kind === 'ours' || (c.stay && c.stay.to) ? `<div class="btn-row" style="margin-top:14px"><button class="btn btn--red" type="button" data-add>Add a horse to this stall</button></div>` : ''}
      <p class="inline-error" data-err></p>`, (dlg) => {
      dlg.onclick = async (e) => {
        if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
        const err = dlg.querySelector('[data-err]');
        if (e.target.closest('[data-add]')) {
          const free = c.kind === 'free' || c.kind === 'ours' ? day : c.stay.to;
          return editor({ stallIds: [id], from: free, kind: 'monthly', to: null });
        }
        const ed = e.target.closest('[data-edit]');
        if (ed) return editor(d.stays.find((x) => x.id === ed.dataset.edit));
        const end = e.target.closest('[data-end]');
        if (end) {
          const x = d.stays.find((y) => y.id === end.dataset.end);
          const out = day > x.from ? day : addDays(x.from, 1);
          if (!confirm(`${whoIn(x, id)}${x.stallIds.length > 1 ? ` and the rest of the group (${x.stallIds.length} stalls)` : ''} moves out on ${fmtDay(out)}? The stall is free from that day.`)) return;
          try { await api('PATCH', `/admin/stays/${x.id}`, { to: out }); dlg.close(); toast('Done. The stall opens up that day.'); refresh(); } catch (ex) { err.textContent = ex.message; }
          return;
        }
        const rm = e.target.closest('[data-remove]');
        if (rm) {
          const x = d.stays.find((y) => y.id === rm.dataset.remove);
          if (!confirm(`Remove ${x.ref}${x.stallIds.length > 1 ? `, all ${x.stallIds.length} stalls` : ''}? Use this for mistakes; when a horse leaves, use "Moves out".`)) return;
          try { await api('DELETE', `/admin/stays/${x.id}`); dlg.close(); toast('Removed'); refresh(); } catch (ex) { err.textContent = ex.message; }
        }
      };
    });
  }

  // One form for adding and editing: one row per horse (stall, name, pony), then the stay
  function editor(x) {
    const editing = !!x.id;
    const stalls = state.data.stalls.filter((s) => s.status === 'available').sort(order);
    const rowsOf = x.stallIds.map((id, i) => ({ stallId: id, name: (x.horses || [])[i] || '', pony: !!(x.ponies || [])[i] }));
    const row = (r) => `<div class="horse-row">
        <select name="stall" aria-label="Stall">${stalls.map((s) => `<option value="${s.id}"${s.id === r.stallId ? ' selected' : ''}>${esc(label(s))}${s.ponyOnly ? ' (ponies)' : ''}</option>`).join('')}</select>
        <input name="horse" value="${esc(r.name)}" placeholder="Horse name" aria-label="Horse name" maxlength="80">
        <label class="choice"><input type="checkbox" name="pony"${r.pony ? ' checked' : ''}><span>Pony</span></label>
        <button type="button" class="btn btn--sm btn--ghost" data-del-row aria-label="Remove this horse">&times;</button></div>`;
    dialog(`<h2>${editing ? `Edit ${esc(x.ref)}` : 'Add horses to stalls'}</h2>
      <form class="stack" id="stay-form" novalidate>
        <div class="horse-rows"><span class="field-label">Horses</span><div id="rows">${rowsOf.map(row).join('')}</div>
          <button type="button" class="btn btn--sm btn--ghost" data-add-row style="justify-self:start">+ Another horse</button></div>
        <div class="seg" role="radiogroup" aria-label="Kind of stay">
          <label class="choice"><input type="radio" name="kind" value="monthly"${x.kind === 'monthly' ? ' checked' : ''}><span>Monthly boarder</span></label>
          <label class="choice"><input type="radio" name="kind" value="nightly"${x.kind !== 'monthly' ? ' checked' : ''}><span>Nightly</span></label></div>
        <div class="form-grid">
          <div class="field"><label for="s-from">Arrives</label><input id="s-from" name="from" type="date" value="${esc(x.from || state.day)}"></div>
          <div class="field"><label for="s-to">Leaves</label><input id="s-to" name="to" type="date" value="${esc(x.to || '')}"><small class="muted" id="s-to-hint">${x.kind === 'monthly' ? 'Leave empty while they&rsquo;re boarding' : 'The morning they leave'}</small></div>
          <div class="field"><label for="s-name">Owner</label><input id="s-name" name="name" value="${esc(x.name || '')}" maxlength="100"></div>
          <div class="field"><label for="s-phone">Phone</label><input id="s-phone" name="phone" type="tel" value="${esc(x.phone || '')}" maxlength="40"></div>
          <div class="field full"><label for="s-notes">Notes</label><textarea id="s-notes" name="notes" rows="2" maxlength="1000">${esc(x.notes || '')}</textarea></div>
        </div>
        <label class="choice"><input type="checkbox" name="ours"${x.ours ? ' checked' : ''}><span>One of our own horses (the stall can still be rented; the horse moves to the other ranch)</span></label>
        <p class="inline-error" data-err role="alert"></p>
        <div class="form-actions"><button class="btn btn--red" type="submit">${editing ? 'Save' : 'Add to the board'}</button><button class="btn btn--ghost" type="button" data-close>Cancel</button></div>
      </form>`, (dlg) => {
      const form = dlg.querySelector('#stay-form');
      const el = form.elements;
      dlg.onclick = (e) => {
        if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
        if (e.target.closest('[data-add-row]')) {
          const used = [...form.querySelectorAll('[name=stall]')].map((sel) => sel.value);
          const next = stalls.find((s) => !used.includes(s.id) && !s.ponyOnly && cell(s, el.from.value || state.day).kind === 'free') || stalls[0];
          form.querySelector('#rows').insertAdjacentHTML('beforeend', row({ stallId: next.id, name: '', pony: false }));
        }
        const del = e.target.closest('[data-del-row]');
        if (del && form.querySelectorAll('.horse-row').length > 1) del.closest('.horse-row').remove();
      };
      form.onchange = (e) => { if (e.target.name === 'kind') dlg.querySelector('#s-to-hint').textContent = e.target.value === 'monthly' ? 'Leave empty while they’re boarding' : 'The morning they leave'; };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const rows = [...form.querySelectorAll('.horse-row')];
        const body = {
          stallIds: rows.map((r) => r.querySelector('[name=stall]').value),
          horses: rows.map((r) => r.querySelector('[name=horse]').value),
          ponies: rows.map((r) => r.querySelector('[name=pony]').checked),
          kind: el.kind.value, from: el.from.value, to: el.to.value || null,
          name: el.name.value, phone: el.phone.value, notes: el.notes.value, ours: el.ours.checked,
        };
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          const r = await api(editing ? 'PATCH' : 'POST', editing ? `/admin/stays/${x.id}` : '/admin/stays', body);
          dlg.close();
          toast(r.warnings && r.warnings.length ? r.warnings.join(' ') : editing ? 'Saved' : `${r.stay.ref} added to the board`);
          state.found = null;
          refresh();
        } catch (ex) { form.querySelector('[data-err]').textContent = ex.message; btn.disabled = false; }
      };
    });
  }

  // ---------------------------------------------------------------- events
  async function refresh() { await load(); draw(); }
  function go(v) {
    state.day = v === 'today' ? state.data.today : /^-?\d+$/.test(v) ? addDays(state.day, +v) : v;
    refresh().catch((ex) => toast(ex.message));
  }

  async function onClick(e) {
    const g = e.target.closest('[data-go]');
    if (g) return go(g.dataset.go);
    const t = e.target.closest('[data-stall]');
    if (t) return openStall(t.dataset.stall, state.day);
    const c = e.target.closest('[data-cell]');
    if (c) return openStall(c.dataset.cell, c.dataset.day);
    const b = e.target.closest('[data-book]');
    if (b) {
      const o = state.found.options[+b.dataset.book];
      const f = state.finder;
      const ponies = +f.ponies || 0;
      return editor({ stallIds: o.stallIds, horses: [], ponies: o.stallIds.map((_, i) => i < ponies), kind: f.kind, from: f.from, to: f.to || null });
    }
    const u = e.target.closest('[data-undo]');
    if (u) {
      if (!confirm('Undo what the assistant booked here? Those stalls open up again.')) return;
      try {
        for (const id of u.dataset.undo.split(',')) await api('DELETE', `/admin/stays/${id}`).catch((ex) => { if (ex.status !== 404) throw ex; });
        const m = state.chat.find((x) => x.stays && x.stays.map((y) => y.id).join(',') === u.dataset.undo);
        if (m) { m.undone = true; m.text += '\n(Undone.)'; }
        toast('Undone');
        refresh();
      } catch (ex) { toast(ex.message); }
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (e.target.id === 'ai-form') return ask(e.target);
    if (e.target.id === 'find-form') return find(e.target);
  }

  const $ = (s) => root.querySelector(s);
  return { view };
})();
