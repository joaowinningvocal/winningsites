/* Pricing board for the staff app (#/pricing)
   - The barn on the map, every stall colored by its price (light = lower, red = higher)
   - Click a stall, Shift-click to add more, or drag a box to grab a group
   - Set an exact price, nudge by $ or %, or clear; every change can be undone
   - A spreadsheet of every stall for quick one-by-one edits */
window.WRPricing = (() => {
  const { api, esc, toast, timeAgo, money } = window.WR;
  const VIEW = { x: 300, y: 56, w: 975, h: 700 }; // part of the map with both barns
  const LOW = [236, 214, 170];  // sand
  const HIGH = [167, 27, 33];   // ranch red
  const LABEL = { nightly: 'per night', monthly: 'per month' };
  const NAME = { nightly: 'nightly price', monthly: 'monthly price' };

  const state = {
    field: localStorage.getItem('wr-price-field') === 'monthly' ? 'monthly' : 'nightly',
    selected: new Set(),
    stalls: [], settings: {}, map: { src: 'img/ranch-map.jpg', width: 1536, height: 1024 }, log: [],
  };
  let root = null;

  const byId = (id) => state.stalls.find((s) => s.id === id);
  const inUse = (s) => s.status === 'available';
  const order = (a, b) => (a.group === b.group ? a.number - b.number : a.group === 'main' ? -1 : 1);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  async function load() {
    const [d, l] = await Promise.all([api('GET', '/admin/stalls'), api('GET', '/admin/prices/log')]);
    state.stalls = d.stalls.sort(order);
    state.settings = d.settings || {};
    if (d.map) state.map = d.map;
    state.log = l.log || [];
    for (const id of [...state.selected]) if (!byId(id)) state.selected.delete(id);
  }

  function scale() {
    const v = state.stalls.filter(inUse).map((s) => s[state.field]).filter((x) => x != null);
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
  }
  function colorFor(v, sc) {
    if (v == null || !sc) return null;
    const t = sc.max === sc.min ? 0.55 : (v - sc.min) / (sc.max - sc.min);
    const c = LOW.map((l, i) => Math.round(l + (HIGH[i] - l) * t));
    return { fill: `rgb(${c.join(',')})`, text: t > 0.45 ? '#fff' : '#0E0E0E' };
  }
  const rangeText = (vals) => {
    const v = vals.filter((x) => x != null);
    if (!v.length) return 'no price yet';
    const lo = Math.min(...v), hi = Math.max(...v);
    return lo === hi ? money(lo) : `${money(lo)} to ${money(hi)}`;
  };

  // ------------------------------------------------------------------ view
  async function view(container) {
    root = container;
    root.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
    await load();
    root.innerHTML = `
      <div class="wrap pricing">
        <div class="pricing__head">
          <div>
            <h1>Pricing board</h1>
            <p class="muted">Click a stall to price it. Shift-click, or drag a box on the map, to pick several at once.</p>
          </div>
          <div class="seg" role="group" aria-label="Which price">
            <button type="button" data-field="nightly">Per night</button>
            <button type="button" data-field="monthly">Per month</button>
          </div>
        </div>
        <div class="kpis" id="pb-kpis"></div>
        <div class="pricing__grid">
          <section class="board" aria-label="Stalls on the map">
            <div class="board__tools">
              <div class="quick" role="group" aria-label="Quick picks">
                <span class="muted">Pick</span>
                <button type="button" class="chip" data-pick="all">All in use</button>
                <button type="button" class="chip" data-pick="main">Main barn</button>
                <button type="button" class="chip" data-pick="outdoor">Outdoor</button>
                <button type="button" class="chip" data-pick="unpriced">No price yet</button>
                <button type="button" class="chip" data-pick="none">Clear</button>
              </div>
              <div class="legend-bar" id="pb-legend"></div>
            </div>
            <div class="board__map"><svg id="pb-svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet"></svg></div>
          </section>
          <aside class="editor" id="pb-editor" aria-live="polite"></aside>
        </div>
        <section class="panel">
          <h2>Every stall</h2>
          <p class="muted">Type a price and press Enter. Leave it empty to clear it. Click a stall name to pick it on the map.</p>
          <div class="sheet-wrap"><table class="price-sheet" id="pb-sheet"></table></div>
        </section>
        <div class="pricing__bottom">
          <form class="panel" id="pb-site" novalidate></form>
          <section class="panel" id="pb-history"></section>
        </div>
      </div>`;
    bind();
    paint();
  }

  function paint(opts = {}) {
    root.querySelectorAll('[data-field]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.field === state.field)));
    paintKpis();
    paintLegend();
    paintMap();
    paintEditor(opts.keepEditor);
    if (opts.table !== false) paintSheet();
    paintSite();
    paintHistory();
  }

  // ------------------------------------------------------------------ KPIs
  function paintKpis() {
    const used = state.stalls.filter(inUse);
    const priced = used.filter((s) => s[state.field] != null);
    const vals = priced.map((s) => s[state.field]);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const boarded = state.stalls.filter((s) => s.horse);
    const monthlyIn = boarded.filter((s) => s.monthly != null).reduce((a, s) => a + s.monthly, 0);
    const missing = boarded.filter((s) => s.monthly == null).length;
    root.querySelector('#pb-kpis').innerHTML = `
      <div class="kpi"><span>Priced ${LABEL[state.field]}</span><strong>${priced.length} of ${used.length}</strong><small>stalls in use</small></div>
      <div class="kpi"><span>Range</span><strong>${vals.length ? esc(rangeText(vals)) : 'None yet'}</strong><small>${LABEL[state.field]}</small></div>
      <div class="kpi"><span>Average</span><strong>${avg != null ? money(Math.round(avg * 100) / 100) : 'None yet'}</strong><small>${LABEL[state.field]}</small></div>
      <div class="kpi kpi--dark"><span>From boarders now</span><strong>${money(monthlyIn) || '$0'}</strong><small>${plural(boarded.length, 'horse', 'horses')} in stalls${missing ? `, ${missing} without a monthly price` : ''}</small></div>`;
  }

  function paintLegend() {
    const sc = scale();
    root.querySelector('#pb-legend').innerHTML = sc
      ? `<span>${money(sc.min)}</span><i aria-hidden="true"></i><span>${money(sc.max)}</span><b class="legend-none" aria-hidden="true"></b><span>No price</span>`
      : '<span class="muted">No prices yet. Pick stalls and set one.</span>';
  }

  // ------------------------------------------------------------------ map
  function paintMap() {
    const sc = scale();
    const svg = root.querySelector('#pb-svg');
    let html = `<defs>
        <pattern id="pb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f6f0e5"/><rect width="3" height="8" fill="#d9cdb6"/></pattern>
        <filter id="pb-lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity=".55"/></filter>
      </defs>
      <image href="/${esc(state.map.src)}" x="0" y="0" width="${state.map.width}" height="${state.map.height}"/>
      <rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}" fill="rgba(14,14,14,.42)" pointer-events="none"/>`;
    for (const s of state.stalls) {
      if (!s.shape) continue;
      const { x, y, w, h } = s.shape;
      const sel = state.selected.has(s.id);
      const v = s[state.field];
      const off = !inUse(s);
      const col = off ? { fill: '#4a4a4a', text: '#d8d8d8' } : colorFor(v, sc) || { fill: 'url(#pb-hatch)', text: '#0E0E0E' };
      const label = off ? 'Off' : v == null ? '—' : money(v);
      const fs = state.field === 'monthly' && v != null && v >= 1000 ? 13 : 15;
      html += `<g class="pb-stall${sel ? ' is-sel' : ''}${off ? ' is-off' : ''}" data-id="${s.id}" tabindex="0" role="button" aria-pressed="${sel}"
          aria-label="${esc(s.name)}, ${off ? 'not in use' : v == null ? 'no price' : money(v) + ' ' + LABEL[state.field]}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${col.fill}"${sel ? ' filter="url(#pb-lift)"' : ''}/>
        <text class="pb-num" x="${x + 5}" y="${y + 11}" fill="${col.text}">${s.number}</text>
        <text class="pb-price" x="${x + w / 2}" y="${y + h / 2 + 6}" fill="${col.text}" font-size="${fs}">${esc(label)}</text>
        ${s.horse ? `<circle cx="${x + w - 7}" cy="${y + 8}" r="3.5" fill="${col.text}"><title>${esc(s.horse.name)} lives here</title></circle>` : ''}
      </g>`;
    }
    html += '<rect id="pb-lasso" class="pb-lasso" x="0" y="0" width="0" height="0" visibility="hidden"/>';
    svg.innerHTML = html;
  }

  // ------------------------------------------------------------------ editor
  function paintEditor(keep) {
    const box = root.querySelector('#pb-editor');
    const ids = [...state.selected].sort((a, b) => order(byId(a), byId(b)));
    if (!ids.length) {
      box.innerHTML = `
        <h2>Pick stalls to price</h2>
        <ul class="tips">
          <li><strong>Click</strong> a stall on the map or a name in the table.</li>
          <li><strong>Shift-click</strong> to add more stalls.</li>
          <li><strong>Drag a box</strong> on the map to grab a whole row.</li>
          <li>Or use the quick picks above the map.</li>
        </ul>
        <p class="muted">Rates include full care. Dots on the map mark stalls with a horse in them.</p>`;
      return;
    }
    const prevVal = keep ? (root.querySelector('#pb-val') || {}).value : '';
    const stalls = ids.map(byId);
    const one = stalls.length === 1 ? stalls[0] : null;
    const shown = stalls.slice(0, 10);
    box.innerHTML = `
      <h2>${one ? esc(one.name) : `${stalls.length} stalls`}</h2>
      ${one ? '' : `<ul class="sel-chips">${shown.map((s) => `<li>${esc(s.name.replace('Barn stall', 'Barn').replace('Outdoor stall', 'Outdoor'))}<button type="button" data-unpick="${s.id}" aria-label="Remove ${esc(s.name)}">&times;</button></li>`).join('')}${stalls.length > shown.length ? `<li class="more">+${stalls.length - shown.length} more</li>` : ''}</ul>`}
      <p class="now">Now: <strong>${esc(rangeText(stalls.map((s) => s[state.field])))}</strong> ${LABEL[state.field]}</p>
      <form id="pb-set" class="set-form" novalidate>
        <label for="pb-val">New ${NAME[state.field]}</label>
        <div class="money-input"><span>$</span><input id="pb-val" inputmode="decimal" autocomplete="off" placeholder="${state.field === 'monthly' ? '750' : '45'}" value="${esc(prevVal || '')}"></div>
        <button class="btn btn--red" type="submit">Set for ${plural(stalls.length, 'stall', 'stalls')}</button>
      </form>
      <div class="nudges" role="group" aria-label="Adjust current prices">
        <span class="muted">Adjust</span>
        ${(state.field === 'monthly' ? [-50, -25, 25, 50] : [-10, -5, 5, 10]).map((d) => `<button type="button" class="chip" data-op="add" data-val="${d}">${d > 0 ? '+' : '−'}$${Math.abs(d)}</button>`).join('')}
        ${[-5, 5, 10].map((d) => `<button type="button" class="chip" data-op="percent" data-val="${d}">${d > 0 ? '+' : '−'}${Math.abs(d)}%</button>`).join('')}
      </div>
      <ol class="preview" id="pb-preview" hidden></ol>
      ${one ? `<dl class="one-facts"><dt>Status</dt><dd>${inUse(one) ? 'In use' : 'Not in use'}</dd><dt>Size</dt><dd>${esc(one.size || 'Not set')}</dd><dt>Horse</dt><dd>${one.horse ? esc(one.horse.name) : 'None'}</dd>
        <dt>Other price</dt><dd>${one[state.field === 'nightly' ? 'monthly' : 'nightly'] != null ? money(one[state.field === 'nightly' ? 'monthly' : 'nightly']) + ' ' + LABEL[state.field === 'nightly' ? 'monthly' : 'nightly'] : 'Not set'}</dd></dl>
        <p><a class="textlink" href="#/stalls" data-stall-link="${one.id}">Photos, size and description</a></p>` : ''}
      <button type="button" class="linklike" data-op="clear">Clear the ${NAME[state.field]} on ${one ? 'this stall' : 'these stalls'}</button>`;
    if (prevVal) drawPreview();
  }

  function drawPreview() {
    const input = root.querySelector('#pb-val');
    const list = root.querySelector('#pb-preview');
    if (!input || !list) return;
    const v = Number(input.value.replace(/[$,\s]/g, ''));
    if (input.value.trim() === '' || !Number.isFinite(v)) { list.hidden = true; return; }
    const rows = [...state.selected].map(byId).sort(order).map((s) => {
      const cur = s[state.field];
      const diff = cur == null ? '' : v > cur ? 'up' : v < cur ? 'down' : 'same';
      return `<li class="${diff}"><span>${esc(s.name)}</span><span>${cur == null ? 'none' : money(cur)} <b aria-hidden="true">&rarr;</b> ${money(v)}</span></li>`;
    });
    list.innerHTML = rows.join('');
    list.hidden = false;
  }

  // ------------------------------------------------------------------ sheet
  function paintSheet() {
    const t = root.querySelector('#pb-sheet');
    t.innerHTML = `
      <thead><tr><th scope="col">Stall</th><th scope="col">Status</th><th scope="col">Per night</th><th scope="col">Per month</th><th scope="col" class="hide-sm">Size</th><th scope="col" class="hide-sm">Horse</th></tr></thead>
      <tbody>${state.stalls.map((s) => `
        <tr data-id="${s.id}" class="${state.selected.has(s.id) ? 'is-sel' : ''}${inUse(s) ? '' : ' is-off'}">
          <th scope="row"><button type="button" class="rowpick" data-row="${s.id}" aria-pressed="${state.selected.has(s.id)}">${esc(s.name)}</button>${s.smaller ? ' <small class="muted">smaller</small>' : ''}</th>
          <td>${inUse(s) ? 'In use' : 'Not in use'}</td>
          ${['nightly', 'monthly'].map((f) => `<td><div class="money-input money-input--sm"><span>$</span><input data-cell="${s.id}" data-f="${f}" inputmode="decimal" autocomplete="off" value="${s[f] != null ? s[f] : ''}" data-orig="${s[f] != null ? s[f] : ''}" aria-label="${esc(s.name)} ${LABEL[f]}"></div></td>`).join('')}
          <td class="hide-sm">${esc(s.size || '')}</td>
          <td class="hide-sm">${s.horse ? esc(s.horse.name) : ''}</td>
        </tr>`).join('')}</tbody>`;
  }

  // ------------------------------------------------------------------ website settings + history
  function paintSite() {
    const f = root.querySelector('#pb-site');
    const st = state.settings;
    if (f.contains(document.activeElement)) return; // don't wipe what someone is typing
    f.innerHTML = `
      <h2>On the website</h2>
      <p class="muted">The monthly range shows on stalls that don&rsquo;t have a monthly price of their own.</p>
      <div class="form-grid">
        <div class="field"><label for="pb-min">Monthly from ($)</label><input id="pb-min" name="monthlyMin" inputmode="decimal" value="${st.monthlyMin ?? ''}"></div>
        <div class="field"><label for="pb-max">Monthly up to ($)</label><input id="pb-max" name="monthlyMax" inputmode="decimal" value="${st.monthlyMax ?? ''}"></div>
        <div class="field full"><label for="pb-park">RV or trailer spot, per night ($)</label><input id="pb-park" name="parkingNightly" inputmode="decimal" value="${st.parkingNightly ?? ''}"></div>
        <p class="inline-error full" data-err></p>
        <div class="form-actions full"><button class="btn btn--sm" type="submit">Save</button></div>
      </div>`;
  }

  function describe(e, withAuthor = true) {
    const n = Object.keys(e.after).length;
    const what = NAME[e.field];
    const verb = e.op === 'set' ? `set the ${what} to ${money(e.value)}`
      : e.op === 'clear' ? `cleared the ${what}`
        : e.op === 'add' ? `${e.value > 0 ? 'raised' : 'lowered'} the ${what} by ${money(Math.abs(e.value))}`
          : `${e.value > 0 ? 'raised' : 'lowered'} the ${what} by ${Math.abs(e.value)}%`;
    const text = `${verb} on ${plural(n, 'stall', 'stalls')}`;
    return withAuthor ? `${esc(e.by)} ${text}` : text;
  }

  function paintHistory() {
    const box = root.querySelector('#pb-history');
    const canUndo = state.log.some((e) => !e.undoneAt);
    box.innerHTML = `
      <div class="history__head"><h2>Recent changes</h2><button type="button" class="btn btn--sm" data-undo ${canUndo ? '' : 'disabled'}>Undo last change</button></div>
      ${state.log.length ? `<ol class="history">${state.log.slice(0, 12).map((e) => `
        <li class="${e.undoneAt ? 'is-undone' : ''}"><span>${describe(e)}</span><time title="${esc(new Date(e.at).toLocaleString())}">${esc(timeAgo(e.at))}${e.undoneAt ? ', undone' : ''}</time></li>`).join('')}</ol>`
        : '<p class="muted">Price changes show up here, and the newest one can be undone.</p>'}`;
  }

  // ------------------------------------------------------------------ actions
  async function change(op, value, ids = [...state.selected]) {
    if (!ids.length) return;
    try {
      const res = await api('POST', '/admin/prices', { stallIds: ids, field: state.field, op, value });
      await load();
      paint({ keepEditor: false });
      if (!res.entry) { toast(op === 'add' || op === 'percent' ? 'Nothing changed. Those stalls don’t have a price yet.' : 'Nothing changed.'); return; }
      const skipped = res.skipped ? ` Skipped ${plural(res.skipped, 'stall', 'stalls')} without a price.` : '';
      toast(`${describe(res.entry, false).replace(/^./, (c) => c.toUpperCase())}.${skipped}`, { action: 'Undo', onAction: undo });
    } catch (ex) { toast(ex.message); }
  }

  async function undo() {
    try {
      const { entry } = await api('POST', '/admin/prices/undo');
      await load();
      paint();
      toast(`Undone: ${describe(entry, false)}`);
    } catch (ex) { toast(ex.message); }
  }

  function pick(ids, additive) {
    if (!additive) state.selected.clear();
    ids.forEach((id) => state.selected.add(id));
    paint({ table: true });
  }

  function toggle(id, additive) {
    if (additive) { if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); }
    else if (state.selected.size === 1 && state.selected.has(id)) state.selected.clear();
    else { state.selected.clear(); state.selected.add(id); }
    paint();
  }

  // One cell in the sheet
  async function commitCell(input) {
    const id = input.dataset.cell, f = input.dataset.f;
    const raw = input.value.replace(/[$,\s]/g, '');
    if (raw === input.dataset.orig || input.dataset.busy) return;
    if (raw !== '' && !Number.isFinite(Number(raw))) { input.classList.add('is-bad'); toast('Type a number, like 45 or 750.'); return; }
    input.dataset.busy = '1';
    input.classList.remove('is-bad');
    try {
      const res = await api('POST', '/admin/prices', { stallIds: [id], field: f, op: raw === '' ? 'clear' : 'set', value: raw === '' ? null : Number(raw) });
      const s = byId(id);
      if (res.entry) s[f] = res.entry.after[id];
      input.dataset.orig = s[f] != null ? String(s[f]) : '';
      input.value = input.dataset.orig;
      input.classList.add('is-saved');
      setTimeout(() => input.classList.remove('is-saved'), 1200);
      state.log = (await api('GET', '/admin/prices/log')).log;
      paint({ table: false, keepEditor: true });
    } catch (ex) {
      input.classList.add('is-bad');
      toast(ex.message);
    } finally { delete input.dataset.busy; }
  }

  // SVG point from a pointer event
  function svgPoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function bind() {
    // Listeners live on this render's wrapper, so revisiting the tab never doubles them
    const wrap = root.querySelector('.pricing');
    wrap.addEventListener('click', (e) => {
      const t = e.target;
      const fieldBtn = t.closest('[data-field]');
      if (fieldBtn) { state.field = fieldBtn.dataset.field; localStorage.setItem('wr-price-field', state.field); paint(); return; }
      const pk = t.closest('[data-pick]');
      if (pk) {
        const p = pk.dataset.pick;
        const used = state.stalls.filter(inUse);
        const ids = p === 'all' ? used : p === 'main' ? used.filter((s) => s.group === 'main') : p === 'outdoor' ? used.filter((s) => s.group === 'outdoor') : p === 'unpriced' ? used.filter((s) => s[state.field] == null) : [];
        pick(ids.map((s) => s.id), false);
        return;
      }
      const un = t.closest('[data-unpick]');
      if (un) { state.selected.delete(un.dataset.unpick); paint(); return; }
      const op = t.closest('[data-op]');
      if (op) {
        if (op.dataset.op === 'clear') { if (confirm(`Clear the ${NAME[state.field]} on ${plural(state.selected.size, 'stall', 'stalls')}?`)) change('clear', null); return; }
        change(op.dataset.op, Number(op.dataset.val));
        return;
      }
      if (t.closest('[data-undo]')) { undo(); return; }
      const row = t.closest('[data-row]');
      if (row) { toggle(row.dataset.row, true); return; }
      const link = t.closest('[data-stall-link]');
      if (link) sessionStorage.setItem('wr-open-stall', link.dataset.stallLink);
    });

    wrap.addEventListener('input', (e) => { if (e.target.id === 'pb-val') drawPreview(); });

    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.target.id === 'pb-set') {
        const raw = root.querySelector('#pb-val').value.replace(/[$,\s]/g, '');
        if (raw === '' || !Number.isFinite(Number(raw))) { toast('Type a price first, like 45.'); root.querySelector('#pb-val').focus(); return; }
        change('set', Number(raw));
      }
      if (e.target.id === 'pb-site') {
        const f = e.target;
        try {
          const { settings } = await api('PATCH', '/admin/settings', Object.fromEntries(new FormData(f)));
          state.settings = settings;
          f.querySelector('[data-err]').textContent = '';
          document.activeElement.blur();
          paintSite();
          toast('Saved. The website shows the new range.');
        } catch (ex) { f.querySelector('[data-err]').textContent = ex.message; }
      }
    });

    // Spreadsheet: Enter saves and moves down, arrows move between rows
    wrap.addEventListener('keydown', (e) => {
      const input = e.target.closest && e.target.closest('[data-cell]');
      if (!input) return;
      if (['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        const cells = [...root.querySelectorAll(`[data-f="${input.dataset.f}"]`)];
        const i = cells.indexOf(input);
        const next = cells[e.key === 'ArrowUp' ? i - 1 : i + 1];
        commitCell(input);
        if (next) { next.focus(); next.select(); }
        else input.blur();
      } else if (e.key === 'Escape') { input.value = input.dataset.orig; input.blur(); }
    });
    wrap.addEventListener('focusout', (e) => { if (e.target.matches && e.target.matches('[data-cell]')) commitCell(e.target); });

    // Map: click / shift-click / drag a box
    const svg = root.querySelector('#pb-svg');
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const g = e.target.closest('.pb-stall');
      if (g) {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey || e.pointerType === 'touch';
        toggle(g.dataset.id, additive);
        return;
      }
      if (e.pointerType === 'touch') return; // let the page scroll on phones
      const p = svgPoint(svg, e);
      drag = { x0: p.x, y0: p.y, additive: e.shiftKey || e.metaKey || e.ctrlKey };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = svgPoint(svg, e);
      const r = svg.querySelector('#pb-lasso');
      const x = Math.min(drag.x0, p.x), y = Math.min(drag.y0, p.y), w = Math.abs(p.x - drag.x0), h = Math.abs(p.y - drag.y0);
      Object.assign(drag, { x, y, w, h });
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('visibility', w > 4 || h > 4 ? 'visible' : 'hidden');
    });
    svg.addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.w || (d.w < 6 && d.h < 6)) { if (!d.additive) { state.selected.clear(); paint(); } return; }
      const hit = state.stalls.filter((s) => s.shape && inUse(s) && s.shape.x < d.x + d.w && s.shape.x + s.shape.w > d.x && s.shape.y < d.y + d.h && s.shape.y + s.shape.h > d.y);
      pick(hit.map((s) => s.id), d.additive);
    });
    svg.addEventListener('keydown', (e) => {
      const g = e.target.closest('.pb-stall');
      if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(g.dataset.id, e.shiftKey || true); }
    });
  }

  return { view };
})();
