/* Sends report emails.
   - RESEND_API_KEY (+ REPORT_FROM, e.g. "Winning Ranch <reports@winningranch.com>") sends real email through resend.com
   - otherwise REPORT_WEBHOOK_URL (or CONTACT_WEBHOOK_URL) receives the report as JSON, e.g. for integrator.io
   Railway blocks plain SMTP on some plans, which is why this uses an HTTP API. */
async function sendEmail({ to, subject, html, attachments = [] }) {
  const recipients = (Array.isArray(to) ? to : String(to || '').split(',')).map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'No report email address is set.' };

  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.REPORT_FROM || 'Winning Ranch <onboarding@resend.dev>',
        to: recipients, subject, html,
        attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
      }),
    });
    if (!res.ok) return { ok: false, error: `Email service said ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true, via: 'email' };
  }

  const hook = process.env.REPORT_WEBHOOK_URL || process.env.CONTACT_WEBHOOK_URL;
  if (hook) {
    const res = await fetch(hook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'report', to: recipients, subject, html, attachments: attachments.map((a) => ({ filename: a.filename, content: String(a.content) })) }),
    });
    if (!res.ok) return { ok: false, error: `Webhook said ${res.status}` };
    return { ok: true, via: 'webhook' };
  }
  return { ok: false, error: 'Email isn’t set up yet. Add RESEND_API_KEY in Railway.' };
}

module.exports = { sendEmail };
