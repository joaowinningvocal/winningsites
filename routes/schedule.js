/* Weekly AM/PM schedule for the ranch team, mounted on the staff router (/api/ranch/admin/...)
   The usual week (template, by weekday) fills every week; managers drag changes onto a given day,
   which only change that day. Ranch hands ask to take or swap a shift and a manager approves it.
   Only who works when: the time clock doesn't depend on it. */
const H = require('../lib/hours');

const SLOTS = ['am', 'pm'];

module.exports = function schedule({ staff, db, store, newId, now, str }) {
  db.settings.schedule = Object.assign({ am: { start: '06:00', end: '12:00' }, pm: { start: '12:00', end: '18:00' }, template: {} }, db.settings.schedule || {});
  if (!db.scheduleDays) db.scheduleDays = {}; // { 'YYYY-MM-DD': { am?: [userId], pm?: [userId] } }, only days changed from the usual week
  if (!db.shiftRequests) db.shiftRequests = [];
  const cfg = () => db.settings.schedule;

  const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isHM = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const isLead = (u) => ['manager', 'office'].includes(u.position || 'office');
  const workers = () => db.users.filter((u) => u.role === 'staff' && u.active !== false && ['hand', 'manager'].includes(u.position || 'office'));
  const isWorker = (id) => workers().some((u) => u.id === id);
  const nameOf = (id) => (db.users.find((u) => u.id === id) || {}).name || 'Someone';
  const weekday = (day) => new Date(day + 'T12:00:00Z').getUTCDay();
  const today = () => H.laDay();

  // Who works a slot: the day's own list if a manager changed it, else the usual week
  const who = (day, slot) => {
    const own = (db.scheduleDays[day] || {})[slot];
    const ids = Array.isArray(own) ? own : ((cfg().template[weekday(day)] || {})[slot] || []);
    return ids.filter(isWorker);
  };
  const setDay = (day, slot, ids) => { (db.scheduleDays[day] = db.scheduleDays[day] || {})[slot] = [...new Set(ids)]; };
  const setTemplate = (wd, slot, ids) => { (cfg().template[wd] = cfg().template[wd] || {})[slot] = [...new Set(ids)]; };
  const slotLabel = (day, slot) => `${new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })} ${slot.toUpperCase()}`;

  const requestOut = (q) => ({
    ...q, byName: nameOf(q.byUserId), withName: nameOf(q.to.userId),
    fromLabel: q.from ? slotLabel(q.from.day, q.from.slot) : '', toLabel: slotLabel(q.to.day, q.to.slot),
  });
  // A request still makes sense only while the schedule looks like it did when it was asked
  function stillValid(q) {
    if (q.to.day < today() || (q.from && q.from.day < today())) return 'That shift has already passed.';
    if (!who(q.to.day, q.to.slot).includes(q.to.userId)) return `${nameOf(q.to.userId)} isn’t on ${slotLabel(q.to.day, q.to.slot)}.`;
    if (who(q.to.day, q.to.slot).includes(q.byUserId)) return `${nameOf(q.byUserId)} is already on ${slotLabel(q.to.day, q.to.slot)}.`;
    if (q.kind === 'swap') {
      if (!who(q.from.day, q.from.slot).includes(q.byUserId)) return `${nameOf(q.byUserId)} isn’t on ${slotLabel(q.from.day, q.from.slot)}.`;
      if (who(q.from.day, q.from.slot).includes(q.to.userId)) return `${nameOf(q.to.userId)} is already on ${slotLabel(q.from.day, q.from.slot)}.`;
    }
    return null;
  }

  // ================================================================= the week
  staff.get('/schedule', (req, res) => {
    const start = H.weekOf(isDay(req.query.day) ? req.query.day : today(), (db.settings.timeclock || {}).weekStart ?? 1);
    const days = Array.from({ length: 7 }, (_, i) => H.addDays(start, i));
    const mine = isLead(req.user) ? db.shiftRequests : db.shiftRequests.filter((q) => q.byUserId === req.user.id || q.to.userId === req.user.id);
    res.json({
      start, today: today(), canEdit: isLead(req.user), me: req.user.id,
      times: { am: cfg().am, pm: cfg().pm },
      team: workers().map((u) => ({ id: u.id, name: u.name, position: u.position })),
      days: days.map((day) => ({ day, changed: !!db.scheduleDays[day], am: who(day, 'am'), pm: who(day, 'pm') })),
      usual: days.map(weekday).map((wd) => ({ weekday: wd, am: ((cfg().template[wd] || {}).am || []).filter(isWorker), pm: ((cfg().template[wd] || {}).pm || []).filter(isWorker) })),
      requests: mine.filter((q) => q.status === 'pending' || q.decidedAt > new Date(Date.now() - 7 * 864e5).toISOString())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40).map(requestOut),
    });
  });

  // Managers: set who works one or more slots, in one go (a drag changes two slots at once)
  staff.post('/schedule/set', async (req, res) => {
    if (!isLead(req.user)) return res.status(403).json({ error: 'Only managers change the schedule. Ask to take or swap a shift instead.' });
    const changes = Array.isArray(req.body && req.body.changes) ? req.body.changes.slice(0, 20) : [];
    if (!changes.length) return res.status(400).json({ error: 'Nothing to change.' });
    for (const c of changes) {
      if (!SLOTS.includes(c.slot)) return res.status(400).json({ error: 'Unknown shift.' });
      if (!Array.isArray(c.userIds) || c.userIds.length > 30 || !c.userIds.every(isWorker)) return res.status(400).json({ error: 'Pick people from the team.' });
      if (c.usual ? !(Number.isInteger(c.weekday) && c.weekday >= 0 && c.weekday <= 6) : !isDay(c.day)) return res.status(400).json({ error: 'Pick a day.' });
    }
    for (const c of changes) {
      if (c.usual) setTemplate(c.weekday, c.slot, c.userIds); else setDay(c.day, c.slot, c.userIds);
    }
    await store.save();
    res.json({ ok: true });
  });

  // Managers: these days go back to the usual week
  staff.post('/schedule/reset', async (req, res) => {
    if (!isLead(req.user)) return res.status(403).json({ error: 'Only managers change the schedule.' });
    const days = (Array.isArray(req.body && req.body.days) ? req.body.days : []).filter(isDay).slice(0, 14);
    days.forEach((d) => { delete db.scheduleDays[d]; });
    await store.save();
    res.json({ ok: true, reset: days.length });
  });

  staff.patch('/schedule/settings', async (req, res) => {
    if (!isLead(req.user)) return res.status(403).json({ error: 'Only managers change the schedule.' });
    const b = req.body || {};
    for (const slot of SLOTS) {
      const t = b[slot] || {};
      if (!isHM(t.start) || !isHM(t.end)) return res.status(400).json({ error: `Check the ${slot.toUpperCase()} shift times.` });
    }
    cfg().am = { start: b.am.start, end: b.am.end };
    cfg().pm = { start: b.pm.start, end: b.pm.end };
    await store.save();
    res.json({ ok: true });
  });

  // ================================================================= take or swap a shift
  // take: I work their shift instead of them. swap: I work theirs and they work mine.
  staff.post('/schedule/requests', async (req, res) => {
    const b = req.body || {};
    const me = req.user.id;
    if (!isWorker(me)) return res.status(403).json({ error: 'Only the ranch team works shifts.' });
    const to = b.to || {};
    if (!['take', 'swap'].includes(b.kind) || !isDay(to.day) || !SLOTS.includes(to.slot) || !isWorker(to.userId) || to.userId === me) return res.status(400).json({ error: 'Pick a coworker’s shift.' });
    const from = b.kind === 'swap' ? b.from || {} : null;
    if (from && (!isDay(from.day) || !SLOTS.includes(from.slot))) return res.status(400).json({ error: 'Pick one of your shifts to give in return.' });
    const q = {
      id: newId(), kind: b.kind, byUserId: me,
      from: from ? { day: from.day, slot: from.slot } : null,
      to: { day: to.day, slot: to.slot, userId: to.userId },
      note: str(b.note, 300), status: 'pending', createdAt: now(),
    };
    const err = stillValid(q);
    if (err) return res.status(400).json({ error: err });
    const same = db.shiftRequests.find((x) => x.status === 'pending' && x.byUserId === me && x.to.day === q.to.day && x.to.slot === q.to.slot && x.to.userId === q.to.userId);
    if (same) return res.status(409).json({ error: 'You already asked for that shift. A manager will answer.' });
    db.shiftRequests.push(q);
    await store.save();
    res.status(201).json({ request: requestOut(q) });
  });

  staff.post('/schedule/requests/:id/cancel', async (req, res) => {
    const q = db.shiftRequests.find((x) => x.id === req.params.id && x.status === 'pending');
    if (!q || (q.byUserId !== req.user.id && !isLead(req.user))) return res.status(404).json({ error: 'That request isn’t open anymore.' });
    Object.assign(q, { status: 'cancelled', decidedAt: now(), decidedBy: req.user.name });
    await store.save();
    res.json({ request: requestOut(q) });
  });

  staff.post('/schedule/requests/:id/decide', async (req, res) => {
    if (!isLead(req.user)) return res.status(403).json({ error: 'A manager approves shift changes.' });
    const q = db.shiftRequests.find((x) => x.id === req.params.id && x.status === 'pending');
    if (!q) return res.status(404).json({ error: 'That request isn’t open anymore.' });
    const approve = !!(req.body && req.body.approve);
    if (approve) {
      const err = stillValid(q);
      if (err) return res.status(409).json({ error: `${err} Decline it and ask them to send a new one.` });
      const swapIn = (ids, out, inn) => ids.map((id) => (id === out ? inn : id));
      setDay(q.to.day, q.to.slot, swapIn(who(q.to.day, q.to.slot), q.to.userId, q.byUserId));
      if (q.kind === 'swap') setDay(q.from.day, q.from.slot, swapIn(who(q.from.day, q.from.slot), q.byUserId, q.to.userId));
    }
    Object.assign(q, { status: approve ? 'approved' : 'declined', decidedAt: now(), decidedBy: req.user.name });
    await store.save();
    res.json({ request: requestOut(q) });
  });

  // For the app's home screen and bell
  function summary(u) {
    const out = {};
    if (isWorker(u.id)) {
      const next = [];
      for (let i = 0; i < 7 && next.length < 2; i++) {
        const day = H.addDays(today(), i);
        SLOTS.forEach((slot) => { if (who(day, slot).includes(u.id)) next.push(slotLabel(day, slot)); });
      }
      out.nextShifts = next.slice(0, 2);
      out.shiftAnswers = db.shiftRequests.filter((q) => q.byUserId === u.id && ['approved', 'declined'].includes(q.status)
        && q.decidedAt > new Date(Date.now() - 2 * 864e5).toISOString()).map(requestOut);
    }
    if (isLead(u)) out.shiftRequests = db.shiftRequests.filter((q) => q.status === 'pending').length;
    return out;
  }

  return { summary };
};
