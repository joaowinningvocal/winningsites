(() => {
  const { api, esc, timeAgo, fmtDate, dayLabel, me, logout, loginView, inviteView, lightbox, $ } = window.WR;
  const root = $('#app');
  const logoutBtn = $('#logout');
  let user = null;
  let refreshTimer = 0;

  logoutBtn.addEventListener('click', logout);

  async function route() {
    clearInterval(refreshTimer);
    const hash = location.hash || '#/';
    const invite = hash.match(/^#\/invite\/(.+)$/);
    if (invite) {
      logoutBtn.hidden = true;
      return inviteView(root, decodeURIComponent(invite[1]), { onSuccess: (u) => { user = u; location.hash = '#/'; route(); } });
    }
    if (!user) user = await me();
    if (!user) {
      logoutBtn.hidden = true;
      return loginView(root, {
        title: 'Owner portal',
        intro: 'See photos and videos of your horse from the ranch team.',
        foot: 'No login yet? The ranch sets one up when your horse checks in. Call Jenna at <a href="tel:+13054099656">(305) 409-9656</a>.',
        onSuccess: (u) => { user = u; route(); },
      });
    }
    logoutBtn.hidden = false;
    const horse = hash.match(/^#\/horse\/([\w-]+)$/);
    if (horse) return horseView(horse[1]);
    return homeView();
  }
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- horses
  async function homeView() {
    root.innerHTML = '<div class="wrap"><p class="muted">Loading your horses…</p></div>';
    let horses;
    try { ({ horses } = await api('GET', '/my/horses')); } catch (ex) { return showError(ex); }
    if (horses.length === 1 && user.role !== 'staff' && !sessionStorage.getItem('wr-seen-home')) {
      sessionStorage.setItem('wr-seen-home', '1');
      location.hash = '#/horse/' + horses[0].id;
      return;
    }
    const first = user.name.split(' ')[0];
    const cards = horses.map((h) => `
      <a class="horse-card" href="#/horse/${esc(h.id)}">
        <div class="horse-card__img">${h.cover ? `<img src="${esc(h.cover)}" alt="" loading="lazy">` : '<span class="silhouette"></span>'}</div>
        <div class="horse-card__body">
          <h2>${esc(h.name)}</h2>
          <p>${esc(h.stall || 'Stall not assigned')}</p>
          <p>${h.updates ? `${h.updates} update${h.updates === 1 ? '' : 's'}, latest ${esc(timeAgo(h.latest.createdAt))}` : 'No updates yet'}</p>
        </div>
      </a>`).join('');
    root.innerHTML = `
      <div class="wrap">
        <h1>Hi, ${esc(first)}</h1>
        <p class="lede">${user.role === 'staff' ? 'You’re seeing every horse because you’re on the ranch team.' : 'Tap your horse to see the latest from the team.'}</p>
        ${horses.length ? `<div class="horse-grid">${cards}</div>` : `
          <div class="empty-box">
            <h2>No horses on your account yet</h2>
            <p>Once your horse checks in at the ranch, its photos and videos show up here. Questions? Call Jenna at <a class="textlink" href="tel:+13054099656">(305) 409-9656</a>.</p>
          </div>`}
      </div>`;
  }

  async function horseView(id) {
    root.innerHTML = '<div class="wrap"><p class="muted">Loading updates…</p></div>';
    let data;
    try { data = await api('GET', `/horses/${id}/updates`); } catch (ex) { return showError(ex); }
    render(data);
    // Pick up new posts while the page is open
    refreshTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const fresh = await api('GET', `/horses/${id}/updates`);
        if (fresh.updates.length !== data.updates.length) { data = fresh; render(data); }
      } catch (_) {}
    }, 60000);
  }

  function render({ horse, updates }) {
    const cover = updates.flatMap((u) => u.media).find((m) => m.type === 'image');
    let lastDay = '';
    const items = updates.map((u) => {
      const label = dayLabel(u.createdAt);
      const day = label !== lastDay ? `<li class="day-label">${esc(label)}</li>` : '';
      lastDay = label;
      const imgs = u.media.filter((m) => m.type === 'image');
      const vids = u.media.filter((m) => m.type === 'video');
      const media = (imgs.length || vids.length) ? `
        <div class="post__media${imgs.length === 1 && !vids.length ? ' one' : ''}">
          ${imgs.map((m) => `<button type="button" data-full="${esc(m.url)}" aria-label="Open photo"><img src="${esc(m.url)}" alt="Photo of ${esc(horse.name)}" loading="lazy"></button>`).join('')}
          ${vids.map((m) => `<video controls playsinline preload="metadata" src="${esc(m.url)}"></video>`).join('')}
        </div>` : '';
      return `${day}<li class="post">
        <div class="post__head"><span><strong>${esc(u.authorName || 'Ranch team')}</strong></span><time datetime="${esc(u.createdAt)}" title="${esc(new Date(u.createdAt).toLocaleString())}">${esc(timeAgo(u.createdAt))}</time></div>
        ${u.caption ? `<p class="post__caption">${esc(u.caption)}</p>` : '<div style="height:12px"></div>'}
        ${media}
      </li>`;
    }).join('');

    root.innerHTML = `
      <div class="wrap">
        <p><a class="textlink" href="#/" id="back-link">Your horses</a></p>
        <div class="horse-head">
          <div class="horse-head__img">${cover ? `<img src="${esc(cover.url)}" alt="">` : '<span class="silhouette"></span>'}</div>
          <div>
            <h1>${esc(horse.name)}</h1>
            <p>${esc([horse.breed, horse.stall].filter(Boolean).join(', '))}</p>
            ${horse.arrivedOn ? `<p>At the ranch since ${esc(fmtDate(horse.arrivedOn))}</p>` : ''}
          </div>
        </div>
        ${updates.length ? `<ol class="feed">${items}</ol>` : `
          <div class="empty-box"><h2>No updates yet</h2><p>When the team posts photos or videos of ${esc(horse.name)}, they show up here.</p></div>`}
      </div>`;
    $('#back-link', root).addEventListener('click', () => sessionStorage.setItem('wr-seen-home', '1'));
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-full]');
    if (b) lightbox(b.dataset.full);
  });

  function showError(ex) {
    if (ex.status === 401) { user = null; return route(); }
    root.innerHTML = `<div class="wrap"><div class="empty-box"><h2>That didn’t load</h2><p>${esc(ex.message)}</p><p><a class="textlink" href="#/">Back to your horses</a></p></div></div>`;
  }

  route();
})();
