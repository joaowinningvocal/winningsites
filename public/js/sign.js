(() => {
  const API = '/api/ranch';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = $('#sign-root');
  const params = new URLSearchParams(location.search);
  const docId = params.get('doc');
  let doc = null;
  let pad = null;
  const DRAFT = () => 'wr-sign-' + doc.id;
  const PERSON_KEYS = ['name', 'email', 'cell', 'homePhone', 'street', 'city', 'state', 'zip'];

  // ---------------------------------------------------------------- signature pad
  function SignaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false, empty = true, last = null;
    function setup() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const keep = empty ? null : canvas.toDataURL();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      Object.assign(ctx, { lineWidth: 2.6, lineCap: 'round', lineJoin: 'round', strokeStyle: '#0E0E0E', fillStyle: '#0E0E0E' });
      if (keep) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = keep; }
    }
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      drawing = true; last = pos(e);
      canvas.setPointerCapture(e.pointerId);
      ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fill();
      empty = false; canvas.dispatchEvent(new Event('change'));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y);
      ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
      ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    window.addEventListener('resize', setup);
    setup();
    return {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; canvas.dispatchEvent(new Event('change')); },
      isEmpty: () => empty,
      toDataURL: () => canvas.toDataURL('image/png'),
    };
  }

  // ---------------------------------------------------------------- form building
  function fieldHtml(f) {
    const id = 'f-' + f.key;
    const req = f.required ? ' required' : '';
    const opt = f.required ? '' : ' <small class="opt">optional</small>';
    const cls = `field w-${f.w || 'full'}`;
    const show = f.showIf ? ` data-show-if="${esc(f.showIf[0])}" data-show-val="${esc(f.showIf[1])}" hidden` : '';
    if (f.type === 'choice') {
      return `<fieldset class="${cls} choice-group"${show}><legend>${esc(f.label)}${opt}</legend>
        ${f.options.map((o, i) => `<label class="choice"><input type="radio" name="${esc(f.key)}" value="${esc(o)}"${i === 0 ? req : ''}><span>${esc(o)}</span></label>`).join('')}</fieldset>`;
    }
    const type = { email: 'email', tel: 'tel', date: 'date' }[f.type] || 'text';
    const ac = { name: 'name', email: 'email', cell: 'tel', street: 'street-address', city: 'address-level2', state: 'address-level1', zip: 'postal-code' }[f.key];
    const control = f.type === 'textarea'
      ? `<textarea id="${id}" name="${esc(f.key)}" rows="2"${req}></textarea>`
      : `<input id="${id}" name="${esc(f.key)}" type="${type}"${ac ? ` autocomplete="${ac}"` : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.max ? ` maxlength="${f.max}"` : ''}${req}>`;
    return `<div class="${cls}"${show}><label for="${id}">${esc(f.label)}${opt}</label>${control}</div>`;
  }

  function sectionHtml(s, i) {
    const body = `<div class="fgrid">${s.fields.map(fieldHtml).join('')}</div>`;
    if (s.collapsed) return `<details class="fsec"><summary>${esc(s.title)} <small class="opt">optional</small></summary>${body}</details>`;
    return `<section class="fsec"><h3><span class="num">${i + 2}</span>${esc(s.title)}${s.optional ? ' <small class="opt">optional</small>' : ''}</h3>${body}
      ${s.id === 'person' && doc.minor ? `
        <label class="choice minor-toggle"><input type="checkbox" name="__minor"><span>${esc(doc.minor.label)}<small>A parent or guardian fills this out and signs.</small></span></label>
        <div class="fgrid" id="guardian" hidden><div class="field w-full"><label for="f-guardian">Parent or guardian&rsquo;s full legal name</label><input id="f-guardian" name="__guardian" autocomplete="off"></div></div>` : ''}</section>`;
  }

  async function render() {
    const { docs } = await (await fetch(API + '/docs')).json();
    doc = docs.find((d) => d.id === docId);
    if (!doc) return renderPicker(docs);
    document.title = `${doc.title} | Winning Ranch`;
    $('#doc-title').textContent = doc.title;
    $('#doc-who').textContent = `${doc.who} About ${doc.minutes} minutes.`;
    const n = doc.sections.filter((s) => !s.collapsed).length;
    root.innerHTML = `
      <div class="wrap sign__grid">
        <form id="sign-form" class="sign__form" novalidate>
          <section class="fsec">
            <h3><span class="num">1</span>Read the agreement</h3>
            <div class="reader" id="reader" tabindex="0" aria-label="${esc(doc.title)} text"><p class="muted">Loading the document…</p></div>
            <p class="reader__foot"><a class="textlink" href="docs/${esc(doc.id)}.pdf" target="_blank" rel="noopener">Open the original (PDF)</a><span id="read-progress" class="muted"></span></p>
          </section>
          ${doc.sections.map((s, i) => sectionHtml(s, i)).join('')}
          <section class="fsec sign-box">
            <h3><span class="num">${n + 2}</span>Sign</h3>
            <label class="choice"><input type="checkbox" name="__agree" required><span>I read the whole ${esc(doc.title.toLowerCase())} and I agree to it.</span></label>
            <label class="choice"><input type="checkbox" name="__esign" required><span>I agree to sign electronically.<small>My electronic signature means the same as signing on paper.</small></span></label>
            <div class="field"><label for="f-typed">Type your full legal name to sign</label><input id="f-typed" name="__typed" autocomplete="off" required><small class="muted" id="typed-hint"></small></div>
            <div class="field"><label id="pad-label">Draw your signature</label>
              <div class="pad"><canvas id="pad" aria-labelledby="pad-label"></canvas><span class="pad__line" aria-hidden="true"></span>
                <button type="button" class="pad__clear" id="pad-clear">Clear</button></div>
            </div>
            <p class="muted" id="sign-date"></p>
            <p class="form-error" id="sign-error" role="alert"></p>
            <button class="btn btn--red sign__submit" type="submit">Sign ${esc(doc.title.toLowerCase())}</button>
          </section>
        </form>
      </div>`;

    pad = SignaturePad($('#pad'));
    $('#pad-clear').addEventListener('click', () => pad.clear());
    $('#sign-date').textContent = 'Date: ' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    loadReader();
    restoreDraft();
    wire();
  }

  async function loadReader() {
    const reader = $('#reader');
    try {
      const res = await fetch(`docs/${doc.id}.html`);
      reader.innerHTML = res.ok ? await res.text() : '<p>The document didn’t load. Open the PDF below to read it.</p>';
    } catch { reader.innerHTML = '<p>The document didn’t load. Open the PDF below to read it.</p>'; }
    const prog = $('#read-progress');
    const update = () => {
      const max = reader.scrollHeight - reader.clientHeight;
      const pct = max > 0 ? Math.min(100, Math.round((reader.scrollTop / max) * 100)) : 100;
      prog.textContent = pct >= 99 ? 'Read to the end' : `${pct}% read`;
    };
    reader.addEventListener('scroll', update, { passive: true });
    update();
  }

  // ---------------------------------------------------------------- behavior
  function values() {
    const f = $('#sign-form');
    const out = {};
    for (const el of f.elements) {
      if (!el.name || el.name.startsWith('__')) continue;
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value;
    }
    return out;
  }
  const signerName = () => ($('[name="__minor"]') && $('[name="__minor"]').checked ? $('#f-guardian').value : ($('#f-name') || {}).value || '').trim();

  function syncVisibility() {
    const v = values();
    root.querySelectorAll('[data-show-if]').forEach((el) => { el.hidden = v[el.dataset.showIf] !== el.dataset.showVal; });
    const minor = $('[name="__minor"]');
    if (minor) $('#guardian').hidden = !minor.checked;
    const who = signerName();
    $('#typed-hint').textContent = who ? `Type it exactly as: ${who}` : '';
  }

  function saveDraft() {
    try {
      const minor = $('[name="__minor"]');
      sessionStorage.setItem(DRAFT(), JSON.stringify({ v: values(), minor: !!(minor && minor.checked), guardian: ($('#f-guardian') || {}).value || '' }));
    } catch (_) {}
  }

  function fill(v) {
    const f = $('#sign-form');
    for (const [k, val] of Object.entries(v || {})) {
      const els = f.querySelectorAll(`[name="${CSS.escape(k)}"]`);
      els.forEach((el) => { if (el.type === 'radio') el.checked = el.value === val; else el.value = val; });
    }
  }

  function restoreDraft() {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT()) || 'null'); } catch (_) {}
    if (!d) {
      // Signing another document? Bring the person's details along.
      try { const p = JSON.parse(sessionStorage.getItem('wr-sign-person') || 'null'); if (p) fill(p); } catch (_) {}
    } else {
      fill(d.v);
      const minor = $('[name="__minor"]');
      if (minor && d.minor) { minor.checked = true; $('#f-guardian').value = d.guardian || ''; }
    }
    syncVisibility();
  }

  function wire() {
    const form = $('#sign-form');
    form.addEventListener('input', () => { syncVisibility(); saveDraft(); });
    form.addEventListener('change', () => { syncVisibility(); saveDraft(); });
    form.addEventListener('submit', submit);
  }

  function firstProblem() {
    const form = $('#sign-form');
    for (const el of form.querySelectorAll('input[required], textarea[required]')) {
      if (el.closest('[hidden]')) continue;
      if (el.type === 'radio') { if (!form.querySelector(`[name="${CSS.escape(el.name)}"]:checked`)) return { el, msg: `Pick an option for “${el.closest('fieldset').querySelector('legend').firstChild.textContent.trim()}”.` }; continue; }
      if (el.type === 'checkbox') { if (!el.checked) return { el, msg: el.name === '__agree' ? 'Confirm you read the whole document and agree to it.' : 'Agree to sign electronically.' }; continue; }
      if (!el.value.trim()) return { el, msg: el.name === '__typed' ? 'Type your full name to sign.' : `Fill in “${(form.querySelector(`label[for="${el.id}"]`) || {}).firstChild?.textContent?.trim() || 'this field'}”.` };
      if (el.type === 'email' && !el.checkValidity()) return { el, msg: 'Check the email address.' };
    }
    const minor = $('[name="__minor"]');
    if (minor && minor.checked && !$('#f-guardian').value.trim()) return { el: $('#f-guardian'), msg: 'Add the parent or guardian’s full name.' };
    const typed = $('#f-typed').value.trim().toLowerCase().replace(/\s+/g, ' ');
    if (typed !== signerName().toLowerCase().replace(/\s+/g, ' ')) return { el: $('#f-typed'), msg: `Type your name exactly as: ${signerName()}` };
    if (pad.isEmpty()) return { el: $('#pad'), msg: 'Draw your signature in the box.' };
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    const err = $('#sign-error');
    err.textContent = '';
    const problem = firstProblem();
    if (problem) {
      err.textContent = problem.msg;
      problem.el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (problem.el.focus) problem.el.focus({ preventScroll: true });
      return;
    }
    const minor = $('[name="__minor"]');
    const body = {
      docId: doc.id, fields: values(),
      minor: !!(minor && minor.checked), guardianName: minor && minor.checked ? $('#f-guardian').value : '',
      typedSignature: $('#f-typed').value, agree: $('[name="__agree"]').checked, esign: $('[name="__esign"]').checked,
      signature: pad.toDataURL(),
    };
    const btn = $('.sign__submit');
    btn.disabled = true; btn.textContent = 'Signing…';
    try {
      const res = await fetch(API + '/waivers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'It didn’t go through.');
      const person = {};
      PERSON_KEYS.forEach((k) => { if (body.fields[k]) person[k] = body.fields[k]; });
      try { sessionStorage.setItem('wr-sign-person', JSON.stringify(person)); sessionStorage.removeItem(DRAFT()); } catch (_) {}
      done(data);
    } catch (ex) {
      err.textContent = `${ex.message} If it keeps happening, call (305) 409-9656.`;
      btn.disabled = false; btn.textContent = `Sign ${doc.title.toLowerCase()}`;
    }
  }

  function done(data) {
    const when = new Date(data.signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    root.innerHTML = `
      <div class="wrap"><div class="signed">
        <h2>Signed</h2>
        <p class="lede">Your ${esc(doc.title.toLowerCase())} was signed on ${esc(when)}. The ranch team has it now.</p>
        <p>Open your signed copy and save or print it for your records. Keep the link private: anyone who has it can open the copy.</p>
        <div class="btn-row">
          <a class="btn btn--red" href="${esc(data.copyUrl)}" target="_blank" rel="noopener">Open my signed copy</a>
          ${doc.id === 'boarding' ? '<a class="btn" href="sign.html?doc=boarding">Fill one out for another horse</a>' : ''}
          ${doc.id === 'lesson' ? '<a class="btn" href="sign.html?doc=liability">Next: liability waiver</a>' : ''}
          <a class="btn" href="waivers.html">Back to all waivers</a>
        </div>
      </div></div>`;
    $('#doc-who').textContent = 'Thank you.';
    window.scrollTo({ top: 0 });
  }

  function renderPicker(docs) {
    $('#doc-title').textContent = 'Sign a waiver';
    $('#doc-who').textContent = 'Pick the document you need to sign.';
    root.innerHTML = `<div class="wrap"><ul class="doc-list">${docs.map((d) => `<li><a class="doc" href="sign.html?doc=${esc(d.id)}"><span><strong>${esc(d.title)}</strong><small>${esc(d.who)}</small></span><span class="go">Sign</span></a></li>`).join('')}</ul></div>`;
  }

  render().catch(() => { root.innerHTML = '<div class="wrap"><p class="form-error">This page didn’t load. Refresh, or call (305) 409-9656.</p></div>'; });
})();
