// Winning Ranch ops API: Claude (or João) talks to the live server with the OPS_API_KEY Railway variable.
// The key runs as the acting account (OPS_ACT_AS, else the master account), so every dashboard route works:
//   node tools/ranch-ops.mjs /ops/ping                          who it acts as, email setup, version
//   node tools/ranch-ops.mjs "/ops/logs?q=invite&limit=100"     recent server log lines (links hidden)
//   node tools/ranch-ops.mjs "/ops/people?q=gabi"               people with last login and invite dates
//   node tools/ranch-ops.mjs POST /admin/users/bulk '{"lines":"Gabi, gabi@example.com, 702-555-0100, ranch manager"}'
//   node tools/ranch-ops.mjs PATCH /admin/users/<id> '{"position":"manager"}'
//   node tools/ranch-ops.mjs POST /admin/users/<id>/invite '{"email":true}'
//   node tools/ranch-ops.mjs GET /chats                         then POST /chats/<id>/people '{"add":["<userId>"]}'
//   node tools/ranch-ops.mjs POST /admin/email-test             a test email to the acting account
//   node tools/ranch-ops.mjs GET /admin/invite-all              (POST starts "Invite everyone": only when asked)
// Method: GET by default, POST when a JSON body is given, or name it first (GET POST PATCH PUT DELETE).
// The key comes from RANCH_OPS_KEY or the file ~/.winningranch-ops-key and is never printed.
// RANCH_BASE changes the server (default: production).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const args = process.argv.slice(2);
const method = /^(GET|POST|PATCH|PUT|DELETE)$/i.test(args[0] || '') ? args.shift().toUpperCase() : null;
const [p, body] = args;
if (!p) { console.error('usage: node tools/ranch-ops.mjs [METHOD] <path under /api/ranch> [json body]'); process.exit(2); }
let key = (process.env.RANCH_OPS_KEY || '').trim();
if (!key) { try { key = fs.readFileSync(path.join(os.homedir(), '.winningranch-ops-key'), 'utf8').trim(); } catch (_) {} }
if (!key) { console.error('No key: set RANCH_OPS_KEY or put it in ~/.winningranch-ops-key'); process.exit(2); }
const base = (process.env.RANCH_BASE || 'https://app.winningranch.com').replace(/\/$/, '');
const url = base + '/api/ranch' + (p.startsWith('/') ? p : '/' + p);
const r = await fetch(url, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'x-ops-key': key }, body: body || undefined });
const text = await r.text();
let out = text; try { out = JSON.stringify(JSON.parse(text), null, 1); } catch (_) {}
console.log(`HTTP ${r.status}\n${out}`);
process.exit(r.ok ? 0 : 1);
