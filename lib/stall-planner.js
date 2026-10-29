/* Where stalls are in the barn and how to pick stalls that sit close together.
   The barn (as the ranch numbers it): stalls 1-10 on the right side, 1 at the bottom;
   stalls 11-20 on the left side, 11 at the bottom, so stall n faces stall n + 10 across the aisle.
   Outdoor stalls 1-8 are one row along the drive, far from the barn.
   Horses that arrive together are bonded, so the planner keeps them as close as it can:
   side by side first, then facing each other across the aisle. */

// Position of a stall: zone, side (0 left, 1 right) and spot along the aisle (1 = bottom)
function place(s) {
  if (s.group === 'main') return s.number <= 10 ? { zone: 'barn', side: 1, pos: s.number } : { zone: 'barn', side: 0, pos: s.number - 10 };
  return { zone: 'outdoor', side: 0, pos: s.number };
}

// How far apart two stalls are: 1 = next door, 1.5 = facing across the aisle
function distance(a, b) {
  const pa = place(a), pb = place(b);
  if (pa.zone !== pb.zone) return 30;
  const along = Math.abs(pa.pos - pb.pos);
  return pa.side === pb.side ? along : along + 1.5;
}

// Total "spread" of a set: the length of the shortest tree joining them all (Prim)
function spread(stalls) {
  if (stalls.length < 2) return 0;
  const inTree = [stalls[0]];
  const rest = stalls.slice(1);
  let total = 0;
  while (rest.length) {
    let best = null;
    for (const r of rest) for (const t of inTree) {
      const d = distance(r, t);
      if (!best || d < best.d) best = { d, r };
    }
    total += best.d;
    inTree.push(best.r);
    rest.splice(rest.indexOf(best.r), 1);
  }
  return total;
}

const label = (s) => (s.group === 'main' ? String(s.number) : `Outdoor ${s.number}`);

// Plain words for a set of stalls: "stalls 4, 5, 6 (right side) and 14, 15 (left side, across the aisle)"
function describe(stalls) {
  const parts = [];
  const right = stalls.filter((s) => s.group === 'main' && s.number <= 10).map((s) => s.number).sort((a, b) => a - b);
  const left = stalls.filter((s) => s.group === 'main' && s.number > 10).map((s) => s.number).sort((a, b) => a - b);
  const out = stalls.filter((s) => s.group !== 'main').map((s) => s.number).sort((a, b) => a - b);
  if (right.length) parts.push(`${right.join(', ')} (right side)`);
  if (left.length) parts.push(`${left.join(', ')} (left side${right.length ? ', across the aisle' : ''})`);
  if (out.length) parts.push(`outdoor ${out.join(', ')}`);
  return `${stalls.length === 1 ? 'stall' : 'stalls'} ${parts.join(' and ')}`;
}

/* Pick stalls for `count` horses, `ponies` of them ponies.
   candidates: [{ stall, state: 'free' | 'ours' }] — stalls in use and not taken for the dates.
   'ours' means one of the ranch's own horses is there and would move to the other ranch.
   Returns up to 3 options, best first: { stalls (one per horse, ponies first), cost, ours: [stall], note } */
function plan({ candidates, count, ponies = 0 }) {
  ponies = Math.max(0, Math.min(ponies, count));
  const ponyOnly = (c) => !!c.stall.ponyOnly;
  const pool = candidates.filter((c) => !ponyOnly(c) || ponies > 0);
  if (pool.filter((c) => !ponyOnly(c)).length + Math.min(ponies, pool.filter(ponyOnly).length) < count) return [];

  const OURS_COST = 2.5; // moving one of our horses is worth about two stalls of distance
  const cost = (set) => spread(set.map((c) => c.stall)) + set.filter((c) => c.state === 'ours').length * OURS_COST;
  const fits = (set, c) => !ponyOnly(c) || set.filter(ponyOnly).length < ponies;

  const tried = new Map();
  for (const seed of pool) {
    for (const allowOurs of [false, true]) {
      if (!allowOurs && seed.state === 'ours') continue;
      const set = [seed];
      while (set.length < count) {
        let best = null;
        for (const c of pool) {
          if (set.includes(c) || !fits(set, c) || (!allowOurs && c.state === 'ours')) continue;
          const d = Math.min(...set.map((x) => distance(x.stall, c.stall))) + (c.state === 'ours' ? OURS_COST : 0);
          if (!best || d < best.d || (d === best.d && c.stall.number < best.c.stall.number)) best = { d, c };
        }
        if (!best) break;
        set.push(best.c);
      }
      if (set.length < count) continue;
      const key = set.map((c) => c.stall.id).sort().join(',');
      if (!tried.has(key)) tried.set(key, { set, cost: cost(set) });
    }
  }

  // Options that are really different: the best one for each mix of barn / outdoor and with or without our horses
  // (a group split between the barn and the outdoor row only shows when nothing keeps it in one place)
  const zones = (t) => [...new Set(t.set.map((c) => place(c.stall).zone))];
  const all = [...tried.values()].sort((a, b) => a.cost - b.cost);
  const together = all.filter((t) => zones(t).length === 1);
  const best = new Map();
  for (const t of together.length ? together : all) {
    const kind = zones(t).sort().join('+') + (t.set.some((c) => c.state === 'ours') ? '+ours' : '');
    if (!best.has(kind)) best.set(kind, t);
  }
  return [...best.values()].slice(0, 3).map(({ set, cost: c }) => {
    // Ponies get the pony-only stalls first, then the rest in barn order
    const order = set.slice().sort((a, b) => (ponyOnly(b) - ponyOnly(a)) || (a.stall.group === b.stall.group ? a.stall.number - b.stall.number : a.stall.group === 'main' ? -1 : 1));
    const stalls = order.map((x) => x.stall);
    const ours = order.filter((x) => x.state === 'ours').map((x) => x.stall);
    return { stalls, cost: Math.round(c * 10) / 10, ours, note: describe(stalls) };
  });
}

module.exports = { place, distance, spread, describe, plan, label };
