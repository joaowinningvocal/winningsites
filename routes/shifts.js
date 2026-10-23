/* Time clock for the ranch team, mounted on the staff router (/api/ranch/admin/...)
   Ranch hands and the ranch manager:  /shift  (clock in at the ranch, breaks, checklist, notes, clock out)
   Managers and office:               /hours  (day and week views, corrections, settings, reports)
   Reports go by email every morning (yesterday) and on the first day of each pay week (last week). */
const H = require('../lib/hours');
const { sendEmail } = require('../lib/mailer');

module.exports = function shifts({ staff, db, store, newId, now, str }) {
  if (!db.shifts) db.shifts = [];
  if (!db.reportLog) db.reportLog = { daily: {}, weekly: {} };
  db.settings.timeclock = Object.assign({ geo: null, radius: 150, reportTo: '', dailyTime: '07:00', weekStart: 1, checklistText: H.DEFAULT_CHECKLIST }, db.settings.timeclock || {});
  const tc = () => db.settings.timeclock;

  const live = () => db.shifts.filter((s) => !s.deletedAt);
  const openShift = (userId) => live().find((s) => s.userId === userId && !s.out);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const team = () => db.users.filter((u) => u.role === 'staff');

  function place(body) {
    const lat = num(body && body.lat), lng = num(body && body.lng), acc = num(body && body.accuracy);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const p = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, accuracy: Number.isFinite(acc) ? Math.round(acc) : null };
    const g = tc().geo;
    if (!g) return { ...p, geo: 'unchecked', distance: null };
    const distance = Math.round(H.distanceM(p, g));
    const slack = Math.min(p.accuracy || 0, 100); // GPS isn't exact; give it up to 100 m
    return { ...p, distance, geo: distance - slack <= (tc().radius || 150) ? 'inside' : 'outside' };
  }

  function shiftOut(s) {
    return {
      ...s, worked: H.workedMinutes(s), breakMinutes: H.breakMinutes(s), flags: H.flags(s), stats: H.checklistStats(s),
      onBreak: s.breaks.some((b) => !b.end),
      name: (db.users.find((u) => u.id === s.userId) || {}).name || 'Unknown',
    };
  }

  // ================================================================= the person on shift
  staff.get('/shift', (req, res) => {
    const s = openShift(req.user.id);
    const mine = live().filter((x) => x.userId === req.user.id && x.out).sort((a, b) => b.in.at.localeCompare(a.in.at)).slice(0, 7);
    res.json({
      shift: s ? shiftOut(s) : null,
      recent: mine.map(shiftOut),
      geoReady: !!tc().geo,
      checklist: H.parseChecklist(tc().checklistText),
    });
  });

  staff.post('/shift/clock-in', async (req, res) => {
    if (openShift(req.user.id)) return res.status(409).json({ error: 'You’re already clocked in.' });
    const p = place(req.body);
    if (tc().geo) {
      if (!p) return res.status(400).json({ error: 'Turn on location for this site so we can see you’re at the ranch.' });
      if (p.accuracy && p.accuracy > 1000) return res.status(400).json({ error: 'Your location isn’t precise enough. Turn on precise location and try again.' });
      if (p.geo !== 'inside') return res.status(403).json({ error: `You’re about ${p.distance >= 1000 ? (p.distance / 1609).toFixed(1) + ' miles' : p.distance + ' m'} from the ranch. Clock in when you get here.` });
    }
    const at = now();
    const s = {
      id: newId(), userId: req.user.id, day: H.laDay(at),
      in: { at, ...(p || { geo: 'unchecked' }) }, out: null, breaks: [],
      checklist: H.parseChecklist(tc().checklistText).map((sec) => ({ title: sec.title, items: sec.items.map((text) => ({ text, done: false })) })),
      notes: [], edits: [],
    };
    db.shifts.push(s);
    await store.save();
    res.status(201).json({ shift: shiftOut(s) });
  });

  staff.post('/shift/break', async (req, res) => {
    const s = openShift(req.user.id);
    if (!s) return res.status(400).json({ error: 'Clock in first.' });
    const open = s.breaks.find((b) => !b.end);
    if (req.body && req.body.action === 'start') {
      if (open) return res.status(409).json({ error: 'You’re already on a break.' });
      s.breaks.push({ start: now(), end: null });
    } else {
      if (!open) return res.status(409).json({ error: 'You’re not on a break.' });
      open.end = now();
    }
    await store.save();
    res.json({ shift: shiftOut(s) });
  });

  staff.patch('/shift/checklist', async (req, res) => {
    const s = openShift(req.user.id);
    if (!s) return res.status(400).json({ error: 'Clock in first.' });
    const sec = s.checklist[req.body && req.body.section];
    const item = sec && sec.items[req.body.item];
    if (!item) return res.status(404).json({ error: 'Task not found.' });
    item.done = !!req.body.done;
    item.at = item.done ? now() : undefined;
    await store.save();
    res.json({ stats: H.checklistStats(s) });
  });

  async function addNote(req, s, text, urgent) {
    const note = { at: now(), text, urgent: !!urgent };
    s.notes.push(note);
    if (urgent && tc().reportTo) {
      sendEmail({
        to: tc().reportTo,
        subject: `Urgent from ${req.user.name} at the ranch`,
        html: `<div style="font-family:Arial,sans-serif"><p><b>${req.user.name}</b> sent this at ${H.fmtTime(note.at)}:</p><p style="font-size:16px">${String(text).replace(/</g, '&lt;')}</p></div>`,
      }).then((r) => { if (!r.ok) console.error('[shift] urgent email failed:', r.error); });
    }
    return note;
  }

  staff.post('/shift/note', async (req, res) => {
    const s = openShift(req.user.id);
    if (!s) return res.status(400).json({ error: 'Clock in first.' });
    const text = str(req.body && req.body.text, 1000);
    if (!text) return res.status(400).json({ error: 'Write the note first.' });
    await addNote(req, s, text, req.body.urgent);
    await store.save();
    res.status(201).json({ shift: shiftOut(s), emailed: !!(req.body.urgent && tc().reportTo) });
  });

  staff.post('/shift/clock-out', async (req, res) => {
    const s = openShift(req.user.id);
    if (!s) return res.status(400).json({ error: 'You’re not clocked in.' });
    const at = now();
    s.breaks.forEach((b) => { if (!b.end) b.end = at; });
    const p = place(req.body);
    s.out = { at, ...(p || { geo: tc().geo ? 'unknown' : 'unchecked' }) };
    const text = str(req.body && req.body.note, 1000);
    if (text) await addNote(req, s, text, false);
    await store.save();
    res.json({ shift: shiftOut(s) });
  });

  // ================================================================= managers and office
  staff.get('/hours/day', (req, res) => {
    const day = isDay(req.query.day) ? req.query.day : H.laDay();
    res.json({
      day,
      shifts: live().filter((s) => s.day === day).map(shiftOut).sort((a, b) => a.name.localeCompare(b.name)),
      onShift: live().filter((s) => !s.out).map(shiftOut),
    });
  });

  staff.get('/hours/week', (req, res) => {
    const start = H.weekOf(isDay(req.query.day) ? req.query.day : H.laDay(), tc().weekStart);
    const rep = H.weeklyReport({ start, shifts: live(), users: db.users });
    res.json({ start, days: Array.from({ length: 7 }, (_, i) => H.addDays(start, i)), per: rep.per });
  });

  staff.get('/hours/week.csv', (req, res) => {
    const start = H.weekOf(isDay(req.query.day) ? req.query.day : H.laDay(), tc().weekStart);
    const rep = H.weeklyReport({ start, shifts: live(), users: db.users });
    res.set('Content-Disposition', `attachment; filename="ranch-hours-${start}.csv"`).type('text/csv').send(rep.csv);
  });

  staff.get('/hours/preview', (req, res) => {
    const day = isDay(req.query.day) ? req.query.day : H.laDay();
    const rep = req.query.kind === 'weekly'
      ? H.weeklyReport({ start: H.weekOf(day, tc().weekStart), shifts: live(), users: db.users })
      : H.dailyReport({ day, shifts: live(), users: db.users });
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>${rep.subject.replace(/</g, '')}</title><body style="max-width:900px;margin:20px auto;padding:0 16px">${rep.html}</body>`);
  });

  function parseTime(day, hm) {
    // "YYYY-MM-DD" + "HH:MM" in Las Vegas time -> ISO. Tries both possible UTC offsets (PDT/PST).
    if (!isDay(day) || !/^\d{2}:\d{2}$/.test(hm || '')) return null;
    for (const off of [7, 8]) {
      const d = new Date(`${day}T${hm}:00Z`);
      d.setUTCHours(d.getUTCHours() + off);
      if (H.laDay(d) === day && H.laHM(d) === hm) return d.toISOString();
    }
    return null;
  }

  function applyTimes(s, b, day) {
    const inAt = b.inTime ? parseTime(day, b.inTime) : s.in.at;
    let outAt = b.outTime === '' ? null : b.outTime ? parseTime(b.outDay || day, b.outTime) : s.out && s.out.at;
    if (!inAt || (b.outTime && !outAt)) return 'Times look wrong. Use the time picker.';
    if (outAt && outAt <= inAt) outAt = new Date(new Date(outAt).getTime() + 864e5).toISOString(); // overnight
    const brk = b.breakMinutes === '' || b.breakMinutes === undefined ? undefined : Number(b.breakMinutes);
    if (brk !== undefined && (!Number.isFinite(brk) || brk < 0 || brk > 600)) return 'Break minutes must be between 0 and 600.';
    return { inAt, outAt, brk };
  }

  staff.patch('/hours/shifts/:id', async (req, res) => {
    const s = live().find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Shift not found.' });
    const b = req.body || {};
    const note = str(b.note, 300);
    if (!note) return res.status(400).json({ error: 'Add a short reason for the change. It goes in the report.' });
    const t = applyTimes(s, b, s.day);
    if (typeof t === 'string') return res.status(400).json({ error: t });
    const before = { in: s.in.at, out: s.out && s.out.at, breakMinutes: Math.round(H.breakMinutes(s)) };
    s.in.at = t.inAt;
    if (t.outAt) s.out = { ...(s.out || { geo: 'manual' }), at: t.outAt }; else if (b.outTime === '') s.out = null;
    if (t.brk !== undefined) s.breakOverride = t.brk;
    s.edits.push({ by: req.user.name, at: now(), note, before, after: { in: s.in.at, out: s.out && s.out.at, breakMinutes: Math.round(H.breakMinutes(s)) } });
    await store.save();
    res.json({ shift: shiftOut(s) });
  });

  staff.post('/hours/shifts', async (req, res) => {
    const b = req.body || {};
    const user = team().find((u) => u.id === b.userId);
    if (!user) return res.status(400).json({ error: 'Pick the person.' });
    if (!isDay(b.day)) return res.status(400).json({ error: 'Pick the date.' });
    const note = str(b.note, 300);
    if (!note) return res.status(400).json({ error: 'Add a short reason. It goes in the report.' });
    if (!b.inTime || !b.outTime) return res.status(400).json({ error: 'Add the clock-in and clock-out times.' });
    const s = { id: newId(), userId: user.id, day: b.day, in: { at: null, geo: 'manual' }, out: null, breaks: [], checklist: [], notes: [], edits: [], manual: { by: req.user.name, at: now(), note } };
    const t = applyTimes(s, b, b.day);
    if (typeof t === 'string') return res.status(400).json({ error: t });
    s.in.at = t.inAt; s.out = { at: t.outAt, geo: 'manual' }; s.breakOverride = t.brk || 0;
    db.shifts.push(s);
    await store.save();
    res.status(201).json({ shift: shiftOut(s) });
  });

  staff.delete('/hours/shifts/:id', async (req, res) => {
    const s = live().find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Shift not found.' });
    s.deletedAt = now(); s.deletedBy = req.user.name;
    await store.save();
    res.status(204).end();
  });

  staff.get('/hours/settings', (_req, res) => {
    res.json({
      settings: { ...tc() },
      team: team().map((u) => ({ id: u.id, name: u.name, position: u.position || 'office' })),
      log: { daily: Object.entries(db.reportLog.daily).slice(-7), weekly: Object.entries(db.reportLog.weekly).slice(-4) },
      email: process.env.RESEND_API_KEY ? 'email' : (process.env.REPORT_WEBHOOK_URL || process.env.CONTACT_WEBHOOK_URL) ? 'webhook' : 'none',
    });
  });

  staff.patch('/hours/settings', async (req, res) => {
    const b = req.body || {};
    const c = tc();
    if (b.geo === null) c.geo = null;
    else if (b.geo) {
      const lat = Number(b.geo.lat), lng = Number(b.geo.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: 'That location doesn’t look right.' });
      c.geo = { lat, lng, setBy: req.user.name, setAt: now() };
    }
    if ('radius' in b) { const r = Number(b.radius); if (!Number.isFinite(r) || r < 50 || r > 2000) return res.status(400).json({ error: 'Use a radius between 50 and 2000 meters.' }); c.radius = Math.round(r); }
    if ('reportTo' in b) {
      const list = String(b.reportTo).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return res.status(400).json({ error: 'Check the email addresses (separate them with commas).' });
      c.reportTo = list.join(', ');
    }
    if ('dailyTime' in b) { if (!/^\d{2}:\d{2}$/.test(b.dailyTime)) return res.status(400).json({ error: 'Pick a time.' }); c.dailyTime = b.dailyTime; }
    if ('weekStart' in b) { const w = Number(b.weekStart); if (![0, 1, 2, 3, 4, 5, 6].includes(w)) return res.status(400).json({ error: 'Pick a day.' }); c.weekStart = w; }
    if ('checklistText' in b) {
      if (!H.parseChecklist(b.checklistText).length) return res.status(400).json({ error: 'The checklist needs at least one section with tasks.' });
      c.checklistText = String(b.checklistText).slice(0, 8000);
    }
    await store.save();
    res.json({ settings: { ...c } });
  });

  async function sendReport(kind, day) {
    const rep = kind === 'weekly'
      ? H.weeklyReport({ start: H.weekOf(day, tc().weekStart), shifts: live(), users: db.users })
      : H.dailyReport({ day, shifts: live(), users: db.users });
    const attachments = kind === 'weekly' ? [{ filename: `ranch-hours-${H.weekOf(day, tc().weekStart)}.csv`, content: rep.csv }] : [];
    return sendEmail({ to: tc().reportTo, subject: rep.subject, html: rep.html, attachments });
  }

  staff.post('/hours/send', async (req, res) => {
    const kind = req.body && req.body.kind === 'weekly' ? 'weekly' : 'daily';
    const day = isDay(req.body && req.body.day) ? req.body.day : H.laDay();
    const r = await sendReport(kind, day);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, via: r.via });
  });

  // ================================================================= scheduler
  // Every minute: after the daily time (Las Vegas), send yesterday's report once;
  // on the first day of the pay week, also send last week's payroll report.
  async function tick() {
    const c = tc();
    if (!c.reportTo || H.laHM() < c.dailyTime) return;
    const today = H.laDay();
    const yesterday = H.addDays(today, -1);
    if (!db.reportLog.daily[yesterday]) {
      db.reportLog.daily[yesterday] = { at: now(), pending: true };
      const r = await sendReport('daily', yesterday);
      db.reportLog.daily[yesterday] = { at: now(), ok: r.ok, error: r.error };
      store.save();
    }
    const lastWeek = H.weekOf(yesterday, c.weekStart);
    if (H.weekOf(today, c.weekStart) === today && !db.reportLog.weekly[lastWeek]) {
      db.reportLog.weekly[lastWeek] = { at: now(), pending: true };
      const r = await sendReport('weekly', yesterday);
      db.reportLog.weekly[lastWeek] = { at: now(), ok: r.ok, error: r.error };
      store.save();
    }
  }
  const timer = setInterval(() => tick().catch((e) => console.error('[reports]', e)), 60e3);
  timer.unref();
};
