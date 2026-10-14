(() => {
  const API = '/api/ranch';
  const MAP_W = 1448, MAP_H = 1086;
  const MAP_URL = 'img/ranch-map.jpg';

  // Non-bookable places on the map (hover shows what they are)
  const AREAS = [
    { id: 'main-arena', name: 'Main arena', text: 'The large lit riding arena.', shape: { x: 630, y: 90, w: 735, h: 415 } },
    { id: 'second-arena', name: 'Second arena', text: 'A second lit riding arena.', shape: { x: 62, y: 738, w: 446, h: 238 } },
    { id: 'pen-1', name: 'Round pen 1', text: 'Small round pen for lunging and groundwork.', circle: { cx: 135, cy: 125, r: 84 } },
    { id: 'pen-2', name: 'Round pen 2', text: 'Small round pen for lunging and groundwork.', circle: { cx: 126, cy: 298, r: 86 } },
    { id: 'tack', name: 'Tack rooms', text: 'Storage for saddles and gear.', shape: { x: 58, y: 398, w: 108, h: 124 } },
    { id: 'hay', name: 'Hay storage', text: 'The hay barn.', shape: { x: 58, y: 578, w: 306, h: 92 } },
    { id: 'bath', name: 'Outdoor bathroom', text: 'Restroom for owners and riders.', shape: { x: 1292, y: 688, w: 96, h: 74 } },
  ];

  const STATUS_TEXT = {
    available: (range) => (range ? 'Open for your dates' : 'Open'),
    booked: () => 'Taken for your dates',
    occupied: () => 'Taken by a boarder',
    unavailable: () => 'Not in use right now',
  };

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => (v == null ? null : '$' + (Number.isInteger(v) ? v : v.toFixed(2)));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const nightsBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
  const fmtDay = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;

  const els = {
    from: $('#d-from'), to: $('#d-to'), status: $('#date-status'),
    stage: $('#map-stage'), svg: $('#map-svg'), peek: $('#peek'), list: $('#stall-list'),
    sheet: $('#stall-sheet'), book: $('#book-sheet'),
    tray: $('#tray'), chips: $('#tray-chips'), trayMeta: $('#tray-meta'), trayGo: $('#tray-continue'),
  };

  const state = { stalls: [], settings: {}, range: null, selected: new Set(), peekTimer: 0, slideTimer: 0 };
  const stallById = (id) => state.stalls.find((s) => s.id === id);

  // ------------------------------------------------------------ dates
  const today = ymd(new Date());
  els.from.min = today;
  els.to.min = addDays(today, 1);

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const from = p.get('from'), to = p.get('to');
    if (from && to && from >= today && to > from) { els.from.value = from; els.to.value = to; }
    return p.get('stall');
  }
  function writeUrl() {
    const p = new URLSearchParams(location.search);
    if (state.range) { p.set('from', state.range.from); p.set('to', state.range.to); } else { p.delete('from'); p.delete('to'); }
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }

  function onDates(changed) {
    let from = els.from.value, to = els.to.value;
    if (changed === 'from' && from) {
      els.to.min = addDays(from, 1);
      if (!to || to <= from) { to = addDays(from, 1); els.to.value = to; }
    }
    if (from && to && to > from) {
      state.range = { from, to };
    } else {
      state.range = null;
    }
    writeUrl();
    load();
  }
  els.from.addEventListener('change', () => onDates('from'));
  els.to.addEventListener('change', () => onDates('to'));

  function renderStatus() {
    const st = els.status;
    st.removeAttribute('data-state');
    if (!state.range) { st.textContent = 'Pick dates to see which stalls are open.'; return; }
    const n = nightsBetween(state.range.from, state.range.to);
    const open = state.stalls.filter((s) => s.availability === 'available').length;
    st.textContent = `${fmtDay(state.range.from)} to ${fmtDay(state.range.to)}, ${n} night${n === 1 ? '' : 's'}. ${open} stall${open === 1 ? '' : 's'} open.`;
    if (!open) st.dataset.state = 'warn';
  }

  // ------------------------------------------------------------ data
  async function load() {
    const q = state.range ? `?from=${state.range.from}&to=${state.range.to}` : '';
    try {
      const res = await fetch(API + '/stalls' + q);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      state.stalls = data.stalls;
      state.settings = data.settings || {};
    } catch {
      els.status.dataset.state = 'warn';
      els.status.textContent = 'The stall map didn’t load. Refresh the page, or call (305) 409-9656.';
      return;
    }
    // Drop picks that are no longer open for the new dates
    const dropped = [];
    for (const id of [...state.selected]) {
      const s = stallById(id);
      if (!s || s.availability !== 'available' || !state.range) { state.selected.delete(id); if (s) dropped.push(s.name); }
    }
    renderStatus();
    if (dropped.length && state.range) {
      els.status.dataset.state = 'warn';
      els.status.textContent += ` Removed from your booking: ${dropped.join(', ')} (taken for these dates).`;
    }
    renderMap();
    renderList();
    renderTray();
  }

  // ------------------------------------------------------------ map
  const SVGNS = 'http://www.w3.org/2000/svg';
  function renderMap() {
    els.stage.parentElement.parentElement.classList.toggle('has-range', !!state.range);
    els.svg.classList.toggle('has-range', !!state.range);
    let html = `<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill="rgba(14,14,14,.62)"/><rect width="2.5" height="7" fill="rgba(255,255,255,.18)"/></pattern></defs>`;
    html += '<g class="areas">';
    for (const a of AREAS) {
      const shape = a.circle
        ? `<circle class="hit" cx="${a.circle.cx}" cy="${a.circle.cy}" r="${a.circle.r}"/>`
        : `<rect class="hit" x="${a.shape.x}" y="${a.shape.y}" width="${a.shape.w}" height="${a.shape.h}" rx="6"/>`;
      html += `<g class="area" data-area="${a.id}" tabindex="0" role="img" aria-label="${esc(a.name)}. ${esc(a.text)}">${shape}</g>`;
    }
    html += '</g><g class="stalls">';
    for (const s of state.stalls) {
      const sel = state.selected.has(s.id);
      const { x, y, w, h } = s.shape;
      const label = `${s.name}. ${STATUS_TEXT[s.availability](state.range)}${s.nightly != null ? `. ${money(s.nightly)} per night` : ''}${sel ? '. In your booking' : ''}`;
      html += `<g class="spot is-${s.availability}${sel ? ' is-selected' : ''}" data-id="${s.id}" tabindex="0" role="button" aria-label="${esc(label)}">
        <rect class="hit" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>
        ${sel ? `<g class="badge" transform="translate(${x + w - 9} ${y + 9})"><circle r="9" fill="#CC232A" stroke="#fff" stroke-width="2"/><path d="M-4 0l3 3 5-6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>` : ''}
      </g>`;
    }
    html += '</g>';
    els.svg.innerHTML = html;
  }

  function zoomStyle(cx, cy, boxW, boxH, zoom) {
    const size = MAP_W * zoom;
    const scale = size / MAP_W;
    const px = -(cx * scale - boxW / 2), py = -(cy * scale - boxH / 2);
    return `background-size:${size}px auto;background-position:${px}px ${py}px`;
  }

  function centerOf(item) {
    if (item.circle) return { cx: item.circle.cx, cy: item.circle.cy, w: item.circle.r * 2, h: item.circle.r * 2, x: item.circle.cx - item.circle.r, y: item.circle.cy - item.circle.r };
    const { x, y, w, h } = item.shape;
    return { cx: x + w / 2, cy: y + h / 2, w, h, x, y };
  }

  function showPeek(target) {
    clearTimeout(state.peekTimer);
    clearInterval(state.slideTimer);
    els.svg.querySelectorAll('.is-peek').forEach((n) => n.classList.remove('is-peek'));
    const stall = target.dataset.id ? stallById(target.dataset.id) : null;
    const area = target.dataset.area ? AREAS.find((a) => a.id === target.dataset.area) : null;
    const item = stall || area;
    if (!item) return;
    target.classList.add('is-peek');

    const geo = centerOf(item);
    const boxW = 290, mediaH = 158;
    // Zoom so the stall (or area) fills a good part of the picture
    const zoom = stall ? Math.min(3.2, Math.max(1.8, 150 / geo.h)) : Math.min(2.2, Math.max(.9, 260 / Math.max(geo.w, geo.h)));
    let media;
    if (stall && stall.photos.length) {
      media = stall.photos.map((p, i) => `<img src="${esc(p.url)}" alt=""${i === 0 ? ' class="is-current"' : ''}>`).join('')
        + (stall.photos.length > 1 ? `<span class="peek__dots">${stall.photos.map((_, i) => `<i${i === 0 ? ' class="is-current"' : ''}></i>`).join('')}</span>` : '');
    } else {
      media = `<div class="zoom" style="${zoomStyle(geo.cx, geo.cy, boxW, mediaH, zoom)}"></div>`;
    }

    let body;
    if (stall) {
      const st = stall.availability;
      const price = stall.nightly != null ? `${money(stall.nightly)} <small>per night</small>` : 'Price on request';
      const extra = [stall.size, stall.smaller ? 'Slightly smaller' : '', stall.group === 'outdoor' ? 'Outdoor, covered' : 'Main barn'].filter(Boolean).join(', ');
      const hint = st === 'available'
        ? (state.selected.has(stall.id) ? 'In your booking. Click to review.' : state.range ? 'Click to see photos and add it.' : 'Click for photos. Pick dates to book.')
        : 'Click for details.';
      body = `<p class="peek__status">${esc(STATUS_TEXT[st](state.range))}</p><h3>${esc(stall.name)}</h3>
        <p class="peek__price">${price}</p><p class="peek__hint">${esc(extra)}. ${esc(hint)}</p>`;
      els.peek.dataset.state = st;
    } else {
      body = `<h3>${esc(area.name)}</h3><p class="peek__hint" style="margin-top:0">${esc(area.text)}</p>`;
      els.peek.dataset.state = 'area';
    }
    els.peek.innerHTML = `<div class="peek__media">${media}</div><div class="peek__body">${body}</div>`;

    // Position next to the stall, inside the map
    const stageW = els.stage.clientWidth, stageH = els.stage.clientHeight;
    const k = stageW / MAP_W;
    const sx = geo.x * k, sy = geo.y * k, sw = geo.w * k, sh = geo.h * k;
    const cardH = els.peek.offsetHeight || 280;
    let left = sx + sw + 14, origin = 'left center', fromX = '-8px';
    if (left + boxW > stageW - 8) { left = sx - boxW - 14; origin = 'right center'; fromX = '8px'; }
    if (left < 8) { left = Math.max(8, Math.min(stageW - boxW - 8, sx + sw / 2 - boxW / 2)); origin = 'center top'; fromX = '0px'; }
    let top = sy + sh / 2 - cardH / 2;
    top = Math.max(8, Math.min(stageH - cardH - 8, top));
    els.peek.style.left = left + 'px';
    els.peek.style.top = top + 'px';
    els.peek.style.setProperty('--origin', origin);
    els.peek.style.setProperty('--from-x', fromX);
    els.peek.classList.remove('is-on');
    void els.peek.offsetWidth; // restart the entrance
    els.peek.classList.add('is-on');

    // Cycle photos
    const imgs = els.peek.querySelectorAll('.peek__media img');
    if (imgs.length > 1 && !reduceMotion) {
      let i = 0;
      const dots = els.peek.querySelectorAll('.peek__dots i');
      state.slideTimer = setInterval(() => {
        imgs[i].classList.remove('is-current'); if (dots[i]) dots[i].classList.remove('is-current');
        i = (i + 1) % imgs.length;
        imgs[i].classList.add('is-current'); if (dots[i]) dots[i].classList.add('is-current');
      }, 1800);
    }
  }

  function hidePeek(delay = 80) {
    clearTimeout(state.peekTimer);
    state.peekTimer = setTimeout(() => {
      clearInterval(state.slideTimer);
      els.peek.classList.remove('is-on');
      els.svg.querySelectorAll('.is-peek').forEach((n) => n.classList.remove('is-peek'));
    }, delay);
  }

  const hotspot = (e) => e.target.closest && e.target.closest('.spot, .area');
  if (canHover) {
    els.svg.addEventListener('pointerover', (e) => { const t = hotspot(e); if (t) showPeek(t); });
    els.svg.addEventListener('pointerout', (e) => { const t = hotspot(e); if (t && !t.contains(e.relatedTarget)) hidePeek(); });
  }
  els.svg.addEventListener('focusin', (e) => { const t = hotspot(e); if (t) showPeek(t); });
  els.svg.addEventListener('focusout', () => hidePeek(0));
  els.svg.addEventListener('click', (e) => {
    const t = hotspot(e);
    if (!t) return;
    if (t.dataset.id) { hidePeek(0); openStall(t.dataset.id); }
    else if (!canHover) showPeek(t);
  });
  els.svg.addEventListener('keydown', (e) => {
    const t = hotspot(e);
    if (t && t.dataset.id && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openStall(t.dataset.id); }
  });
  window.addEventListener('resize', () => hidePeek(0));

  // ------------------------------------------------------------ list
  function renderList() {
    const groups = [['main', 'Main barn'], ['outdoor', 'Outdoor stalls']];
    els.list.innerHTML = groups.map(([g, title]) => {
      const rows = state.stalls.filter((s) => s.group === g).sort((a, b) => a.number - b.number).map((s) => {
        const sel = state.selected.has(s.id);
        const pill = sel ? '<span class="pill pill--picked">In your booking</span>' : `<span class="pill pill--${s.availability}">${esc(STATUS_TEXT[s.availability](state.range))}</span>`;
        return `<tr><td><strong>${esc(s.name)}</strong>${s.smaller ? ' <small>(slightly smaller)</small>' : ''}</td>
          <td class="hide-sm">${esc(s.size || '–')}</td><td>${s.nightly != null ? money(s.nightly) : 'On request'}</td><td>${pill}</td>
          <td><button type="button" data-open="${s.id}">Details</button></td></tr>`;
      }).join('');
      return `<h3>${title}</h3><table class="stall-table"><thead><tr><th>Stall</th><th class="hide-sm">Size</th><th>Per night</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
  }
  els.list.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openStall(b.dataset.open); });

  // ------------------------------------------------------------ stall sheet
  function openStall(id) {
    const s = stallById(id);
    if (!s) return;
    const geo = centerOf(s);
    const sel = state.selected.has(s.id);
    const media = s.photos.length
      ? `<figure class="sheet__media"><img id="sheet-photo" src="${esc(s.photos[0].url)}" alt="${esc(s.name)}"></figure>
         ${s.photos.length > 1 ? `<div class="sheet__thumbs">${s.photos.map((p, i) => `<button type="button" data-photo="${esc(p.url)}" aria-current="${i === 0}" aria-label="Photo ${i + 1}"><img src="${esc(p.url)}" alt=""></button>`).join('')}</div>` : ''}`
      : `<figure class="sheet__media"><div class="zoom" id="sheet-zoom"></div><figcaption>Photos of this stall are on the way. Here&rsquo;s where it sits on the ranch.</figcaption></figure>`;

    let action;
    if (s.availability === 'available' && !state.range) {
      action = '<button class="btn btn--red" type="button" data-act="dates">Pick your dates to book</button>';
    } else if (s.availability === 'available') {
      action = sel
        ? '<button class="btn" type="button" data-act="toggle">Remove from booking</button><button class="btn btn--red" type="button" data-act="continue">Continue to booking</button>'
        : '<button class="btn btn--red" type="button" data-act="toggle">Add to my booking</button>';
    } else {
      action = `<button class="btn" type="button" disabled>${esc(STATUS_TEXT[s.availability](state.range))}</button>`;
    }
    els.sheet.innerHTML = `
      <button class="sheet__close" type="button" data-act="close" aria-label="Close">&times;</button>
      ${media}
      <div class="sheet__body">
        <h2 id="sheet-title">${esc(s.name)}</h2>
        <p class="sheet__status" data-state="${s.availability}">${esc(STATUS_TEXT[s.availability](state.range))}${state.range ? `, ${fmtDay(state.range.from)} to ${fmtDay(state.range.to)}` : ''}</p>
        <dl class="sheet__facts">
          <div><dt>Per night</dt><dd>${s.nightly != null ? money(s.nightly) : 'On request'}</dd></div>
          <div><dt>Per month</dt><dd>${s.monthly != null ? money(s.monthly) : 'Ask us'}</dd></div>
          <div><dt>Size</dt><dd>${esc(s.size || 'Ask us')}</dd></div>
        </dl>
        <p class="sheet__desc">${esc(s.description)}</p>
        <div class="sheet__actions">${action}</div>
      </div>`;
    els.sheet.dataset.id = s.id;
    els.sheet.showModal();
    const zoomEl = $('#sheet-zoom', els.sheet);
    if (zoomEl) {
      const box = zoomEl.getBoundingClientRect();
      zoomEl.setAttribute('style', zoomStyle(geo.cx, geo.cy, box.width, box.height, Math.min(4, (box.height * 0.55) / geo.h)));
    }
  }

  els.sheet.addEventListener('click', (e) => {
    if (e.target === els.sheet) { els.sheet.close(); return; } // backdrop
    const t = e.target.closest('[data-act], [data-photo]');
    if (!t) return;
    if (t.dataset.photo) {
      $('#sheet-photo', els.sheet).src = t.dataset.photo;
      els.sheet.querySelectorAll('[data-photo]').forEach((b) => b.setAttribute('aria-current', String(b === t)));
      return;
    }
    const id = els.sheet.dataset.id;
    if (t.dataset.act === 'close') els.sheet.close();
    if (t.dataset.act === 'dates') { els.sheet.close(); els.from.focus(); if (els.from.showPicker) try { els.from.showPicker(); } catch (_) {} }
    if (t.dataset.act === 'toggle') {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      renderMap(); renderList(); renderTray();
      openStall(id); // refresh buttons
    }
    if (t.dataset.act === 'continue') { els.sheet.close(); openBooking(); }
  });

  // ------------------------------------------------------------ tray
  function estimate() {
    if (!state.range || !state.selected.size) return null;
    const n = nightsBetween(state.range.from, state.range.to);
    const stalls = [...state.selected].map(stallById);
    if (stalls.some((s) => s.nightly == null)) return null;
    return stalls.reduce((sum, s) => sum + s.nightly, 0) * n;
  }

  function renderTray() {
    const ids = [...state.selected];
    els.tray.hidden = !ids.length;
    document.body.classList.toggle('has-tray', !!ids.length);
    if (!ids.length) return;
    els.chips.innerHTML = ids.map((id) => `<li>${esc(stallById(id).name)}<button type="button" data-remove="${id}" aria-label="Remove ${esc(stallById(id).name)}">&times;</button></li>`).join('');
    const n = nightsBetween(state.range.from, state.range.to);
    const est = estimate();
    els.trayMeta.textContent = `${fmtDay(state.range.from)} to ${fmtDay(state.range.to)}, ${n} night${n === 1 ? '' : 's'}. ` + (est != null ? `Stalls ${money(est)} before add-ons.` : 'We confirm the total.');
  }
  els.chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    state.selected.delete(b.dataset.remove);
    renderMap(); renderList(); renderTray();
  });
  els.trayGo.addEventListener('click', openBooking);

  // ------------------------------------------------------------ booking form
  function openBooking() {
    if (!state.range || !state.selected.size) return;
    const ids = [...state.selected];
    const n = nightsBetween(state.range.from, state.range.to);
    const est = estimate();
    const fc = state.settings.fullCareNightly, pk = state.settings.parkingNightly;
    els.book.innerHTML = `
      <button class="sheet__close" type="button" data-act="close" aria-label="Close">&times;</button>
      <div class="sheet__body">
        <h2 id="book-title">Request your stalls</h2>
        <form class="bookform" id="bookform" novalidate>
          <div class="summary">
            <p><strong>${fmtDay(state.range.from)} to ${fmtDay(state.range.to)}</strong>, ${n} night${n === 1 ? '' : 's'}</p>
            <ul>${ids.map((id) => { const s = stallById(id); return `<li>${esc(s.name)}${s.nightly != null ? `, ${money(s.nightly)} per night` : ''}</li>`; }).join('')}</ul>
            <p style="margin-top:8px">${est != null ? `Stalls: ${money(est)}. Add-ons are confirmed with your booking.` : 'Jenna confirms the total with you.'}</p>
          </div>
          <fieldset>
            <legend>Horses</legend>
            ${ids.map((id, i) => `<div class="field"><label for="h-${i}">Horse in ${esc(stallById(id).name)}</label><input id="h-${i}" name="horse" required autocomplete="off"></div>`).join('')}
          </fieldset>
          <fieldset>
            <legend>Care and parking</legend>
            <label class="choice"><input type="radio" name="care" value="self" checked><span>Self care<small>You handle feeding and cleaning.</small></span></label>
            <label class="choice"><input type="radio" name="care" value="full"><span>Full care${fc != null ? `, ${money(fc)} per horse per night` : ''}<small>The ranch team takes care of your horse.</small></span></label>
            <label class="choice"><input type="checkbox" name="parking"><span>I&rsquo;m bringing a trailer or RV${pk != null ? `, ${money(pk)} per night` : ''}<small>Spots are limited. We confirm when we call.</small></span></label>
          </fieldset>
          <fieldset>
            <legend>Your details</legend>
            <div class="field"><label for="b-name">Name</label><input id="b-name" name="name" autocomplete="name" required></div>
            <div class="row2">
              <div class="field"><label for="b-phone">Phone</label><input id="b-phone" name="phone" type="tel" autocomplete="tel" required></div>
              <div class="field"><label for="b-email">Email</label><input id="b-email" name="email" type="email" autocomplete="email" required></div>
            </div>
            <div class="field"><label for="b-notes">Anything we should know?</label><textarea id="b-notes" name="notes" placeholder="Arrival time, the event you’re in town for, special needs"></textarea></div>
            <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
          </fieldset>
          <label class="choice"><input type="checkbox" name="coggins" required><span>I&rsquo;ll bring a full Coggins for each horse.<small>Horses can&rsquo;t enter the ranch without one.</small></span></label>
          <p class="form-error" id="book-error" role="alert"></p>
          <button class="btn btn--red" type="submit">Send booking request</button>
        </form>
      </div>`;
    els.book.showModal();
    $('#h-0', els.book).focus();
  }

  els.book.addEventListener('click', (e) => {
    if (e.target === els.book || e.target.closest('[data-act="close"]')) els.book.close();
  });

  els.book.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#book-error', els.book);
    err.textContent = '';
    const horses = [...f.querySelectorAll('[name="horse"]')].map((i) => i.value.trim());
    const missing = [...f.querySelectorAll('[required]')].find((i) => (i.type === 'checkbox' ? !i.checked : !i.value.trim()) || (i.type === 'email' && !i.checkValidity()));
    if (missing) {
      err.textContent = missing.name === 'coggins' ? 'Confirm you’ll bring a full Coggins for each horse.' : missing.name === 'horse' ? 'Add a horse name for each stall.' : `Add your ${missing.name === 'email' ? 'email' : missing.name}.`;
      missing.focus();
      return;
    }
    const body = {
      stallIds: [...state.selected], from: state.range.from, to: state.range.to, horses,
      care: f.care.value, parking: f.parking.checked, coggins: f.coggins.checked,
      name: f.name.value, email: f.email.value, phone: f.phone.value, notes: f.notes.value, website: f.website.value,
    };
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await fetch(API + '/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        err.textContent = data.error || 'The request didn’t go through. Call (305) 409-9656.';
        if (res.status === 409) { if (data.stallId) state.selected.delete(data.stallId); load(); }
        btn.disabled = false; btn.textContent = 'Send booking request';
        return;
      }
      state.selected.clear();
      els.book.innerHTML = `
        <button class="sheet__close" type="button" data-act="close" aria-label="Close">&times;</button>
        <div class="sheet__body done">
          <h2 id="book-title">Request sent</h2>
          <p class="ref">${esc(data.ref)}</p>
          <p>We&rsquo;re holding ${esc(data.stalls.join(', '))} for ${fmtDay(data.from)} to ${fmtDay(data.to)}. Jenna will call or email you to confirm and take payment.</p>
          <p>Before you arrive, everyone in your party signs a waiver, and every horse needs a full Coggins.</p>
          <div class="sheet__actions"><a class="btn btn--red" href="waivers.html">Sign waivers</a><button class="btn" type="button" data-act="close">Back to the map</button></div>
        </div>`;
      load();
    } catch {
      err.textContent = 'The request didn’t go through. Check your connection, or call (305) 409-9656.';
      btn.disabled = false; btn.textContent = 'Send booking request';
    }
  });

  // ------------------------------------------------------------ start
  const stallParam = readUrl();
  if (els.from.value && els.to.value) state.range = { from: els.from.value, to: els.to.value };
  load().then(() => { if (stallParam && stallById(stallParam)) openStall(stallParam); });
})();
