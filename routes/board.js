/* Stall board (dashboard #/board): who is in which stall on which day.
   A "stay" is a booking the team makes itself (db.bookings with source 'staff' or 'ai'):
   - monthly boarders: from a start day, no end until someone ends it
   - nightly guests: arrival day to departure day
   - ours: one of the ranch's own horses. It holds the stall but can move to the other ranch,
     so the website still offers the stall and new bookings may go over it (with a warning).
   Confirmed and pending requests from the website block stalls here too.
   The Stall assistant (lib/stall-ai.js) uses the same functions as the board. */
const P = require('../lib/stall-planner');
const AI = require('../lib/stall-ai');

const END = '9999-12-31';
const KINDS = ['nightly', 'monthly'];

module.exports = function board({ staff, db, store, newId, now, str, isDate, stallById, horseInStall, HOLDS }) {
  const holds = (b) => HOLDS.has(b.status);
  const endOf = (b) => b.to || END;
  const overlaps = (b, from, to) => b.from < (to || END) && from < endOf(b);
  const isStay = (b) => b.source === 'staff' || b.source === 'ai';
  const stallLabel = (id) => { const s = stallById(id); return s ? (s.group === 'main' ? `stall ${s.number}` : `outdoor stall ${s.number}`) : id; };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const nightsOf = (from, to) => (to ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) : null);
  const who = (b) => b.name || (b.horses || []).filter(Boolean).join(', ') || (b.ours ? 'Our horse' : 'Boarder');

  // What holds a stall between from and to: hard = can't book over it, ours = our horse that can move
  function holdsOn(stallId, from, to, ignoreId) {
    const hard = [], ours = [];
    const h = horseInStall(stallId);
    if (h) hard.push({ horse: h.name });
    for (const b of db.bookings) {
      if (b.id === ignoreId || !holds(b) || !b.stallIds.includes(stallId) || !overlaps(b, from, to)) continue;
      (b.ours ? ours : hard).push(b);
    }
    return { hard, ours };
  }

  const stallOut = (s) => ({ id: s.id, group: s.group, number: s.number, name: s.name, status: s.status, ponyOnly: !!s.ponyOnly, smaller: !!s.smaller, size: s.size, ...P.place(s) });

  const stayOut = (b) => ({
    id: b.id, ref: b.ref, status: b.status, kind: b.kind || 'nightly', source: b.source || 'web', ours: !!b.ours,
    stallIds: b.stallIds, horses: b.horses || [], ponies: b.ponies || [], from: b.from, to: b.to || null, nights: nightsOf(b.from, b.to),
    name: b.name || '', phone: b.phone || '', email: b.email || '', notes: isStay(b) ? b.notes || '' : b.staffNote || '',
    createdBy: b.createdBy || '', createdAt: b.createdAt,
  });

  // ---------------------------------------------------------------- read and check a stay from the form or the assistant
  function readStay(b, current) {
    const cur = current || {};
    const has = (k) => k in b;
    const kind = KINDS.includes(b.kind) ? b.kind : current ? cur.kind || 'nightly' : null;
    if (!kind) return { error: 'Pick monthly or nightly.' };
    const from = has('from') ? b.from : cur.from;
    const to = (has('to') ? b.to : cur.to) || null;
    if (!isDate(from)) return { error: 'Pick the first day.' };
    if (to && !isDate(to)) return { error: 'The last day looks wrong.' };
    if (kind === 'nightly' && !to) return { error: 'Nightly stays need a departure day.' };
    if (to && to <= from) return { error: 'The departure day has to be after the arrival day.' };
    if (to && nightsOf(from, to) > 400) return { error: 'That’s more than a year. Use monthly with no end date.' };

    const list = (k) => (has(k) ? (Array.isArray(b[k]) ? b[k] : []) : cur[k] || []);
    const stallIds = [...new Set(list('stallIds').map(String))];
    if (!stallIds.length) return { error: 'Pick at least one stall.' };
    if (stallIds.length > 20) return { error: 'Up to 20 stalls at once.' };
    if (stallIds.length !== list('stallIds').length) return { error: 'Each horse needs its own stall.' };
    const horses = stallIds.map((_, i) => str(list('horses')[i], 80));
    const ponies = stallIds.map((_, i) => list('ponies')[i] === true);
    const ours = has('ours') ? !!b.ours : !!cur.ours;

    for (const [i, id] of stallIds.entries()) {
      const s = stallById(id);
      if (!s) return { error: 'One of those stalls doesn’t exist.' };
      if (s.status !== 'available') return { error: `${s.name} isn’t in use. Turn it on in Stalls first.` };
      if (s.ponyOnly && !ponies[i]) return { error: `${s.name} is for ponies only. Mark the horse as a pony or pick another stall.` };
    }
    const warnings = [];
    for (const id of stallIds) {
      const { hard, ours: soft } = holdsOn(id, from, to, cur.id);
      const Stall = stallLabel(id)[0].toUpperCase() + stallLabel(id).slice(1);
      if (hard.length) {
        const x = hard[0];
        return { error: x.horse ? `${x.horse} is in ${stallLabel(id)} (Horses tab). Move or remove that horse first.`
          : `${Stall} is taken by ${who(x)} (${x.ref}) ${x.to ? `until ${x.to}` : 'with no end date'}.`, stallId: id, conflict: true };
      }
      if (soft.length && ours) return { error: `${Stall} already has one of our horses then.`, stallId: id, conflict: true };
      if (soft.length) warnings.push(`Move our horse out of ${stallLabel(id)} (${who(soft[0])}).`);
    }
    const text = (k, max) => (has(k) ? str(b[k], max) : cur[k] || '');
    return {
      fields: { kind, from, to, stallIds, horses, ponies, ours,
        name: text('name', 100), phone: text('phone', 40), email: text('email', 160).toLowerCase(), notes: text('notes', 1000) },
      warnings,
    };
  }

  function createStay(fields, by, source) {
    db.seq.booking += 1;
    const b = {
      id: newId(), ref: 'WR' + db.seq.booking, status: 'confirmed', source,
      ...fields, nights: nightsOf(fields.from, fields.to), care: 'full', parking: false, estimate: null, staffNote: '',
      createdBy: by.name, createdById: by.id, createdAt: now(), updatedAt: now(),
    };
    db.bookings.push(b);
    return b;
  }

  // ---------------------------------------------------------------- planning: stalls free for the dates, closest together first
  function candidates(from, to, exclude = []) {
    return db.stalls.filter((s) => s.status === 'available' && !exclude.includes(s.id)).map((s) => {
      const { hard, ours } = holdsOn(s.id, from, to);
      return hard.length ? null : { stall: s, state: ours.length ? 'ours' : 'free' };
    }).filter(Boolean);
  }

  function planFor({ count, ponies, from, to, exclude }) {
    const n = Math.round(+count);
    if (!(n >= 1 && n <= 20)) return { error: 'How many horses? 1 to 20.' };
    if (!isDate(from)) return { error: 'Pick the arrival day.' };
    if (to && (!isDate(to) || to <= from)) return { error: 'The departure day has to be after the arrival day.' };
    const pool = candidates(from, to || null, exclude || []);
    const options = P.plan({ candidates: pool, count: n, ponies: Math.max(0, Math.round(+ponies || 0)) });
    return {
      options: options.map((o) => ({ stallIds: o.stalls.map((s) => s.id), note: o.note, ours: o.ours.map((s) => s.id), cost: o.cost })),
      free: pool.filter((c) => c.state === 'free').length,
      ours: pool.filter((c) => c.state === 'ours').length,
    };
  }

  // ---------------------------------------------------------------- the board
  staff.get('/board', (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : today();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 62);
    const to = addDays(from, days);
    res.json({
      today: today(), from, days,
      stalls: db.stalls.map(stallOut),
      stays: db.bookings.filter((b) => holds(b) && overlaps(b, from, to)).map(stayOut),
      horses: db.horses.filter((h) => h.active !== false && h.stallId).map((h) => ({ id: h.id, name: h.name, stallId: h.stallId, arrivedOn: h.arrivedOn || '', owner: (db.users.find((u) => u.id === h.ownerId) || {}).name || '' })),
      ai: AI.configured(),
    });
  });

  staff.post('/stays/plan', (req, res) => {
    const b = req.body || {};
    const out = planFor(b);
    if (out.error) return res.status(400).json(out);
    res.json(out);
  });

  staff.post('/stays', async (req, res) => {
    const { error, conflict, fields, warnings, stallId } = readStay(req.body || {}, null);
    if (error) return res.status(conflict ? 409 : 400).json({ error, stallId });
    const b = createStay(fields, req.user, 'staff');
    await store.save();
    res.status(201).json({ stay: stayOut(b), warnings });
  });

  staff.patch('/stays/:id', async (req, res) => {
    const cur = db.bookings.find((x) => x.id === req.params.id && holds(x));
    if (!cur) return res.status(404).json({ error: 'Booking not found.' });
    if (!isStay(cur)) return res.status(400).json({ error: 'That’s a request from the website. Change it in Bookings.' });
    const { error, conflict, fields, warnings, stallId } = readStay(req.body || {}, cur);
    if (error) return res.status(conflict ? 409 : 400).json({ error, stallId });
    Object.assign(cur, fields, { nights: nightsOf(fields.from, fields.to), updatedAt: now(), updatedBy: req.user.name });
    await store.save();
    res.json({ stay: stayOut(cur), warnings });
  });

  // Removing a stay keeps it in the records as cancelled
  staff.delete('/stays/:id', async (req, res) => {
    const cur = db.bookings.find((x) => x.id === req.params.id && holds(x));
    if (!cur) return res.status(404).json({ error: 'Booking not found.' });
    if (!isStay(cur)) return res.status(400).json({ error: 'That’s a request from the website. Cancel it in Bookings.' });
    Object.assign(cur, { status: 'cancelled', updatedAt: now(), updatedBy: req.user.name });
    await store.save();
    res.status(204).end();
  });

  // ---------------------------------------------------------------- the stall assistant
  function aiTools(user) {
    return {
      look_up_stalls: ({ from, to }) => {
        if (!isDate(from)) return { error: 'from must be YYYY-MM-DD' };
        const end = isDate(to) && to > from ? to : addDays(from, 1);
        return {
          from, to: end,
          stalls: db.stalls.slice().sort((a, b) => (a.group === b.group ? a.number - b.number : a.group === 'main' ? -1 : 1)).map((s) => {
            const base = { id: s.id, label: P.label(s), ...(s.ponyOnly ? { ponyOnly: true } : {}), ...(s.smaller ? { size: s.size || 'shorter' } : {}) };
            if (s.status !== 'available') return { ...base, state: 'not in use' };
            const { hard, ours } = holdsOn(s.id, from, end);
            if (hard.length) { const x = hard[0]; return { ...base, state: 'taken', by: x.horse || who(x), ref: x.ref, kind: x.kind || 'nightly', until: x.horse ? 'no end date' : x.to || 'no end date' }; }
            if (ours.length) return { ...base, state: 'ours', horse: who(ours[0]) };
            return { ...base, state: 'free' };
          }),
        };
      },
      find_stalls: ({ count, ponies, kind, from, to }) => {
        const out = planFor({ count, ponies, from, to: kind === 'monthly' && !to ? null : to });
        if (out.error) return out;
        if (!out.options.length) return { error: `Not enough stalls for ${count} horses then. ${out.free} free and ${out.ours} with our horses.` };
        return out;
      },
      book_stalls: (input) => {
        const horses = Array.isArray(input.horses) ? input.horses : [];
        const { error, fields, warnings } = readStay({
          kind: input.kind, from: input.from, to: input.to || null, stallIds: input.stall_ids,
          horses: horses.map((h) => (h && h.name) || ''), ponies: horses.map((h) => !!(h && h.pony)),
          name: input.owner_name || '', phone: input.phone || '', notes: input.notes || '',
        }, null);
        if (error) return { error };
        const b = createStay(fields, user, 'ai');
        return { ref: b.ref, stalls: fields.stallIds.map((id) => P.label(stallById(id))), from: b.from, to: b.to || 'no end date', warnings };
      },
      cancel_booking: ({ ref }) => {
        const b = db.bookings.find((x) => x.ref === String(ref || '').toUpperCase() && holds(x));
        if (!b) return { error: 'No open booking with that ref.' };
        if (!isStay(b)) return { error: 'That one came from the website. The office cancels it in Bookings.' };
        Object.assign(b, { status: 'cancelled', updatedAt: now(), updatedBy: user.name });
        return { cancelled: b.ref };
      },
    };
  }

  staff.post('/stays/ai', async (req, res) => {
    if (!AI.configured()) return res.status(503).json({ error: 'The assistant isn’t set up yet (ANTHROPIC_API_KEY on Railway). Use the form below.' });
    const message = str(req.body && req.body.message, 2000);
    if (!message) return res.status(400).json({ error: 'Write what you need, like “5 horses coming Nov 15 to Nov 17”.' });
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const day = new Date(today() + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    try {
      const out = await AI.ask({ message, history, today: `${day} (${today()})`, tools: aiTools(req.user) });
      await store.save();
      res.json({ ...out, stays: db.bookings.filter((b) => out.booked.includes(b.ref)).map(stayOut) });
    } catch (err) {
      await store.save(); // anything booked before the error stays booked and shows on the board
      console.error('[board] assistant failed:', err.message);
      const busy = err instanceof AI.APIError && (err.status === 429 || err.status >= 500);
      res.status(502).json({ error: busy ? 'The assistant is busy right now. Try again in a minute or use the form.' : 'The assistant couldn’t answer. Use the form below.' });
    }
  });

  return { holdsOn, today };
};
