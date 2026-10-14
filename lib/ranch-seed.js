/* Stall layout traced from img/ranch-map.jpg (1448 x 1086 px).
   Shapes are in map pixels; the front end scales them with the image.
   If the map art changes, update these numbers (or re-trace in the staff app). */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function mainBarn() {
  const rows = [[19, 20], [17, 18], [15, 16], [13, 14], [11, 12], [9, 10], [7, 8], [5, 6], [3, 4], [1, 2]];
  const ys = [92, 130, 171, 212, 255, 297, 340, 382, 425, 467, 512];
  const cols = [{ x0: 314, x1: 390 }, { x0: 465, x1: 540 }];
  const out = [];
  rows.forEach((pair, r) => {
    pair.forEach((n, c) => {
      const notInUse = n === 1 || n === 2;
      const smaller = n === 20;
      out.push({
        id: 'M' + n,
        group: 'main',
        number: n,
        name: `Barn stall ${n}`,
        shape: { x: cols[c].x0 + 2, y: ys[r] + 2, w: cols[c].x1 - cols[c].x0 - 4, h: ys[r + 1] - ys[r] - 4 },
        status: notInUse ? 'unavailable' : 'available',
        smaller,
        size: '',
        nightly: null,
        monthly: null,
        description: notInUse
          ? 'Not in use right now.'
          : smaller
            ? 'Indoor stall at the end of the main barn. Slightly smaller than the others.'
            : 'Indoor stall in the main barn, off the center aisle.',
        photos: [],
      });
    });
  });
  return out;
}

function outdoor() {
  const xs = [771, 830, 887, 946, 1007, 1069, 1131, 1192, 1257];
  const numbers = [8, 7, 6, 5, 4, 3, 2, 1]; // left to right on the map
  return numbers.map((n, i) => ({
    id: 'O' + n,
    group: 'outdoor',
    number: n,
    name: `Outdoor stall ${n}`,
    shape: { x: xs[i] + 2, y: 678, w: xs[i + 1] - xs[i] - 4, h: 76 },
    status: 'available',
    smaller: false,
    size: '',
    nightly: null,
    monthly: null,
    description: 'Covered outdoor stall along the drive, near the outdoor bathroom.',
    photos: [],
  }));
}

function seedStalls() {
  return [...mainBarn(), ...outdoor()];
}

// Optional demo account so the owner portal can be reviewed before real data exists.
// Turned on with SEED_DEMO=1. Remove the env var (and the demo user) before launch.
function seedDemo(store, auth, uploadsDir) {
  const db = store.data;
  if (db.users.some((u) => u.email === 'demo@winningranch.com')) return;
  const id = () => crypto.randomBytes(8).toString('hex');
  const owner = { id: id(), name: 'Demo Owner', email: 'demo@winningranch.com', phone: '', role: 'owner', password: auth.hashPassword('demo-ranch'), active: true, createdAt: new Date().toISOString() };
  db.users.push(owner);
  const horse = { id: id(), name: 'Dakota', breed: 'Quarter Horse', ownerId: owner.id, stallId: 'M14', arrivedOn: '2026-09-01', notes: '', active: true, createdAt: new Date().toISOString() };
  db.horses.push(horse);

  // Demo "photo": the stall on the map, so the feed shows a picture
  const media = [];
  const src = path.join(__dirname, '..', 'sites', 'ranch', 'img', 'ranch-map-small.jpg');
  if (fs.existsSync(src)) {
    const name = id() + '.jpg';
    fs.copyFileSync(src, path.join(uploadsDir, 'private', name));
    media.push({ file: name, type: 'image', mime: 'image/jpeg' });
  }
  const day = (d) => new Date(Date.now() - d * 864e5).toISOString();
  db.updates.push(
    { id: id(), horseId: horse.id, caption: 'Dakota settled into stall 14 today. Ate all his hay and is relaxed.', media, authorName: 'Jenna', authorId: null, createdAt: day(3) },
    { id: id(), horseId: horse.id, caption: 'Thirty minutes in round pen 1 this morning. Moving well.', media: [], authorName: 'Jenna', authorId: null, createdAt: day(1) },
    { id: id(), horseId: horse.id, caption: 'Farrier visit done. All four shoes reset.', media: [], authorName: 'Ranch team', authorId: null, createdAt: day(0.1) },
  );
  store.save();
  console.log('[seed] demo owner created: demo@winningranch.com / demo-ranch');
}

module.exports = { seedStalls, seedDemo };
