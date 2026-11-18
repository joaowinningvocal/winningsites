/* Encryption for the few really sensitive values the app keeps (the Social Security or EIN number on the W-9).
   AES-256-GCM. The key is the Railway variable W9_KEY (32 bytes, base64) or, without it, a key file created once
   next to the data (DATA_DIR/w9.key), so a copy of ranch.json alone never holds a readable number. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let keyCache = null;
function key(dataDir) {
  if (keyCache) return keyCache;
  const env = (process.env.W9_KEY || '').trim();
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('W9_KEY must be 32 bytes in base64.');
    return (keyCache = k);
  }
  const file = path.join(dataDir, 'w9.key');
  try { keyCache = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64'); } catch (_) { keyCache = null; }
  if (!keyCache || keyCache.length !== 32) {
    keyCache = crypto.randomBytes(32);
    fs.writeFileSync(file, keyCache.toString('base64') + '\n', { mode: 0o600 });
    console.log('[secret] created a new encryption key file for W-9 numbers');
  }
  return keyCache;
}

function seal(dataDir, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(dataDir), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `enc1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function open(dataDir, sealed) {
  const m = /^enc1:([^:]+):([^:]+):(.+)$/.exec(String(sealed || ''));
  if (!m) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(dataDir), Buffer.from(m[1], 'base64'));
    d.setAuthTag(Buffer.from(m[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(m[3], 'base64')), d.final()]).toString('utf8');
  } catch (_) { return null; }
}

module.exports = { seal, open };
