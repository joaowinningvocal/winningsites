(() => {
  // Mobile menu
  const btn = document.querySelector('.menu-btn');
  const nav = document.getElementById('site-nav');
  if (btn && nav) {
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    });
    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) { btn.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); }
    });
  }

  // Footer year
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // Contact form
  const form = document.getElementById('contact-form');
  if (!form) return;
  const status = form.querySelector('.form-status');
  const topic = new URLSearchParams(location.search).get('topic');
  if (topic && form.topic.querySelector(`option[value="${CSS.escape(topic)}"]`)) form.topic.value = topic;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.removeAttribute('data-state');
    if (!form.firstName.value.trim() || !form.email.value.trim() || !form.email.checkValidity()) {
      status.dataset.state = 'error';
      status.textContent = 'Add your first name and a valid email so we can reply.';
      (form.firstName.value.trim() ? form.email : form.firstName).focus();
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    data.site = 'ranch';
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Sending…';
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(res.status);
      form.reset();
      status.dataset.state = 'ok';
      status.textContent = 'Message sent. A team member will get back to you.';
    } catch {
      status.dataset.state = 'error';
      status.textContent = 'Your message didn’t send. Call (305) 409-9656 to reach a team member.';
    } finally {
      submit.disabled = false;
    }
  });
})();
