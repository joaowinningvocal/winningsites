(() => {
  // ------------------------------------------------------------ i18n
  const STRINGS = {
    en: {
      title: 'Site review', page: 'Page', liveSite: 'Current live site', openPreview: 'Open preview',
      export: 'Export', exportCopy: 'Copy open comments (Markdown)', exportDownload: 'Download all comments',
      comments: 'Comments', browse: 'Browse', pin: 'Comment', arrow: 'Arrow', box: 'Highlight',
      desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile', toggleVisible: 'Show or hide comments on the page',
      composerLabel: 'Your comment', composerPlaceholder: 'What should change here?', composerHint: 'Ctrl+Enter to save',
      cancel: 'Cancel', save: 'Save comment', thisPage: 'This page', allPages: 'All pages', open: 'Open', resolved: 'Resolved',
      nameTitle: "What's your name?", nameBody: 'It shows next to your comments so everyone knows who asked for what.',
      nameLabel: 'Your name', continue: 'Continue', you: 'You: {name}', setName: 'Set your name',
      reply: 'Reply', resolve: 'Resolve', reopen: 'Reopen', del: 'Delete', send: 'Send reply',
      replyPlaceholder: 'Write a reply', kindPin: 'Comment', kindArrow: 'Arrow', kindBox: 'Highlight',
      emptyOpenTitle: 'No open comments here', emptyOpenBody: 'Pick Comment, Arrow or Highlight in the toolbar, then click or drag on the site.',
      emptyResolvedTitle: 'Nothing resolved yet', emptyResolvedBody: 'Resolved comments show up here.',
      saved: 'Comment saved', resolvedToast: 'Marked as resolved', reopened: 'Reopened', deleted: 'Comment deleted',
      copied: 'Copied {n} open comments', confirmDelete: 'Delete comment #{n}? This can’t be undone.',
      saveFailed: 'Couldn’t save. Check your connection and try again.', loadFailed: 'Couldn’t load comments. Retrying…',
      replies: '{n} replies', oneReply: '1 reply', otherPage: 'Other page', on: 'on {page}',
    },
    pt: {
      title: 'Revisão do site', page: 'Página', liveSite: 'Site atual no ar', openPreview: 'Abrir prévia',
      export: 'Exportar', exportCopy: 'Copiar comentários abertos (Markdown)', exportDownload: 'Baixar todos os comentários',
      comments: 'Comentários', browse: 'Navegar', pin: 'Comentar', arrow: 'Seta', box: 'Destacar',
      desktop: 'Desktop', tablet: 'Tablet', mobile: 'Celular', toggleVisible: 'Mostrar ou ocultar comentários na página',
      composerLabel: 'Seu comentário', composerPlaceholder: 'O que deve mudar aqui?', composerHint: 'Ctrl+Enter salva',
      cancel: 'Cancelar', save: 'Salvar comentário', thisPage: 'Esta página', allPages: 'Todas as páginas', open: 'Abertos', resolved: 'Resolvidos',
      nameTitle: 'Qual é o seu nome?', nameBody: 'Ele aparece nos seus comentários, pra todo mundo saber quem pediu o quê.',
      nameLabel: 'Seu nome', continue: 'Continuar', you: 'Você: {name}', setName: 'Definir seu nome',
      reply: 'Responder', resolve: 'Resolver', reopen: 'Reabrir', del: 'Excluir', send: 'Enviar resposta',
      replyPlaceholder: 'Escreva uma resposta', kindPin: 'Comentário', kindArrow: 'Seta', kindBox: 'Destaque',
      emptyOpenTitle: 'Nenhum comentário aberto aqui', emptyOpenBody: 'Escolha Comentar, Seta ou Destacar na barra e clique ou arraste no site.',
      emptyResolvedTitle: 'Nada resolvido ainda', emptyResolvedBody: 'Os comentários resolvidos aparecem aqui.',
      saved: 'Comentário salvo', resolvedToast: 'Marcado como resolvido', reopened: 'Reaberto', deleted: 'Comentário excluído',
      copied: '{n} comentários abertos copiados', confirmDelete: 'Excluir o comentário #{n}? Não dá pra desfazer.',
      saveFailed: 'Não foi possível salvar. Verifique a conexão e tente de novo.', loadFailed: 'Não foi possível carregar os comentários. Tentando de novo…',
      replies: '{n} respostas', oneReply: '1 resposta', otherPage: 'Outra página', on: 'em {page}',
    },
  };
  let lang = localStorage.getItem('rv-lang') || ((navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en');
  const t = (key, vars) => {
    let s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
    return s;
  };

  // ------------------------------------------------------------ state
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const frame = $('#frame');
  const frameWrap = $('#frame-wrap');
  const canvas = $('#canvas');
  const composer = $('#composer');
  const composerText = $('#composer-text');
  const list = $('#list');
  const empty = $('#empty');
  const panel = $('#panel');

  const S = {
    sites: [],
    site: null,
    page: '/',
    device: 'desktop',
    mode: 'browse',
    scope: 'page',
    status: 'open',
    visible: true,
    selected: null,
    items: [],
    author: localStorage.getItem('rv-author') || '',
    draft: null,
    replyOpen: null,
    pendingFocus: null,
    signature: '',
  };

  const site = () => S.sites.find((s) => s.id === S.site);
  const pageTitle = (p, siteId = S.site) => {
    const s = S.sites.find((x) => x.id === siteId);
    return (s && (s.pages.find((x) => x.path === p) || {}).title) || p;
  };

  // ------------------------------------------------------------ helpers
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.text()) || res.status);
    return res.status === 204 ? null : res.json();
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
  }

  function ago(iso) {
    const secs = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'], [Infinity, 'year']];
    const div = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
    for (const [limit, unit] of steps) if (Math.abs(secs) < limit) return rtf.format(Math.round(secs / div[unit]), unit);
    return '';
  }

  const toFrame = (msg) => { if (frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ __rv: true }, msg), location.origin); };

  function sendState() {
    toFrame({
      type: 'state',
      mode: S.mode,
      items: S.items.filter((a) => a.site === S.site),
      showResolved: S.status === 'resolved',
      visible: S.visible,
      selected: S.selected,
    });
  }

  function writeHash() {
    const p = new URLSearchParams({ site: S.site, page: S.page });
    if (S.selected) p.set('c', S.selected);
    history.replaceState(null, '', '#' + p.toString());
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    return { site: p.get('site'), page: p.get('page'), c: p.get('c') };
  }

  // ------------------------------------------------------------ i18n apply
  function applyLang() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $('#lang-btn').textContent = lang === 'en' ? 'PT' : 'EN';
    renderName();
    renderList();
  }

  function renderName() {
    $('#name-btn').textContent = S.author ? t('you', { name: S.author }) : t('setName');
  }

  // ------------------------------------------------------------ name modal
  let afterName = null;
  function askName(then) {
    afterName = then || null;
    $('#name-modal').hidden = false;
    const input = $('#name-input');
    input.value = S.author;
    setTimeout(() => input.focus(), 30);
  }
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#name-input').value.trim();
    if (!v) return;
    S.author = v;
    localStorage.setItem('rv-author', v);
    $('#name-modal').hidden = true;
    renderName();
    const fn = afterName; afterName = null;
    if (fn) fn();
  });
  $('#name-modal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.author) { $('#name-modal').hidden = true; afterName = null; }
  });
  $('#name-btn').addEventListener('click', () => askName());

  // ------------------------------------------------------------ sites + pages
  function renderTabs() {
    const tabs = $('#site-tabs');
    tabs.innerHTML = '';
    for (const s of S.sites) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s.id === S.site));
      const open = S.items.filter((a) => a.site === s.id && a.status === 'open').length;
      b.innerHTML = `<span></span><b>${open || ''}</b>`;
      b.firstChild.textContent = s.name;
      b.addEventListener('click', () => switchSite(s.id));
      tabs.appendChild(b);
    }
  }

  function renderPages() {
    const sel = $('#page-select');
    const pages = site().pages.slice();
    if (!pages.some((p) => p.path === S.page)) pages.push({ path: S.page, title: S.page });
    sel.innerHTML = '';
    for (const p of pages) {
      const o = document.createElement('option');
      o.value = p.path;
      const n = S.items.filter((a) => a.site === S.site && a.page === p.path && a.status === 'open').length;
      o.textContent = p.title + (n ? ` (${n})` : '');
      sel.appendChild(o);
    }
    sel.value = S.page;
    $('#open-live').href = site().live;
    $('#open-preview').href = `/${S.site}${S.page}`;
  }
  $('#page-select').addEventListener('change', (e) => navigate(e.target.value));

  function frameUrl(siteId, page) { return `/${siteId}${page === '/' ? '/' : page}`; }

  function navigate(page, focusId) {
    cancelDraft();
    S.pendingFocus = focusId || null;
    S.page = page;
    frame.src = frameUrl(S.site, page);
    renderPages();
    renderList();
    writeHash();
  }

  function switchSite(id, page) {
    if (!S.sites.some((s) => s.id === id)) return;
    S.site = id;
    S.selected = null;
    renderTabs();
    navigate(page || '/');
  }

  // ------------------------------------------------------------ device + tools
  function setDevice(d) {
    S.device = d;
    frameWrap.dataset.device = d;
    $$('#devices .tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.device === d)));
    cancelDraft();
  }
  $$('#devices .tool').forEach((b) => b.addEventListener('click', () => setDevice(b.dataset.device)));

  function setMode(m) {
    if (m !== 'browse' && !S.author) { askName(() => setMode(m)); return; }
    S.mode = m;
    $$('#tools .tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    cancelDraft();
    sendState();
  }
  $$('#tools .tool').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('#visible-btn').addEventListener('click', (e) => {
    S.visible = !S.visible;
    e.currentTarget.setAttribute('aria-pressed', String(S.visible));
    sendState();
  });

  function handleKey(key) {
    if (key === 'Escape') {
      if (!composer.hidden) { cancelDraft(); return; }
      if (S.mode !== 'browse') { setMode('browse'); return; }
      if (S.selected) { select(null); return; }
      return;
    }
    const map = { v: 'browse', c: 'pin', a: 'arrow', b: 'box' };
    if (map[key]) setMode(map[key]);
  }
  document.addEventListener('keydown', (e) => {
    const tEl = e.target;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (tEl && (tEl.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tEl.tagName))) {
      if (e.key === 'Escape' && tEl === composerText) cancelDraft();
      return;
    }
    if (!$('#name-modal').hidden) return;
    handleKey(e.key);
  });

  // ------------------------------------------------------------ composer
  function openComposer(draft, at) {
    S.draft = draft;
    composer.hidden = false;
    composerText.value = '';
    const fr = frame.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const w = composer.offsetWidth, h = composer.offsetHeight;
    let left = fr.left - cr.left + at.x + 18;
    let top = fr.top - cr.top + at.y - 12;
    if (left + w > cr.width - 12) left = fr.left - cr.left + at.x - w - 18;
    left = Math.max(12, Math.min(left, cr.width - w - 12));
    top = Math.max(12, Math.min(top, cr.height - h - 80));
    composer.style.left = left + 'px';
    composer.style.top = top + 'px';
    setTimeout(() => composerText.focus(), 20);
  }

  function cancelDraft() {
    if (!S.draft && composer.hidden) return;
    S.draft = null;
    composer.hidden = true;
    toFrame({ type: 'clearDraft' });
  }

  $('#composer-cancel').addEventListener('click', cancelDraft);
  composerText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); composer.requestSubmit(); }
  });
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = composerText.value.trim();
    if (!text || !S.draft) { composerText.focus(); return; }
    const btn = composer.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const created = await api('POST', '/api/annotations', Object.assign({}, S.draft, { text, author: S.author, device: S.device }));
      S.items.push(created);
      S.draft = null;
      composer.hidden = true;
      toFrame({ type: 'clearDraft' });
      S.status = 'open';
      syncSegs();
      select(created.id, false);
      refreshAll();
      toast(t('saved'));
    } catch (err) {
      toast(t('saveFailed'));
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------ list
  function syncSegs() {
    $$('[data-scope]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === S.scope)));
    $$('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === S.status)));
  }
  $$('[data-scope]').forEach((b) => b.addEventListener('click', () => { S.scope = b.dataset.scope; syncSegs(); renderList(); }));
  $$('[data-status]').forEach((b) => b.addEventListener('click', () => { S.status = b.dataset.status; syncSegs(); renderList(); sendState(); }));

  function visibleItems() {
    return S.items
      .filter((a) => a.site === S.site && (S.scope === 'all' || a.page === S.page))
      .filter((a) => a.status === S.status)
      .sort((a, b) => a.n - b.n);
  }

  const kindLabel = (k) => t({ pin: 'kindPin', arrow: 'kindArrow', box: 'kindBox' }[k]);

  function renderList() {
    if (!S.site) return;
    const scoped = S.items.filter((a) => a.site === S.site && (S.scope === 'all' || a.page === S.page));
    $('[data-count="open"]').textContent = scoped.filter((a) => a.status === 'open').length;
    $('[data-count="resolved"]').textContent = scoped.filter((a) => a.status === 'resolved').length;
    $('#panel-count').textContent = S.items.filter((a) => a.site === S.site && a.status === 'open').length;

    const items = visibleItems();
    list.innerHTML = '';
    empty.hidden = items.length > 0;
    if (!items.length) {
      empty.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = t(S.status === 'open' ? 'emptyOpenTitle' : 'emptyResolvedTitle');
      empty.append(strong, document.createTextNode(t(S.status === 'open' ? 'emptyOpenBody' : 'emptyResolvedBody')));
    }

    for (const a of items) {
      const li = document.createElement('li');
      li.className = 'item' + (a.id === S.selected ? ' is-selected' : '') + (a.status === 'resolved' ? ' is-resolved' : '');
      li.dataset.id = a.id;

      const top = document.createElement('div');
      top.className = 'item__top';
      const num = document.createElement('span'); num.className = 'num'; num.textContent = a.n;
      const who = document.createElement('span'); who.className = 'item__who'; who.textContent = a.author;
      const when = document.createElement('span'); when.textContent = ago(a.createdAt); when.title = new Date(a.createdAt).toLocaleString(lang);
      const tags = document.createElement('span'); tags.className = 'item__tags';
      const kt = document.createElement('span'); kt.className = 'tag'; kt.textContent = kindLabel(a.kind);
      const dt = document.createElement('span'); dt.className = 'tag'; dt.textContent = t(a.device);
      tags.append(kt, dt);
      top.append(num, who, when, tags);
      li.appendChild(top);

      const text = document.createElement('p');
      text.className = 'item__text';
      text.textContent = a.text;
      li.appendChild(text);

      const metaBits = [];
      if (S.scope === 'all' && a.page !== S.page) metaBits.push(t('on', { page: pageTitle(a.page) }));
      if (a.id !== S.selected && a.replies.length) metaBits.push(a.replies.length === 1 ? t('oneReply') : t('replies', { n: a.replies.length }));
      if (metaBits.length) {
        const meta = document.createElement('p');
        meta.className = 'item__meta';
        meta.textContent = metaBits.join(', ');
        li.appendChild(meta);
      }

      if (a.id === S.selected) {
        if (a.replies.length) {
          const rep = document.createElement('div');
          rep.className = 'item__replies';
          for (const r of a.replies) {
            const d = document.createElement('div'); d.className = 'reply';
            const b = document.createElement('b'); b.textContent = r.author;
            const tm = document.createElement('time'); tm.textContent = ago(r.createdAt);
            const p = document.createElement('p'); p.textContent = r.text;
            d.append(b, tm, p);
            rep.appendChild(d);
          }
          li.appendChild(rep);
        }
        const actions = document.createElement('div');
        actions.className = 'item__actions';
        actions.innerHTML = `
          <button type="button" data-act="reply"></button>
          <button type="button" data-act="${a.status === 'open' ? 'resolve' : 'reopen'}"></button>
          <button type="button" data-act="delete"></button>`;
        actions.querySelector('[data-act="reply"]').textContent = t('reply');
        actions.querySelector('[data-act="resolve"], [data-act="reopen"]').textContent = t(a.status === 'open' ? 'resolve' : 'reopen');
        actions.querySelector('[data-act="delete"]').textContent = t('del');
        li.appendChild(actions);

        if (S.replyOpen === a.id) {
          const f = document.createElement('form');
          f.className = 'reply-form';
          f.innerHTML = '<textarea></textarea><div><button type="button" class="btn-ghost" data-act="cancel-reply"></button><button type="submit" class="btn-primary"></button></div>';
          const ta = f.querySelector('textarea');
          ta.placeholder = t('replyPlaceholder');
          ta.setAttribute('aria-label', t('replyPlaceholder'));
          f.querySelector('[data-act="cancel-reply"]').textContent = t('cancel');
          f.querySelector('[type="submit"]').textContent = t('send');
          ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); f.requestSubmit(); } });
          f.addEventListener('submit', (e) => { e.preventDefault(); sendReply(a.id, ta.value); });
          li.appendChild(f);
          setTimeout(() => ta.focus(), 20);
        }
      }

      li.addEventListener('mouseenter', () => toFrame({ type: 'hover', id: a.id }));
      li.addEventListener('mouseleave', () => toFrame({ type: 'hover', id: null }));
      list.appendChild(li);
    }
  }

  list.addEventListener('click', async (e) => {
    const li = e.target.closest('.item');
    if (!li) return;
    const id = li.dataset.id;
    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      const a = S.items.find((x) => x.id === id);
      if (!a) return;
      const kind = act.dataset.act;
      if (kind === 'reply') {
        if (!S.author) { askName(() => { S.replyOpen = id; renderList(); }); return; }
        S.replyOpen = id; renderList();
      } else if (kind === 'cancel-reply') {
        S.replyOpen = null; renderList();
      } else if (kind === 'resolve' || kind === 'reopen') {
        try {
          const updated = await api('PATCH', '/api/annotations/' + id, { status: kind === 'resolve' ? 'resolved' : 'open', by: S.author });
          Object.assign(a, updated);
          refreshAll();
          toast(t(kind === 'resolve' ? 'resolvedToast' : 'reopened'));
        } catch { toast(t('saveFailed')); }
      } else if (kind === 'delete') {
        if (!confirm(t('confirmDelete', { n: a.n }))) return;
        try {
          await api('DELETE', '/api/annotations/' + id);
          S.items = S.items.filter((x) => x.id !== id);
          if (S.selected === id) S.selected = null;
          refreshAll();
          toast(t('deleted'));
        } catch { toast(t('saveFailed')); }
      }
      return;
    }
    if (e.target.closest('.reply-form')) return;
    if (id !== S.selected) select(id, true);
  });

  async function sendReply(id, value) {
    const text = value.trim();
    if (!text) return;
    try {
      const updated = await api('POST', `/api/annotations/${id}/replies`, { text, author: S.author });
      const a = S.items.find((x) => x.id === id);
      if (a) Object.assign(a, updated);
      S.replyOpen = null;
      refreshAll();
    } catch { toast(t('saveFailed')); }
  }

  function select(id, focusOnPage) {
    S.selected = id;
    S.replyOpen = null;
    writeHash();
    const a = S.items.find((x) => x.id === id);
    if (a && a.status !== S.status) { S.status = a.status; syncSegs(); }
    renderList();
    sendState();
    if (a && focusOnPage) {
      if (a.page !== S.page) navigate(a.page, a.id);
      else toFrame({ type: 'focus', id: a.id });
    }
    const li = id && list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
    if (id && window.matchMedia('(max-width: 900px)').matches) openPanel(true);
  }

  function refreshAll() {
    renderTabs();
    renderPages();
    renderList();
    sendState();
  }

  // ------------------------------------------------------------ panel drawer (narrow screens)
  function openPanel(open) {
    panel.classList.toggle('is-open', open);
    $('#panel-btn').setAttribute('aria-expanded', String(open));
  }
  $('#panel-btn').addEventListener('click', () => openPanel(!panel.classList.contains('is-open')));

  // ------------------------------------------------------------ export
  const exportBtn = $('#export-btn');
  const exportMenu = $('#export-menu');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = exportMenu.hidden;
    exportMenu.hidden = !open;
    exportBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => { exportMenu.hidden = true; exportBtn.setAttribute('aria-expanded', 'false'); });
  exportMenu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    if (b.dataset.export === 'download') {
      location.href = `/api/export?site=${encodeURIComponent(S.site)}&status=all&download=1`;
      return;
    }
    try {
      const res = await fetch(`/api/export?site=${encodeURIComponent(S.site)}&status=open`);
      const md = await res.text();
      await navigator.clipboard.writeText(md);
      toast(t('copied', { n: S.items.filter((a) => a.site === S.site && a.status === 'open').length }));
    } catch { toast(t('saveFailed')); }
  });

  // ------------------------------------------------------------ messages from the preview
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow || !e.data || !e.data.__rv) return;
    const m = e.data;
    if (m.type === 'ready') {
      if (m.site !== S.site && S.sites.some((s) => s.id === m.site)) { S.site = m.site; renderTabs(); }
      S.page = m.page;
      renderPages();
      renderList();
      writeHash();
      sendState();
      if (S.pendingFocus) { toFrame({ type: 'focus', id: S.pendingFocus }); S.pendingFocus = null; }
    } else if (m.type === 'create') {
      if (!S.author) { askName(() => openComposer(m.draft, m.at)); return; }
      openComposer(m.draft, m.at);
    } else if (m.type === 'select') {
      select(m.id, false);
    } else if (m.type === 'key') {
      handleKey(m.key);
    }
  });

  // ------------------------------------------------------------ data
  async function load() {
    try {
      const items = await api('GET', '/api/annotations');
      const sig = items.map((a) => a.id + a.updatedAt).join('|');
      if (sig !== S.signature) {
        S.signature = sig;
        S.items = items;
        if (S.selected && !items.some((a) => a.id === S.selected)) S.selected = null;
        const typing = document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName);
        if (!typing) refreshAll(); else { renderTabs(); sendState(); }
      }
    } catch {
      toast(t('loadFailed'));
    }
  }

  async function init() {
    const cfg = await api('GET', '/api/config');
    S.sites = cfg.sites;
    await load();
    const h = readHash();
    S.site = S.sites.some((s) => s.id === h.site) ? h.site : S.sites[0].id;
    S.page = h.page || '/';
    if (h.c && S.items.some((a) => a.id === h.c)) { S.selected = h.c; S.pendingFocus = h.c; }
    const a = S.items.find((x) => x.id === S.selected);
    if (a) { S.status = a.status; S.page = a.page; }
    syncSegs();
    applyLang();
    renderTabs();
    renderPages();
    frame.src = frameUrl(S.site, S.page);
    writeHash();
    if (!S.author) askName();
    setInterval(() => { if (!document.hidden) load(); }, 8000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  $('#lang-btn').addEventListener('click', () => {
    lang = lang === 'en' ? 'pt' : 'en';
    localStorage.setItem('rv-lang', lang);
    applyLang();
    renderPages();
  });

  init();
})();
