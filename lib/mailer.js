/* Email for the ranch: invites, signature requests, hours reports.
   Works with the same setup as the Winning App, so the app@winningrealty.com mailbox can be reused:
   - Resend:    RESEND_API_KEY + EMAIL_FROM (e.g. "app@winningrealty.com"; the domain must be verified in Resend)
   - Gmail API: GMAIL_USER + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN (scope gmail.send)
   - fallback:  REPORT_WEBHOOK_URL / CONTACT_WEBHOOK_URL get the email as JSON (e.g. integrator.io)
   The sender name shown to people is EMAIL_FROM_NAME (default "Winning Ranch").
   Railway blocks plain SMTP on some plans, which is why both options are HTTPS APIs. */
const FROM_NAME = () => process.env.EMAIL_FROM_NAME || 'Winning Ranch';
const fromAddress = () => {
  const raw = (process.env.EMAIL_FROM || process.env.REPORT_FROM || process.env.GMAIL_USER || '').trim();
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
};

let gmailToken = { value: '', exp: 0 };
async function gmailAccessToken() {
  if (gmailToken.value && Date.now() < gmailToken.exp - 60e3) return gmailToken.value;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.GMAIL_CLIENT_ID, client_secret: process.env.GMAIL_CLIENT_SECRET, refresh_token: process.env.GMAIL_REFRESH_TOKEN }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('Gmail sign-in failed: ' + (d.error_description || d.error || r.status));
  gmailToken = { value: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return gmailToken.value;
}

const b64 = (s) => Buffer.from(s).toString('base64');
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
function mime({ from, to, subject, html, attachments }) {
  const boundary = 'wr' + Date.now().toString(36);
  const lines = [`From: ${from}`, `To: ${to.join(', ')}`, `Subject: ${encWord(subject)}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(html).replace(/.{76}/g, '$&\r\n')];
  for (const a of attachments) {
    lines.push(`--${boundary}`, `Content-Type: application/octet-stream; name="${a.filename}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.filename}"`, '', b64(a.content).replace(/.{76}/g, '$&\r\n'));
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

function configured() {
  if (process.env.RESEND_API_KEY && fromAddress()) return 'email';
  if (process.env.GMAIL_USER && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN) return 'email';
  if (process.env.REPORT_WEBHOOK_URL || process.env.CONTACT_WEBHOOK_URL) return 'webhook';
  return 'none';
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  const recipients = (Array.isArray(to) ? to : String(to || '').split(',')).map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'No email address to send to.' };
  try {
    if (process.env.RESEND_API_KEY && fromAddress()) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${FROM_NAME()} <${fromAddress()}>`, to: recipients, subject, html,
          attachments: attachments.map((a) => ({ filename: a.filename, content: b64(a.content) })) }),
      });
      if (!res.ok) return { ok: false, error: `Email service said ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { ok: true, via: 'email' };
    }
    if (configured() === 'email') {
      const raw = Buffer.from(mime({ from: `"${FROM_NAME()}" <${process.env.GMAIL_USER}>`, to: recipients, subject, html, attachments })).toString('base64url');
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: 'Bearer ' + await gmailAccessToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
      });
      if (!res.ok) { if (res.status === 401) gmailToken = { value: '', exp: 0 }; return { ok: false, error: `Gmail said ${res.status}` }; }
      return { ok: true, via: 'email' };
    }
    const hook = process.env.REPORT_WEBHOOK_URL || process.env.CONTACT_WEBHOOK_URL;
    if (hook) {
      const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'email', to: recipients, subject, html, attachments: attachments.map((a) => ({ filename: a.filename, content: String(a.content) })) }) });
      return res.ok ? { ok: true, via: 'webhook' } : { ok: false, error: `Webhook said ${res.status}` };
    }
    return { ok: false, error: 'Email isn’t set up yet. Add the email variables in Railway (see the README).' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// One branded layout for every email the ranch sends
function layout({ title, body, button }) {
  return `<div style="font-family:Arial,sans-serif;background:#f6f0e5;padding:24px"><div style="max-width:520px;margin:0 auto;background:#fff;border-top:6px solid #CC232A;padding:26px 24px">
    <p style="margin:0 0 14px;font:600 13px Arial;letter-spacing:.08em;color:#CC232A">WINNING RANCH</p>
    <h1 style="font:600 22px Georgia,serif;margin:0 0 12px;color:#0E0E0E">${title}</h1>
    <div style="font-size:15px;line-height:1.55;color:#333">${body}</div>
    ${button ? `<p style="margin:22px 0 8px"><a href="${button.url}" style="background:#CC232A;color:#fff;text-decoration:none;font-weight:600;padding:13px 22px;display:inline-block">${button.label}</a></p>
    <p style="font-size:12px;color:#777;word-break:break-all">Or open this link: ${button.url}</p>` : ''}
    <p style="font-size:12px;color:#999;margin-top:22px">5360 W Agate Ave, Las Vegas, NV &middot; (305) 409-9656</p></div></div>`;
}

module.exports = { sendEmail, configured, layout };
