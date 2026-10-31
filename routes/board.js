/* Stall board (dashboard #/board): who is in which stall on which day.
   A "stay" is a booking the team makes itself (db.bookings with source 'staff' or 'ai'):
   - monthly boarders: from a start day, no end until someone ends it
   - nightly guests: arrival day to departure day
   - ours: one of the ranch's own horses. It holds the stall but can move to the other ranch,
     so the website still offers the stall and new bookings may go over it (with a warning).
   Confirmed and pending requests from the website block stalls here too.
   Every named horse on a stay is also a horse in the Horses tab (stay.horseIds, one per stall):
   the board decides where a horse is, the Horses tab and the owner's app read it from here.
   The Stall assistant (lib/stall-ai.js) uses the same functions as the board. */
const P = require('../lib/stall-planner');
const AI = require('../lib/stall-ai');

const END = '9999-12-31';
const KINDS = ['nightly', 'monthly'];
const MAX_PHONES = 3;

module.exports = function board({ staff, db, store, newId, now, str, isDate, stallById, horseInStall, HOLDS }) {
  const holds = (b) => HOLDS.has(b.status);
  const endOf = (b) => b.to || END;
  const overlaps = (b, from, to) => b.from < (to || END) && from < endOf(b);
  const isStay = (b) => b.source === 'staff' || b.source === 'ai';
  // The unnamed boarders and horses loaded from Jenna's barn sheet: a new booking in their stall replaces them
  const isPlaceholder = (b) => isStay(b) && b.createdBy === 'Barn sheet' && !b.name && !(b.horses || []).some(Boolean);
  const stallLabel = (id) => { const s = stallById(id); return s ? (s.group === 'main' ? `stall ${s.number}` : `outdoor stall ${s.number}`) : id; };
  const Cap = (t) => t[0].toUpperCase() + t.slice(1);
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const nightsOf = (from, to) => (to ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) : null);
  const who = (b) => b.name || (b.horses || []).filter(Boolean).join(', ') || (b.ours ? 'Our horse' : 'Boarder');
  // The horse in one stall of a booking, else who the booking is for
  const whoIn = (b, stallId) => (b.horses || [])[b.stallIds.indexOf(stallId)] || who(b);
  const phonesOf = (b) => (Array.isArray(b.phones) && b.phones.length ? b.phones : b.phone ? [b.phone] : []);

  // What holds a stall between from and to: hard = can't book over it, ours = our horse that can move
  function holdsOn(stallId, from, to, ignoreId, { skipPlaceholders = false } = {}) {
    const hard = [], ours = [], placeholders = [];
    const h = horseInStall(stallId);
    if (h) hard.push({ horse: h.name });
    for (const b of db.bookings) {
      if (b.id === ignoreId || !holds(b) || !b.stallIds.includes(stallId) || !overlaps(b, from, to)) continue;
      if (skipPlaceholders && isPlaceholder(b)) { placeholders.push(b); continue; }
      (b.ours ? ours : hard).push(b);
    }
    return { hard, ours, placeholders };
  }

  const stallOut = (s) => ({ id: s.id, group: s.group, number: s.number, name: s.name, status: s.status, ponyOnly: !!s.ponyOnly, smaller: !!s.smaller, size: s.size, ...P.place(s) });

  const stayOut = (b) => ({
    id: b.id, ref: b.ref, status: b.status, kind: b.kind || 'nightly', source: b.source || 'web', ours: !!b.ours,
    stallIds: b.stallIds, horses: b.horses || [], ponies: b.ponies || [], horseIds: b.horseIds || [],
    from: b.from, to: b.to || null, nights: nightsOf(b.from, b.to),
    name: b.name || '', phone: phonesOf(b)[0] || '', phones: phonesOf(b), email: b.email || '', notes: isStay(b) ? b.notes || '' : b.staffNote || '',
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
    const horseIds = stallIds.map((_, i) => { const id = String(list('horseIds')[i] || ''); return db.horses.some((h) => h.id === id) ? id : ''; });
    const ours = has('ours') ? !!b.ours : !!cur.ours;
    const phones = (has('phones') ? (Array.isArray(b.phones) ? b.phones : []) : has('phone') ? [b.phone] : phonesOf(cur))
      .map((p) => str(p, 40)).filter(Boolean).slice(0, MAX_PHONES);

    for (const [i, id] of stallIds.entries()) {
      const s = stallById(id);
      if (!s) return { error: 'One of those stalls doesn’t exist.' };
      if (s.status !== 'available') return { error: `${s.name} isn’t in use. Turn it on in Stalls first.` };
      if (s.ponyOnly && !ponies[i]) return { error: `${s.name} is for ponies only. Mark the horse as a pony or pick another stall.` };
    }
    const warnings = [];
    const replaces = [];
    for (const id of stallIds) {
      const { hard, ours: soft, placeholders } = holdsOn(id, from, to, cur.id, { skipPlaceholders: true });
      replaces.push(...placeholders.map((x) => x.id));
      if (hard.length) {
        const x = hard[0];
        return { error: x.horse ? `${x.horse} is in ${stallLabel(id)} (Horses tab). Move or remove that horse first.`
          : `${Cap(stallLabel(id))} is taken by ${whoIn(x, id)} (${x.ref}) ${x.to ? `until ${x.to}` : 'with no end date'}.`, stallId: id, conflict: true };
      }
      if (soft.length && ours) return { error: `${Cap(stallLabel(id))} already has one of our horses then: ${whoIn(soft[0], id)} (${soft[0].ref}). Edit that one instead, or remove it first.`, stallId: id, conflict: true };
      if (soft.length) warnings.push(`Move our horse out of ${stallLabel(id)} (${whoIn(soft[0], id)}).`);
    }
    const text = (k, max) => (has(k) ? str(b[k], max) : cur[k] || '');
    return {
      fields: { kind, from, to, stallIds, horses, ponies, horseIds, ours, phones, phone: phones[0] || '',
        name: text('name', 100), email: text('email', 160).toLowerCase(), notes: text('notes', 1000) },
      warnings,
      replaces: [...new Set(replaces)],
    };
  }

  // A booking in a stall takes over the barn-sheet placeholder that was holding it
  function retirePlaceholders(ids, by) {
    for (const id of ids) {
      const p = db.bookings.find((x) => x.id === id);
      if (p && holds(p) && isPlaceholder(p)) Object.assign(p, { status: 'cancelled', updatedAt: now(), updatedBy: by.name, replacedBy: 'board' });
    }
  }

  // ---------------------------------------------------------------- horses: every named horse on a stay is a horse in the Horses tab
  // (a horse already in the Horses tab with no stall now is reused instead of making a second one with the same name)
  function linkedStays(horseId) {
    return db.bookings.filter((b) => holds(b) && (b.horseIds || []).includes(horseId));
  }

  function syncHorses(stay) {
    stay.horseIds = stay.stallIds.map((_, i) => (stay.horseIds || [])[i] || '');
    stay.stallIds.forEach((_, i) => {
      const name = stay.horses[i];
      let h = stay.horseIds[i] && db.horses.find((x) => x.id === stay.horseIds[i]);
      if (!name) { stay.horseIds[i] = ''; return; }
      if (!h) {
        h = db.horses.find((x) => x.active !== false && !x.demo && x.name.toLowerCase() === name.toLowerCase() && !x.stallId
          && !linkedStays(x.id).some((b) => b.id !== stay.id && overlaps(b, stay.from, stay.to)));
      }
      if (!h) {
        h = { id: newId(), name, breed: '', notes: '', arrivedOn: stay.from, ownerId: '', stallId: '', active: true, createdAt: now(), fromBoard: true };
        db.horses.push(h);
      }
      h.name = name;
      h.active = true;
      h.pony = !!stay.ponies[i];
      h.ours = !!stay.ours;
      if (stay.name) h.ownerName = stay.name;
      if (phonesOf(stay).length) h.ownerPhones = phonesOf(stay);
      stay.horseIds[i] = h.id;
    });
  }

  // Where a horse is: the stay that holds it today, else its next one
  function placeOf(horseId, day = today()) {
    const list = linkedStays(horseId).filter((b) => endOf(b) > day).sort((a, b) => a.from.localeCompare(b.from));
    const b = list.find((x) => x.from <= day) || list[0];
    if (!b) return null;
    const i = b.horseIds.indexOf(horseId);
    return { stay: b, index: i, stallId: b.stallIds[i], from: b.from, to: b.to || null, now: b.from <= day };
  }
  const stallOfHorse = (h) => { const p = placeOf(h.id); return p ? p.stallId : h.stallId || ''; };

  // Take one horse out of its stay: the whole stay ends (or goes) when it was alone, else just that stall
  function takeOut(place, by) {
    const b = place.stay, day = today();
    if (b.stallIds.length > 1) {
      for (const k of ['stallIds', 'horses', 'ponies', 'horseIds']) if (Array.isArray(b[k])) b[k].splice(place.index, 1);
    } else if (b.from >= day) b.status = 'cancelled';
    else if (!b.to || b.to > day) { b.to = day; b.nights = nightsOf(b.from, b.to); }
    Object.assign(b, { updatedAt: now(), updatedBy: by.name });
  }

  // The Horses tab sets a horse's stall: move it, take it out, or give it a monthly stay of its own
  function placeHorse(h, stallId, by) {
    const place = placeOf(h.id);
    if (!stallId) { if (place) takeOut(place, by); return null; }
    if (place && place.stallId === stallId) return null;
    if (place) {
      const b = place.stay, before = b.stallIds.slice();
      b.stallIds[place.index] = stallId;
      const r = readStay({}, b);
      if (r.error) { b.stallIds = before; return r.error; }
      retirePlaceholders(r.replaces, by);
      Object.assign(b, { updatedAt: now(), updatedBy: by.name });
      return null;
    }
    const owner = db.users.find((u) => u.id === h.ownerId);
    const r = readStay({ kind: 'monthly', from: h.arrivedOn && h.arrivedOn <= today() ? h.arrivedOn : today(), to: null, stallIds: [stallId],
      horses: [h.name], ponies: [!!h.pony], horseIds: [h.id], ours: !!h.ours, name: (owner && owner.name) || h.ownerName || '',
      phones: h.ownerPhones || (owner && owner.phone ? [owner.phone] : []) }, null);
    if (r.error) return r.error;
    retirePlaceholders(r.replaces, by);
    createStay(r.fields, by, 'staff');
    return null;
  }

  function createStay(fields, by, source) {
    db.seq.booking += 1;
    const b = {
      id: newId(), ref: 'WR' + db.seq.booking, status: 'confirmed', source,
      ...fields, nights: nightsOf(fields.from, fields.to), care: 'full', parking: false, estimate: null, staffNote: '',
      createdBy: by.name, createdById: by.id, createdAt: now(), updatedAt: now(),
    };
    db.bookings.push(b);
    syncHorses(b);
    return b;
  }

  // ---------------------------------------------------------------- moving horses between stalls (drag and drop on the board)
  // What a stall shows on a day: a horse from the Horses tab, a booking, or one of our horses
  function shownIn(stallId, day) {
    const h = horseInStall(stallId);
    if (h) return { horse: h };
    const here = db.bookings.filter((b) => holds(b) && b.stallIds.includes(stallId) && overlaps(b, day, addDays(day, 1)));
    const stay = here.find((b) => !b.ours) || here.find((b) => b.ours);
    return stay ? { stay } : null;
  }

  // Moves what is in `fromId` to `toId`; whatever is in `toId` goes the other way (a swap)
  function moveHorse(fromId, toId, day, by) {
    if (fromId === toId) return { error: 'Drop it on another stall.' };
    const dest = stallById(toId);
    if (!dest) return { error: 'That stall doesn’t exist.' };
    if (dest.status !== 'available') return { error: `${dest.name} isn’t in use.` };
    const a = shownIn(fromId, day);
    if (!a) return { error: 'There’s no horse in that stall.' };
    const b = shownIn(toId, day);
    for (const x of [a, b]) if (x && x.stay && !isStay(x.stay)) return { error: 'That’s a booking from the website. Change its stalls in Bookings.' };

    // Work out every change first (two horses of one group can trade places too), then check, then keep or undo
    const changes = [[a, fromId, toId], ...(b ? [[b, toId, fromId]] : [])].map(([occ, oldId, newId2]) => (occ.horse
      ? { horse: occ.horse, newId: newId2 }
      : { stay: occ.stay, index: occ.stay.stallIds.indexOf(oldId), newId: newId2 }));
    const saved = changes.map((c) => (c.horse ? c.horse.stallId : c.stay.stallIds.slice()));
    for (const c of changes) { if (c.horse) c.horse.stallId = c.newId; else c.stay.stallIds[c.index] = c.newId; }

    let error = null;
    const replaces = [];
    for (const c of changes) {
      if (c.horse) {
        const s = stallById(c.newId);
        if (s.ponyOnly) error = `${s.name} is for ponies only.`;
        const clash = db.bookings.find((x) => holds(x) && !x.ours && x.stallIds.includes(c.newId) && endOf(x) > day && !isPlaceholder(x));
        if (clash) error = `${Cap(stallLabel(c.newId))} is taken by ${whoIn(clash, c.newId)} (${clash.ref}).`;
      } else {
        const r = readStay({}, c.stay);
        if (r.error) error = r.error;
        else replaces.push(...r.replaces);
      }
      if (error) break;
    }
    if (error) {
      changes.forEach((c, i) => { if (c.horse) c.horse.stallId = saved[i]; else c.stay.stallIds = saved[i]; });
      return { error };
    }
    retirePlaceholders(replaces, by);
    for (const c of changes) if (c.stay) Object.assign(c.stay, { updatedAt: now(), updatedBy: by.name });
    const name = (x, id) => (x.horse ? x.horse.name : x.stay.horses[x.stay.stallIds.indexOf(id)] || who(x.stay));
    return { moved: `${name(a, toId)} to ${stallLabel(toId)}${b ? `, ${name(b, fromId)} to ${stallLabel(fromId)}` : ''}` };
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

  // ---------------------------------------------------------------- one-time fixes for data already on the board
  {
    let changed = false;
    // Horses the Horses tab had put straight into a stall become monthly stays, so the board is the one place that says where a horse is
    if (!db.migrations['horses-onto-board']) {
      for (const h of db.horses.filter((x) => x.active !== false && x.stallId && stallById(x.stallId))) {
        if (linkedStays(h.id).length) continue;
        const keep = h.stallId;
        h.stallId = '';
        const owner = db.users.find((u) => u.id === h.ownerId);
        const r = readStay({ kind: 'monthly', from: h.arrivedOn && isDate(h.arrivedOn) ? h.arrivedOn : today(), to: null, stallIds: [keep],
          horses: [h.name], ponies: [false], horseIds: [h.id], name: owner ? owner.name : '', phones: owner && owner.phone ? [owner.phone] : [] }, null);
        if (r.error) { h.stallId = keep; continue; } // stays as it was if the board already has someone there
        retirePlaceholders(r.replaces, { name: 'Horses tab' });
        createStay(r.fields, { name: 'Horses tab', id: null }, 'staff');
      }
      db.migrations['horses-onto-board'] = now();
      changed = true;
    }
    // Named horses on the board get their place in the Horses tab
    if (!db.migrations['board-horses-to-horses-tab']) {
      for (const b of db.bookings.filter((x) => holds(x) && isStay(x))) syncHorses(b);
      db.migrations['board-horses-to-horses-tab'] = now();
      changed = true;
    }
    // A barn-sheet placeholder sharing its stall with a real booking was meant to be replaced (stall 13: Hebe)
    if (!db.migrations['retire-shadowed-placeholders']) {
      for (const p of db.bookings.filter((x) => holds(x) && isPlaceholder(x))) {
        const shadowed = db.bookings.some((x) => x !== p && holds(x) && !isPlaceholder(x) && x.stallIds.some((id) => p.stallIds.includes(id)) && overlaps(x, p.from, p.to));
        if (shadowed) Object.assign(p, { status: 'cancelled', updatedAt: now(), updatedBy: 'Stall board', replacedBy: 'board' });
      }
      db.migrations['retire-shadowed-placeholders'] = now();
      changed = true;
    }
    if (changed) store.save();
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
    const { error, conflict, fields, warnings, stallId, replaces } = readStay(req.body || {}, null);
    if (error) return res.status(conflict ? 409 : 400).json({ error, stallId });
    retirePlaceholders(replaces, req.user);
    const b = createStay(fields, req.user, 'staff');
    await store.save();
    res.status(201).json({ stay: stayOut(b), warnings });
  });

  staff.patch('/stays/:id', async (req, res) => {
    const cur = db.bookings.find((x) => x.id === req.params.id && holds(x));
    if (!cur) return res.status(404).json({ error: 'Booking not found.' });
    if (!isStay(cur)) return res.status(400).json({ error: 'That’s a request from the website. Change it in Bookings.' });
    const { error, conflict, fields, warnings, stallId, replaces } = readStay(req.body || {}, cur);
    if (error) return res.status(conflict ? 409 : 400).json({ error, stallId });
    retirePlaceholders(replaces, req.user);
    Object.assign(cur, fields, { nights: nightsOf(fields.from, fields.to), updatedAt: now(), updatedBy: req.user.name });
    syncHorses(cur);
    await store.save();
    res.json({ stay: stayOut(cur), warnings });
  });

  staff.post('/stays/move', async (req, res) => {
    const b = req.body || {};
    const out = moveHorse(String(b.from || ''), String(b.to || ''), isDate(b.day) ? b.day : today(), req.user);
    if (out.error) return res.status(409).json(out);
    await store.save();
    res.json(out);
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
        const { error, fields, warnings, replaces } = readStay({
          kind: input.kind, from: input.from, to: input.to || null, stallIds: input.stall_ids,
          horses: horses.map((h) => (h && h.name) || ''), ponies: horses.map((h) => !!(h && h.pony)),
          name: input.owner_name || '', phones: input.phone ? [input.phone] : [], notes: input.notes || '',
        }, null);
        if (error) return { error };
        retirePlaceholders(replaces, user);
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

  // Who is in a stall today, for the Stalls and Horses tabs
  function occupant(stallId) {
    const x = shownIn(stallId, today());
    if (!x) return null;
    if (x.horse) return { id: x.horse.id, name: x.horse.name, ours: false };
    const i = x.stay.stallIds.indexOf(stallId);
    return { id: (x.stay.horseIds || [])[i] || '', name: x.stay.horses[i] || who(x.stay), ours: !!x.stay.ours };
  }

  return { holdsOn, today, placeOf, stallOfHorse, placeHorse, occupant, syncHorses };
};
