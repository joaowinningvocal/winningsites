/* First-run data for the ranch: the 28 stalls and an optional demo owner.
   Where each stall sits on the map lives in lib/ranch-layout.js. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STALL_SIZE = "12' x 24'";

function mainBarn() {
  const out = [];
  for (let n = 1; n <= 20; n++) {
    const notInUse = n === 1 || n === 2;
    const smaller = n === 20;
    out.push({
      id: 'M' + n,
      group: 'main',
      number: n,
      name: `Barn stall ${n}`,
      status: notInUse ? 'unavailable' : 'available',
      smaller,
      size: smaller ? '' : STALL_SIZE,
      nightly: null,
      monthly: null,
      description: notInUse
        ? 'Not in use right now.'
        : smaller
          ? 'Indoor stall at the end of the main barn. Slightly smaller than the others.'
          : 'Indoor stall in the main barn, off the center aisle.',
      photos: [],
    });
  }
  return out;
}

function outdoor() {
  const out = [];
  for (let n = 1; n <= 8; n++) {
    out.push({
      id: 'O' + n,
      group: 'outdoor',
      number: n,
      name: `Outdoor stall ${n}`,
      status: 'available',
      smaller: false,
      size: STALL_SIZE,
      nightly: null,
      monthly: null,
      description: 'Covered outdoor stall along the drive, near the outdoor bathroom.',
      photos: [],
    });
  }
  return out;
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
  const src = path.join(__dirname, '..', 'public', 'img', 'ranch-map-small.jpg');
  if (fs.existsSync(src)) {
    const name = id() + '.jpg';
    fs.copyFileSync(src, path.join(uploadsDir, 'private', name));
    media.push({ file: name, type: 'image', mime: 'image/jpeg' });
  }
  const day = (d) => new Date(Date.now() - d * 864e5).toISOString();
  db.updates.push(
    { id: id(), horseId: horse.id, caption: 'Dakota settled into stall 14 today. Ate all his hay and is relaxed.', media, authorName: 'Ranch team', authorId: null, createdAt: day(3) },
    { id: id(), horseId: horse.id, caption: 'Thirty minutes in round pen 1 this morning. Moving well.', media: [], authorName: 'Ranch team', authorId: null, createdAt: day(1) },
    { id: id(), horseId: horse.id, caption: 'Farrier visit done. All four shoes reset.', media: [], authorName: 'Ranch team', authorId: null, createdAt: day(0.1) },
  );
  store.save();
  console.log('[seed] demo owner created: demo@winningranch.com / demo-ranch');
}

module.exports = { seedStalls, seedDemo, STALL_SIZE };
