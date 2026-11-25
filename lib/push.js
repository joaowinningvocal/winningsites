/* Phone notifications for the Winning Ranch store app (Firebase Cloud Messaging), like the Winning App.
   - FIREBASE_SERVICE_ACCOUNT on Railway: the Firebase service account JSON (or its base64). Without it nothing is sent.
   - Each phone's token is kept on its user (user.pushTokens); the app registers it after login and drops it on log out.
   - The sound is the neigh (Randy): neigh.wav on iPhone, the "neigh" channel on Android (both put in the app by the build).
   - The number on the app icon is what's unread in the chats; reading a chat sends a silent update. */
let fb = null;
let tried = false;
function firebase() {
  if (tried) return fb;
  tried = true;
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) { console.log('[push] FIREBASE_SERVICE_ACCOUNT not set: phone notifications are off'); return null; }
  try {
    const admin = require('firebase-admin');
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
    fb = admin;
    console.log('[push] firebase-admin ready');
  } catch (e) { console.error('[push] firebase init failed:', e.message); fb = null; }
  return fb;
}

module.exports = function createPush({ db, store, badgeOf }) {
  const tokensOf = (u) => (u && Array.isArray(u.pushTokens) ? u.pushTokens : []);
  const lastBadge = new Map();
  const log = [];
  const note = (entry) => { log.push({ at: new Date().toISOString(), ...entry }); if (log.length > 300) log.splice(0, log.length - 300); };

  // A phone belongs to one person at a time: registering it moves it from whoever had it before
  function register(user, token, platform) {
    const t = String(token || '').slice(0, 4096);
    if (!t) return false;
    for (const u of db.users) if (u !== user && tokensOf(u).some((x) => x.token === t)) u.pushTokens = tokensOf(u).filter((x) => x.token !== t);
    user.pushTokens = [{ token: t, platform: String(platform || '').slice(0, 20), at: new Date().toISOString() }, ...tokensOf(user).filter((x) => x.token !== t)].slice(0, 5);
    store.save();
    return true;
  }
  function unregister(user, token) {
    const before = tokensOf(user).length;
    user.pushTokens = tokensOf(user).filter((x) => x.token !== token);
    if (user.pushTokens.length !== before) store.save();
  }
  const dropBad = (user, resp, tokens) => {
    const bad = [];
    resp.responses.forEach((r, i) => { if (!r.success && r.error && /not-registered|invalid-argument|invalid-registration/.test(r.error.code || '')) bad.push(tokens[i]); });
    if (bad.length) { user.pushTokens = tokensOf(user).filter((x) => !bad.includes(x.token)); store.save(); }
    return bad.length;
  };

  // One notification to one person's phones: title, body, data (chatId, type) and the neigh
  async function send(userId, { title, body, data }) {
    const admin = firebase();
    const user = db.users.find((u) => u.id === userId && u.active !== false);
    if (!admin || !user) return { skipped: admin ? 'no user' : 'push off' };
    const tokens = tokensOf(user).map((x) => x.token);
    if (!tokens.length) { note({ user: user.name, type: data && data.type, skipped: 'no phone registered' }); return { skipped: 'no phone' }; }
    const badge = Math.min(99, Math.max(0, Number(badgeOf(user)) || 0));
    lastBadge.set(user.id, badge);
    try {
      const resp = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title: String(title || 'Winning Ranch').slice(0, 120), body: String(body || '').slice(0, 300) },
        data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v == null ? '' : v)])),
        apns: { payload: { aps: { sound: 'neigh.wav', badge } } },
        android: { priority: 'high', notification: { sound: 'neigh', channelId: 'neigh' } },
      });
      const removed = dropBad(user, resp, tokens);
      note({ user: user.name, type: data && data.type, phones: tokens.length, ok: resp.successCount, failed: resp.failureCount, removed,
        errors: resp.responses.filter((r) => !r.success).map((r) => (r.error && r.error.code) || 'unknown').slice(0, 3) });
      return { ok: resp.successCount, failed: resp.failureCount };
    } catch (e) { console.error('[push] send:', e.message); note({ user: user.name, error: e.message }); return { error: e.message }; }
  }
  const sendMany = (userIds, msg) => { for (const id of new Set(userIds.filter(Boolean))) send(id, msg).catch(() => {}); };

  // Silent update of the icon number (0 takes it away); only when it changed, unless forced
  async function syncBadge(user, force) {
    const admin = firebase();
    if (!admin || !user) return;
    const tokens = tokensOf(user).map((x) => x.token);
    if (!tokens.length) return;
    const badge = Math.min(99, Math.max(0, Number(badgeOf(user)) || 0));
    if (!force && lastBadge.get(user.id) === badge) return;
    lastBadge.set(user.id, badge);
    try {
      const resp = await admin.messaging().sendEachForMulticast({ tokens, apns: { headers: { 'apns-push-type': 'alert', 'apns-priority': '5' }, payload: { aps: { badge } } } });
      dropBad(user, resp, tokens);
    } catch (e) { console.error('[push] badge:', e.message); }
  }

  return { register, unregister, send, sendMany, syncBadge, enabled: () => !!firebase(), recent: () => log.slice(-100) };
};
