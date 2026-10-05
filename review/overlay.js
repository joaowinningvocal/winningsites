/* Review overlay
   Injected into every site page by the server. It does nothing unless the page
   is open inside the review tool (/review), so visitors never see it.
   Draws comment pins, arrows and highlight boxes on top of the page, and turns
   clicks/drags into new annotations that the review tool then saves. */
(() => {
  let inReview = false;
  try { inReview = window.top !== window && window.parent.location.pathname.startsWith('/review'); } catch (_) {}
  if (!inReview) return;

  const BLUE = '#2F6BFF';
  const GREY = '#8A8F98';
  const SVGNS = 'http://www.w3.org/2000/svg';

  const segs = location.pathname.split('/');
  const site = segs[1];
  let page = '/' + segs.slice(2).join('/');
  if (page === '/index.html') page = '/';

  const post = (msg) => window.parent.postMessage(Object.assign({ __rv: true }, msg), location.origin);

  const state = { mode: 'browse', items: [], showResolved: false, visible: true, selected: null, hover: null };
  let pulseId = null;

  // ---------- styles ----------
  const style = document.createElement('style');
  style.textContent = `
    #__rv-layer{position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;z-index:2147483000;}
    #__rv-layer svg{position:absolute;left:0;top:0;max-width:none;display:block;overflow:visible;pointer-events:none;}
    #__rv-layer .__rv-hit{pointer-events:stroke;cursor:pointer;}
    #__rv-layer.__rv-drawing .__rv-hit, #__rv-layer.__rv-drawing .__rv-pin{pointer-events:none;}
    .__rv-pin{position:absolute;width:30px;height:30px;margin:-30px 0 0 0;pointer-events:auto;cursor:pointer;
      border-radius:50% 50% 50% 0;background:${BLUE};color:#fff;box-shadow:0 0 0 2px #fff,0 4px 12px rgba(0,0,0,.28);
      font:700 13px/30px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;text-align:center;
      transition:transform .12s ease;transform-origin:0 100%;}
    .__rv-pin.__rv-resolved{background:${GREY};}
    .__rv-pin.__rv-hover,.__rv-pin:hover{transform:scale(1.15);}
    .__rv-pin.__rv-selected{transform:scale(1.25);box-shadow:0 0 0 2px #fff,0 0 0 6px rgba(47,107,255,.35),0 4px 12px rgba(0,0,0,.28);}
    .__rv-pin.__rv-draft{background:#fff;color:${BLUE};box-shadow:0 0 0 2px ${BLUE},0 4px 12px rgba(0,0,0,.28);}
    .__rv-pin.__rv-pulse{animation:__rvpulse 1s ease 2;}
    @keyframes __rvpulse{0%,100%{transform:scale(1.25)}50%{transform:scale(1.6)}}
    #__rv-capture{position:fixed;inset:0;z-index:2147483001;display:none;cursor:crosshair;background:rgba(47,107,255,.035);}
    #__rv-capture[data-mode="pin"]{touch-action:manipulation;}
    #__rv-capture[data-mode="arrow"],#__rv-capture[data-mode="box"]{touch-action:none;}
  `;
  document.head.appendChild(style);

  // ---------- layer ----------
  const layer = document.createElement('div');
  layer.id = '__rv-layer';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.innerHTML = `<defs>
    <marker id="__rv-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${BLUE}"/></marker>
    <marker id="__rv-head-grey" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${GREY}"/></marker>
  </defs><g id="__rv-shapes"></g><g id="__rv-draft"></g>`;
  layer.appendChild(svg);
  const pins = document.createElement('div');
  layer.appendChild(pins);
  const capture = document.createElement('div');
  capture.id = '__rv-capture';
  document.documentElement.appendChild(layer);
  document.documentElement.appendChild(capture);
  const shapesG = svg.querySelector('#__rv-shapes');
  const draftG = svg.querySelector('#__rv-draft');

  // ---------- anchoring ----------
  // Each point is stored relative to the element under it (CSS path + fraction
  // of its box), with the raw page position as a fallback. That keeps comments
  // attached to the right thing when the layout changes between screen sizes.
  function cssPath(el) {
    if (!(el instanceof Element)) return 'body';
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !el.id.startsWith('__rv')) { parts.unshift('#' + el.id); break; }
      const tag = el.tagName.toLowerCase();
      let i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) i++;
      parts.unshift(`${tag}:nth-of-type(${i})`);
      el = el.parentElement;
    }
    if (!parts.length || !parts[0].startsWith('#')) parts.unshift('body');
    return parts.join(' > ');
  }

  function elementAt(cx, cy) {
    layer.style.visibility = 'hidden';
    capture.style.pointerEvents = 'none';
    const el = document.elementFromPoint(cx, cy);
    layer.style.visibility = '';
    capture.style.pointerEvents = '';
    return (el && el !== document.documentElement) ? el : document.body;
  }

  function anchorFor(el, cx, cy) {
    const r = el.getBoundingClientRect();
    return {
      sel: cssPath(el),
      fx: r.width ? +((cx - r.left) / r.width).toFixed(4) : 0,
      fy: r.height ? +((cy - r.top) / r.height).toFixed(4) : 0,
      x: Math.round(cx + scrollX),
      y: Math.round(cy + scrollY),
    };
  }

  function resolve(p) {
    if (p && p.sel) {
      let el = null;
      try { el = document.querySelector(p.sel); } catch (_) {}
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width || r.height) return { x: r.left + scrollX + p.fx * r.width, y: r.top + scrollY + p.fy * r.height };
      }
    }
    return { x: p.x, y: p.y };
  }

  function describe(el) {
    if (!el || el === document.body) return 'page';
    const text = (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    return el.tagName.toLowerCase() + (text ? ` "${text.slice(0, 70)}${text.length > 70 ? '…' : ''}"` : '');
  }

  function commonAncestor(a, b) {
    const seen = new Set();
    for (let n = a; n; n = n.parentElement) seen.add(n);
    for (let n = b; n; n = n.parentElement) if (seen.has(n)) return n;
    return document.body;
  }

  // ---------- drawing helpers ----------
  const el = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  function drawArrow(g, p0, p1, color, id) {
    const head = color === GREY ? 'url(#__rv-head-grey)' : 'url(#__rv-head)';
    g.appendChild(el('line', { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, stroke: '#fff', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: .9 }));
    g.appendChild(el('line', { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, stroke: color, 'stroke-width': 3.5, 'stroke-linecap': 'round', 'marker-end': head }));
    if (id) {
      const hit = el('line', { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, stroke: 'transparent', 'stroke-width': 16, class: '__rv-hit' });
      hit.addEventListener('click', () => post({ type: 'select', id }));
      g.appendChild(hit);
    }
  }

  function drawBox(g, p0, p1, color, id) {
    const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
    const w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
    g.appendChild(el('rect', { x, y, width: w, height: h, fill: 'none', stroke: '#fff', 'stroke-width': 6, rx: 4, opacity: .9 }));
    g.appendChild(el('rect', { x, y, width: w, height: h, fill: color === GREY ? 'rgba(138,143,152,.08)' : 'rgba(47,107,255,.10)', stroke: color, 'stroke-width': 3, rx: 4 }));
    if (id) {
      const hit = el('rect', { x, y, width: w, height: h, fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: '__rv-hit' });
      hit.addEventListener('click', () => post({ type: 'select', id }));
      g.appendChild(hit);
    }
    return { x, y };
  }

  function addPin(x, y, label, cls, id) {
    const p = document.createElement('div');
    p.className = '__rv-pin ' + (cls || '');
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.textContent = label;
    if (id) {
      p.title = 'Comment #' + label;
      p.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); post({ type: 'select', id }); });
    }
    pins.appendChild(p);
    return p;
  }

  // ---------- render ----------
  let draft = null; // { kind, p0, p1 } in page coordinates while waiting for the comment text

  function sizeLayer() {
    layer.style.display = 'none';
    const de = document.documentElement;
    const W = Math.max(de.scrollWidth, document.body.scrollWidth, innerWidth);
    const H = Math.max(de.scrollHeight, document.body.scrollHeight, innerHeight);
    layer.style.display = '';
    layer.style.width = W + 'px';
    layer.style.height = H + 'px';
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
  }

  function render() {
    sizeLayer();
    shapesG.innerHTML = '';
    draftG.innerHTML = '';
    pins.innerHTML = '';
    layer.classList.toggle('__rv-drawing', state.mode !== 'browse');

    if (state.visible) {
      const items = state.items.filter((a) => a.site === site && a.page === page && (state.showResolved || a.status !== 'resolved'));
      for (const a of items) {
        const color = a.status === 'resolved' ? GREY : BLUE;
        let cls = a.status === 'resolved' ? '__rv-resolved' : '';
        if (a.id === state.selected) cls += ' __rv-selected';
        if (a.id === state.hover) cls += ' __rv-hover';
        if (a.id === pulseId) cls += ' __rv-pulse';
        const p0 = resolve(a.points[0]);
        if (a.kind === 'pin') addPin(p0.x, p0.y, a.n, cls, a.id);
        else if (a.kind === 'arrow') { const p1 = resolve(a.points[1]); drawArrow(shapesG, p0, p1, color, a.id); addPin(p0.x, p0.y, a.n, cls, a.id); }
        else if (a.kind === 'box') { const p1 = resolve(a.points[1]); const tl = drawBox(shapesG, p0, p1, color, a.id); addPin(tl.x, tl.y, a.n, cls, a.id); }
      }
    }
    if (draft) {
      if (draft.kind === 'pin') addPin(draft.p0.x, draft.p0.y, '+', '__rv-draft');
      else if (draft.kind === 'arrow' && draft.p1) drawArrow(draftG, draft.p0, draft.p1, BLUE);
      else if (draft.kind === 'box' && draft.p1) drawBox(draftG, draft.p0, draft.p1, BLUE);
    }
    pulseId = null;
  }

  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };
  addEventListener('resize', schedule);
  addEventListener('load', schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(document.body);
  document.addEventListener('toggle', schedule, true); // <details> open/close

  // ---------- capture (creating annotations) ----------
  function setMode(mode) {
    state.mode = mode;
    capture.style.display = mode === 'browse' ? 'none' : 'block';
    capture.dataset.mode = mode;
  }

  let drag = null;
  capture.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (draft) return; // finish or cancel the open comment first
    e.preventDefault();
    const docPt = { x: e.clientX + scrollX, y: e.clientY + scrollY };
    if (state.mode === 'pin') {
      const target = elementAt(e.clientX, e.clientY);
      draft = { kind: 'pin', p0: docPt };
      render();
      post({ type: 'create', at: { x: e.clientX, y: e.clientY }, draft: {
        site, page, kind: 'pin', points: [anchorFor(target, e.clientX, e.clientY)], hint: describe(target),
        viewport: { w: innerWidth, h: innerHeight },
      } });
      return;
    }
    drag = { id: e.pointerId };
    draft = { kind: state.mode, p0: docPt, p1: docPt };
    capture.setPointerCapture(e.pointerId);
    render();
  });

  capture.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    draft.p1 = { x: e.clientX + scrollX, y: e.clientY + scrollY };
    render();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    const { p0, p1, kind } = draft;
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 14) { draft = null; render(); return; }
    const c0 = { x: p0.x - scrollX, y: p0.y - scrollY };
    const c1 = { x: p1.x - scrollX, y: p1.y - scrollY };
    let points, hintEl;
    if (kind === 'arrow') {
      const a = elementAt(c0.x, c0.y), b = elementAt(c1.x, c1.y);
      points = [anchorFor(a, c0.x, c0.y), anchorFor(b, c1.x, c1.y)];
      hintEl = b;
    } else {
      const a = elementAt(c0.x, c0.y), b = elementAt(c1.x, c1.y);
      const box = commonAncestor(a, b);
      points = [anchorFor(box, c0.x, c0.y), anchorFor(box, c1.x, c1.y)];
      hintEl = elementAt((c0.x + c1.x) / 2, (c0.y + c1.y) / 2);
    }
    render();
    post({ type: 'create', at: { x: Math.max(c0.x, c1.x), y: Math.min(c0.y, c1.y) }, draft: {
      site, page, kind, points, hint: describe(hintEl), viewport: { w: innerWidth, h: innerHeight },
    } });
  }
  capture.addEventListener('pointerup', endDrag);
  capture.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { drag = null; draft = null; render(); } });

  // ---------- messages from the review tool ----------
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent || !e.data || !e.data.__rv) return;
    const m = e.data;
    if (m.type === 'state') {
      Object.assign(state, { items: m.items || [], showResolved: !!m.showResolved, visible: m.visible !== false, selected: m.selected || null });
      setMode(m.mode || 'browse');
      render();
    } else if (m.type === 'clearDraft') {
      draft = null; render();
    } else if (m.type === 'hover') {
      state.hover = m.id || null; render();
    } else if (m.type === 'focus') {
      const a = state.items.find((x) => x.id === m.id);
      if (!a) return;
      state.selected = a.id;
      const p = resolve(a.points[0]);
      const p1 = a.points[1] ? resolve(a.points[1]) : p;
      const top = Math.min(p.y, p1.y) - innerHeight / 3;
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
      pulseId = a.id;
      render();
    }
  });

  // Forward tool shortcuts when the preview has keyboard focus
  addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (['v', 'c', 'a', 'b', 'Escape'].includes(e.key)) { post({ type: 'key', key: e.key }); }
  });

  post({ type: 'ready', site, page, title: document.title, href: location.pathname + location.search });
  render();
})();
