/* First-run data for the ranch: the 28 stalls and an optional demo owner.
   Where each stall sits on the map lives in lib/ranch-layout.js; where it sits in the barn
   (1-10 right side, 11-20 left side) in lib/stall-planner.js. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STALL_SIZE = "12' x 24'";

function mainBarn() {
  const out = [];
  for (let n = 1; n <= 20; n++) {
    const notInUse = n === 1;
    const smaller = n === 20;
    const ponyOnly = n === 10;
    out.push({
      id: 'M' + n,
      group: 'main',
      number: n,
      name: `Barn stall ${n}`,
      status: notInUse ? 'unavailable' : 'available',
      smaller,
      ponyOnly,
      size: smaller ? "12' x 22'" : STALL_SIZE,
      nightly: null,
      monthly: null,
      description: notInUse
        ? 'Not in use right now.'
        : smaller
          ? 'Indoor stall at the end of the main barn. Slightly smaller than the others.'
          : ponyOnly
            ? 'Indoor stall in the main barn, for ponies only.'
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

// Sign-in accounts for the App Store and Google Play review: horse owners with a sample horse and updates.
// Only the password hashes live here; the logins are in winningranchapp/credenciais-revisao-lojas.txt (not in git).
// They're marked demo: kept out of the Boarders chat, and their horse takes no stall and stays out of the team's Horses tab.
const REVIEW_ACCOUNTS = [
  { email: 'apple-review@winningranch.com', name: 'Apple Review', hash: 'scrypt$282b8c33d2434a7793c910840deba641$f34f246fc69fbc71e9994e2d2c2b973c3a87ba0142950b1f5341cd166a950da4604ad1c20740d79046afa95e35c7ff3c4bdd16c978b4064bbd7305cbcbd5b97c' },
  { email: 'google-review@winningranch.com', name: 'Google Review', hash: 'scrypt$9fc29842ff6ee75d32e5dddc29a507dd$b1cedc19d645d47f8c044fbbc04c376542064183b7c04f5da7233c2a848f7726ebcfb2439566638484f1510fdd6fea701dba9908b9463cc02b69f8a977549318' },
];

function seedReviewAccounts(store, uploadsDir) {
  const db = store.data;
  const id = () => crypto.randomBytes(8).toString('hex');
  const day = (d) => new Date(Date.now() - d * 864e5).toISOString();
  let changed = false;
  for (const a of REVIEW_ACCOUNTS) {
    let u = db.users.find((x) => x.email === a.email);
    if (u) {
      if (u.password !== a.hash || u.active === false || !u.demo) { Object.assign(u, { password: a.hash, active: true, demo: true }); changed = true; }
      continue;
    }
    u = { id: id(), name: a.name, email: a.email, phone: '', role: 'owner', password: a.hash, active: true, demo: true, createdAt: new Date().toISOString() };
    db.users.push(u);
    const horse = { id: id(), name: 'Dakota', breed: 'Quarter Horse', ownerId: u.id, stallId: '', arrivedOn: day(20).slice(0, 10), notes: 'Sample horse for the app store review.', active: true, demo: true, createdAt: new Date().toISOString() };
    db.horses.push(horse);
    const photo = (src) => {
      const file = path.join(__dirname, '..', 'public', 'img', 'photos', src);
      if (!fs.existsSync(file)) return [];
      const name = id() + '.jpg';
      fs.copyFileSync(file, path.join(uploadsDir, 'private', name));
      return [{ file: name, type: 'image', mime: 'image/jpeg' }];
    };
    db.updates.push(
      { id: id(), horseId: horse.id, caption: 'Dakota settled into his stall today. Ate all his hay and is relaxed.', media: photo('barn-stalls.jpg'), authorName: 'Ranch team', authorId: null, createdAt: day(3) },
      { id: id(), horseId: horse.id, caption: 'Thirty minutes in round pen 1 this morning. Moving well.', media: photo('hero.jpg'), authorName: 'Ranch team', authorId: null, createdAt: day(1) },
      { id: id(), horseId: horse.id, caption: 'Farrier visit done. All four shoes reset.', media: [], authorName: 'Ranch team', authorId: null, createdAt: day(0.1) },
    );
    changed = true;
    console.log('[seed] store review account created:', a.email);
  }
  if (changed) store.save();
}

module.exports = { seedStalls, seedDemo, seedReviewAccounts, STALL_SIZE };
