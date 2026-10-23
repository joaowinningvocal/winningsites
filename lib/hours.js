/* Time clock: Las Vegas dates, worked time, flags and the daily/weekly reports.
   All "days" are Las Vegas calendar days (America/Los_Angeles). */
const TZ = 'America/Los_Angeles';
const MISSING_OUT_HOURS = 16;

const parts = (d, opts) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', ...opts })
  .formatToParts(d).map((p) => [p.type, p.value]));
const laDay = (d = new Date()) => { const p = parts(new Date(d), { year: 'numeric', month: '2-digit', day: '2-digit' }); return `${p.year}-${p.month}-${p.day}`; };
const laHM = (d = new Date()) => { const p = parts(new Date(d), { hour: '2-digit', minute: '2-digit' }); return `${p.hour}:${p.minute}`; };
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '');
const fmtDay = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// First day of the pay week that contains `day` (weekStart: 0 = Sunday ... 1 = Monday)
const weekOf = (day, weekStart = 1) => { const wd = new Date(day + 'T12:00:00Z').getUTCDay(); return addDays(day, -((wd - weekStart + 7) % 7)); };

const away = (m) => (m < 1609 ? `${Math.round(m * 3.281)} ft` : `${(m / 1609).toFixed(1)} miles`);
const mins = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 60000);
const hhmm = (m) => `${Math.floor(Math.round(m) / 60)}h ${String(Math.round(m) % 60).padStart(2, '0')}m`;
const decimal = (m) => (Math.round((m / 60) * 100) / 100).toFixed(2);

function breakMinutes(shift, now = new Date()) {
  if (typeof shift.breakOverride === 'number') return shift.breakOverride;
  const end = shift.out ? shift.out.at : now.toISOString();
  return shift.breaks.reduce((t, b) => t + mins(b.start, b.end || end), 0);
}

function workedMinutes(shift, now = new Date()) {
  const end = shift.out ? shift.out.at : now.toISOString();
  return Math.max(0, mins(shift.in.at, end) - breakMinutes(shift, now));
}

function checklistStats(shift) {
  const items = (shift.checklist || []).flatMap((s) => s.items);
  return { done: items.filter((i) => i.done).length, total: items.length };
}

function flags(shift, now = new Date()) {
  const f = [];
  if (!shift.out && mins(shift.in.at, now) > MISSING_OUT_HOURS * 60) f.push('No clock-out');
  if (shift.in.geo === 'unchecked') f.push('Clock-in location not checked');
  if (shift.out && shift.out.geo === 'outside') f.push(`Clocked out ${away(shift.out.distance)} from the ranch`);
  const c = checklistStats(shift);
  if (shift.out && c.total && c.done < c.total) f.push(`Checklist ${c.done}/${c.total}`);
  if (shift.edits && shift.edits.length) f.push('Edited by a manager');
  if (shift.manual) f.push('Added by a manager');
  return f;
}

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function shiftRows(shifts, users, now) {
  return shifts.map((s) => {
    const u = users.find((x) => x.id === s.userId) || { name: 'Unknown' };
    return { s, name: u.name, worked: workedMinutes(s, now), breaks: breakMinutes(s, now), flags: flags(s, now), checklist: checklistStats(s) };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.s.in.at.localeCompare(b.s.in.at));
}

const STYLE = 'font-family:Arial,sans-serif;color:#111';
const TABLE = 'border-collapse:collapse;width:100%;font-size:14px';
const TH = 'text-align:left;padding:6px 8px;border-bottom:2px solid #111;background:#f6f0e5';
const TD = 'padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top';

function dailyReport({ day, shifts, users, now = new Date() }) {
  const rows = shiftRows(shifts.filter((s) => s.day === day), users, now);
  const total = rows.reduce((t, r) => t + r.worked, 0);
  const notes = rows.flatMap((r) => (r.s.notes || []).map((n) => ({ ...n, name: r.name })));
  const html = `<div style="${STYLE}">
    <h2 style="margin:0 0 4px">Winning Ranch hours, ${esc(fmtDay(day))}</h2>
    <p style="margin:0 0 16px;color:#555">${rows.length} shift${rows.length === 1 ? '' : 's'}, ${hhmm(total)} worked in total. For spot checks; payroll uses the weekly report.</p>
    ${rows.length ? `<table style="${TABLE}"><tr><th style="${TH}">Name</th><th style="${TH}">In</th><th style="${TH}">Out</th><th style="${TH}">Breaks</th><th style="${TH}">Worked</th><th style="${TH}">Checklist</th><th style="${TH}">Check</th></tr>
      ${rows.map((r) => `<tr><td style="${TD}"><b>${esc(r.name)}</b></td><td style="${TD}">${esc(fmtTime(r.s.in.at))}</td><td style="${TD}">${r.s.out ? esc(fmtTime(r.s.out.at)) : '<b style="color:#A71B21">still on</b>'}</td>
        <td style="${TD}">${Math.round(r.breaks)} min</td><td style="${TD}"><b>${hhmm(r.worked)}</b></td><td style="${TD}">${r.checklist.total ? `${r.checklist.done}/${r.checklist.total}` : ''}</td>
        <td style="${TD};color:${r.flags.length ? '#A71B21' : '#1f6b3a'}">${r.flags.length ? esc(r.flags.join('; ')) : 'OK'}</td></tr>`).join('')}</table>` : '<p>No one clocked in.</p>'}
    ${notes.length ? `<h3 style="margin:22px 0 6px">Notes from the shift</h3><ul style="padding-left:18px;margin:0">${notes.map((n) => `<li style="margin:4px 0">${n.urgent ? '<b style="color:#A71B21">Urgent</b> ' : ''}<b>${esc(n.name)}</b>, ${esc(fmtTime(n.at))}: ${esc(n.text)}</li>`).join('')}</ul>` : ''}
  </div>`;
  return { subject: `Ranch hours for ${fmtDay(day)}: ${hhmm(total)} worked${rows.some((r) => r.flags.length) ? ', check flagged shifts' : ''}`, html, rows };
}

function weeklyReport({ start, shifts, users, now = new Date() }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rows = shiftRows(shifts.filter((s) => days.includes(s.day)), users, now);
  const people = [...new Set(rows.map((r) => r.name))].sort();
  const per = people.map((name) => {
    const mine = rows.filter((r) => r.name === name);
    const byDay = days.map((d) => mine.filter((r) => r.s.day === d).reduce((t, r) => t + r.worked, 0));
    const total = byDay.reduce((a, b) => a + b, 0);
    return { name, byDay, total, flagged: mine.filter((r) => r.flags.length).length, over8: byDay.filter((m) => m > 480).length };
  });
  const end = days[6];
  const html = `<div style="${STYLE}">
    <h2 style="margin:0 0 4px">Winning Ranch payroll hours</h2>
    <p style="margin:0 0 16px;color:#555">${esc(fmtDay(start))} to ${esc(fmtDay(end))}. Hours are worked time with breaks taken out. The CSV attached has every shift.</p>
    ${per.length ? `<table style="${TABLE}"><tr><th style="${TH}">Name</th>${days.map((d) => `<th style="${TH}">${esc(fmtDay(d).split(',')[0])}</th>`).join('')}<th style="${TH}">Total hours</th><th style="${TH}">Check</th></tr>
      ${per.map((p) => `<tr><td style="${TD}"><b>${esc(p.name)}</b></td>${p.byDay.map((m) => `<td style="${TD}">${m ? decimal(m) : ''}</td>`).join('')}
        <td style="${TD}"><b>${decimal(p.total)}</b></td><td style="${TD};color:${p.flagged || p.total > 2400 || p.over8 ? '#A71B21' : '#1f6b3a'}">${[p.flagged ? `${p.flagged} flagged shift${p.flagged === 1 ? '' : 's'}` : '', p.total > 2400 ? 'Over 40 h' : '', p.over8 ? `${p.over8} day${p.over8 === 1 ? '' : 's'} over 8 h` : ''].filter(Boolean).join('; ') || 'OK'}</td></tr>`).join('')}</table>`
      : '<p>No hours this week.</p>'}
  </div>`;
  const csv = [['Name', 'Date', 'Clock in', 'Clock out', 'Break minutes', 'Hours worked', 'Checklist', 'Flags'].join(',')]
    .concat(rows.map((r) => [r.name, r.s.day, fmtTime(r.s.in.at), r.s.out ? fmtTime(r.s.out.at) : 'missing', Math.round(r.breaks), decimal(r.worked),
      r.checklist.total ? `${r.checklist.done}/${r.checklist.total}` : '', r.flags.join('; ')].map(csvCell).join(','))).join('\n');
  return { subject: `Payroll hours, ${fmtDay(start)} to ${fmtDay(end)}`, html, csv, per };
}

// Checklist text format: "# Section" lines start a section, every other non-empty line is an item
function parseChecklist(text) {
  const sections = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^[\s☐\-*•]+/, '').trim();
    if (!line) continue;
    if (/^#/.test(raw.trim())) sections.push({ title: line.replace(/^#+\s*/, ''), items: [] });
    else { if (!sections.length) sections.push({ title: 'Tasks', items: [] }); sections[sections.length - 1].items.push(line); }
  }
  return sections.filter((s) => s.items.length);
}

const DEFAULT_CHECKLIST = `# Beginning-of-shift welfare check
Visually check every horse upon arrival.
Confirm each horse is alert and behaving normally.
Check for injuries, swelling, lameness, or signs of illness.
Check water availability and hay/food as applicable.
Report any concerns or abnormalities to management immediately.

# Stall cleaning and bedding
Muck each stall thoroughly.
Sweep stall floors and remove loose debris.
Arrange and level existing shavings.
Add shavings or pellets as needed.
Ensure bedding is clean, dry, comfortable, and evenly distributed.
Leave stall fronts and surrounding aisles clean and tidy.

# Water buckets
Empty and scrub water buckets.
Rinse thoroughly.
Refill with clean, fresh water.
Confirm buckets are secure.

# Fly and seasonal care
Put on or remove fly masks according to owner instructions.
Apply fly spray according to owner instructions.
Check fly masks for proper fit, cleanliness, and rubbing.
Put on or remove blankets according to each horse's care instructions.
Confirm blankets fit properly and are secured without twisting or rubbing.

# Final stall safety check
Confirm stall doors are properly closed and latched.
Check that gates, clips, and closures are secure.
Ensure no tools, manure forks, or cleaning supplies are left within horses' reach.
Confirm water buckets are secure and bedding is safe.
Leave each stall and the surrounding area clean and presentable.

# End-of-shift review
Recheck horses for comfort and general well-being.
Confirm all assigned care instructions have been completed.
Report injuries, unusual behavior, supply needs, or incomplete tasks.
Communicate important updates to the next staff member or manager.`;

// Distance in meters between two lat/lng points
function distanceM(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { TZ, laDay, laHM, fmtTime, fmtDay, addDays, weekOf, workedMinutes, breakMinutes, checklistStats, flags, hhmm, decimal, dailyReport, weeklyReport, parseChecklist, DEFAULT_CHECKLIST, distanceM };
