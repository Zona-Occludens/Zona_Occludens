/**
 * ============================================================================
 * Zona Occludens API  v4  (Google Apps Script + Google Sheets)
 * ----------------------------------------------------------------------------
 *  NEW IN v4  (everything from v3 is kept; nothing was removed)
 *  - Test & Mistake Tracker: permanent Test IDs, subject-wise performance,
 *    mistakes linked to their test, R1 / R2 / R3 revision history   -> section 10
 *  - Server analytics + report builder (PDF / Excel / CSV data)      -> handleAnalytics(), handleReport()
 *  - Duplicate-safe saves (operation IDs) + "SyncLog" sheet          -> handleSave(), handleSyncLog()
 *  - Per-user performance columns in Users_DB + admin performance view
 *  - Returning-user sign-in ("restore") and ping version, which the v3 frontend already expects
 *  - Telegram: /user <mobile> performance summary
 *
 *  NEW IN v4.1  (AKTrack v1.1 interface in the frontend)
 *  - Daily Planner tasks, Account & exam goals (INICET / NEET PG dates, planner period,
 *    daily goals, paper sizes), Subject list and Topic library travel inside the same
 *    encrypted state; every sync validates and size-caps them (ZTE.cleanAk, section 11)
 *  - Planner report now includes the task planner (PDF / Excel / CSV)
 *
 *  v3 features, unchanged:
 *  - Signed, expiring session tokens (HMAC-SHA256)        -> verifyToken()
 *  - Shared API key + per-user rate limiting              -> doPost(), rateLimit()
 *  - Device-bound accounts + recovery code                -> handleLogin()
 *  - State encrypted at rest (ChaCha20 + HMAC, enc-then-MAC) -> encryptText()
 *  - Input sanitisation + spreadsheet formula-injection guard -> clean(), safeCell()
 *  - "Security" sheet audit log, "Activity" sheet usage log
 *  - Admin API (PIN in Script Properties, never in HTML)
 *  - Telegram admin bot (webhook, admin-chat only)
 *  - In-app broadcast announcements, opt-in leaderboard
 *
 *  Matchmaking / Telegram-username matching has been REMOVED.
 *
 *  FIRST-TIME SETUP: see DEPLOYMENT.md  (edit CFG, run setupZona() once, deploy).
 *  UPGRADING FROM v3: paste this file over the old one and deploy a NEW VERSION.
 *  Do NOT run setupZona() again unless you want to change a key; never touch DATA_KEY.
 *  Existing users, sheets and encrypted data keep working as they are.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// 0. CONFIG  (edit, run setupZona() once, then you may blank these values)
// ---------------------------------------------------------------------------
const CFG = {
  API_KEY: 'CHANGE_ME_LONG_RANDOM_STRING',   // also paste into API_KEY in index.html / admin.html
  ADMIN_PIN: 'CHANGE_ME_ADMIN_PIN',          // 8+ characters recommended
  TELEGRAM_BOT_TOKEN: '',                    // from @BotFather (optional)
  ADMIN_CHAT_ID: ''                          // your numeric Telegram chat id (optional)
};

const USERS_SHEET = 'Users_DB';
const ACTIVITY_SHEET = 'Activity';
const SECURITY_SHEET = 'Security';
const BROADCAST_SHEET = 'Broadcasts';
const SYNCLOG_SHEET = 'SyncLog';
const API_VERSION = '4.1.0';
const SYNCLOG_MAX_ROWS = 5000;                    // oldest rows are trimmed beyond this

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;      // user session: 12 h
const ADMIN_TTL_MS = 2 * 60 * 60 * 1000;         // admin session: 2 h
const MAX_BODY_CHARS = 4 * 1024 * 1024;          // reject absurd payloads
const RATE_USER_PER_MIN = 60;
const RATE_LOGIN_PER_10MIN = 10;
const RATE_ADMIN_PER_MIN = 40;
const CHUNK = 40000;                             // cell limit is 50 000 chars

const RANKS = [
  { name: 'Aspirant', min: 0 }, { name: 'Scholar', min: 500 }, { name: 'Achiever', min: 2000 },
  { name: 'Topper', min: 5000 }, { name: 'Rank Holder', min: 12000 },
  { name: 'AIR Contender', min: 25000 }, { name: 'Gold Medalist', min: 50000 }
];

const USER_HEADERS = ['Timestamp', 'Mobile (ID)', 'Name', 'Exam Target', 'Target Date', 'Daily Goal (hrs)',
  'Notifications', 'Resources', 'Prep Phase', 'Study Hours', 'Device Hash', 'Recovery Hash',
  'Last Seen', 'Logins', 'XP', 'Rank', 'Leaderboard Opt-in', 'Status',
  'Tests', 'Mistakes', 'Accuracy %', 'Pending Revisions'];        // v4: filled on every sync (missing columns are added automatically)

// ---------------------------------------------------------------------------
// 1. ONE-TIME SETUP HELPERS (run from the Apps Script editor)
// ---------------------------------------------------------------------------
function setupZona() {
  const p = PropertiesService.getScriptProperties();
  const cur = p.getProperties();
  const put = (k, v) => { if (v && !/^CHANGE_ME/.test(v)) p.setProperty(k, v); };
  put('API_KEY', CFG.API_KEY);
  put('ADMIN_PIN', CFG.ADMIN_PIN);
  put('TELEGRAM_BOT_TOKEN', CFG.TELEGRAM_BOT_TOKEN);
  put('ADMIN_CHAT_ID', CFG.ADMIN_CHAT_ID);
  if (!cur.SESSION_SECRET) p.setProperty('SESSION_SECRET', randomHex(64));
  if (!cur.DATA_KEY) p.setProperty('DATA_KEY', randomHex(64));          // NEVER rotate: old data becomes unreadable
  if (!cur.TG_WEBHOOK_SECRET) p.setProperty('TG_WEBHOOK_SECRET', randomHex(24));
  usersSheet(); sheetOf(ACTIVITY_SHEET, ['Timestamp', 'User', 'Action', 'Detail']);
  sheetOf(SECURITY_SHEET, ['Timestamp', 'Type', 'Actor', 'Detail']);
  sheetOf(BROADCAST_SHEET, ['Timestamp', 'Id', 'Message']);
  sheetOf(SYNCLOG_SHEET, ['Timestamp', 'User', 'OpId', 'Action', 'Status']);
  const missing = ['API_KEY', 'ADMIN_PIN'].filter(k => !p.getProperty(k));
  Logger.log(missing.length ? 'Setup incomplete. Missing: ' + missing.join(', ') : 'Setup complete. Now deploy as a Web app.');
}

/** Run once after deployment: registers the Telegram webhook (needs TELEGRAM_BOT_TOKEN + the /exec URL below). */
function setTelegramWebhook() {
  const url = ScriptApp.getService().getUrl();
  const token = prop('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN first.');
  const hook = url + '?tg=' + encodeURIComponent(prop('TG_WEBHOOK_SECRET'));
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook?url=' + encodeURIComponent(hook) +
    '&allowed_updates=' + encodeURIComponent('["message"]') + '&drop_pending_updates=true', { muteHttpExceptions: true });
  Logger.log(res.getContentText());
}

/** Optional one-shot: wipes the retired matchmaking columns from an existing Users_DB. */
function purgeLegacyMatchmaking() {
  const sh = usersSheet();
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  ['Matched Partner TG', 'TG Username'].forEach(h => {
    const i = head.indexOf(h);
    if (i !== -1) { sh.deleteColumn(i + 1); head.splice(i, 1); }
  });
  Logger.log('Legacy matchmaking columns removed.');
}

// ---------------------------------------------------------------------------
// 2. HTTP ENTRY POINTS
// ---------------------------------------------------------------------------
function doGet() {
  return json({ status: 'success', data: { message: 'Zona Occludens API v4 is running.', version: API_VERSION } });
}

function doPost(e) {
  let body;
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY_CHARS) return fail('TOO_LARGE', 'Payload too large.');
    body = JSON.parse(raw);
  } catch (err) { return fail('BAD_REQUEST', 'Malformed request.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('BAD_REQUEST', 'Malformed request.');

  // Telegram webhook (authenticated by the secret in the URL query, not by the API key)
  if (body.update_id !== undefined) return handleTelegramUpdate(e, body);

  const lock = LockService.getScriptLock();
  try {
    if (!prop('API_KEY') || !prop('SESSION_SECRET')) return fail('NOT_CONFIGURED', 'Backend is not configured. Run setupZona().');
    if (!safeEq(body.key, prop('API_KEY'))) { secLog('bad_api_key', 'anon', clean(body.action, 30)); return fail('FORBIDDEN', 'Forbidden.'); }
    const action = clean(body.action, 30);

    if (action === 'ping') return ok({ time: Date.now(), version: API_VERSION });
    lock.waitLock(20000);

    if (action === 'login') return ok(handleLogin(body));
    if (action === 'adminLogin') return ok(handleAdminLogin(body));

    const tok = verifyToken(body.token);
    if (!tok) return fail('AUTH', 'Session expired. Please sign in again.');

    if (tok.role === 'admin') {
      rateLimit('admin:' + tok.sid, RATE_ADMIN_PER_MIN, 60);
      return ok(handleAdmin(action, body));
    }
    if (tok.role !== 'user' || !/^[0-9]{10,15}$/.test(String(tok.uid))) return fail('AUTH', 'Invalid session.');
    rateLimit('u:' + tok.uid, RATE_USER_PER_MIN, 60);
    const uid = String(tok.uid);

    switch (action) {
      case 'save': return ok(handleSave(uid, body.payload, body.upscPytsState, body.opId));
      // ---- v4: test & mistake tracker (read-only, computed from the user's own saved state) ----
      case 'analytics': return ok(handleAnalytics(uid, body.filter));
      case 'weightage': return ok(handleWeightage(uid, body.exam, body.blueprint));
      case 'report': return ok(handleReport(uid, body.kind, body.options));
      case 'testReport': return ok(handleReport(uid, 'test', { id: body.id }));
      case 'trackerSummary': return ok(handleTrackerSummary(uid));
      case 'syncLog': return ok(handleSyncLog(uid));
      case 'load': return ok(handleLoad(uid));
      case 'resetPlanner': return ok(handleResetPlanner(uid, body));
      case 'backup': return ok(handleBackup(uid, 'auto'));
      case 'backups': return ok(handleListBackups(uid));
      case 'restoreBackup': return ok(handleRestoreBackup(uid, body.index));
      case 'deleteUser': return ok(handleDeleteUser(uid));
      case 'announcements': return ok(handleAnnouncements());
      case 'leaderboard': return ok(handleLeaderboard(uid));
      case 'setLeaderboard': return ok(handleSetLeaderboard(uid, body.optIn));
      case 'logout': logActivity(uid, 'logout', ''); return ok({ message: 'Signed out.' });
      default: return fail('BAD_ACTION', 'Unknown action.');
    }
  } catch (err) {
    const m = String(err && err.message || err);
    if (/^E:/.test(m)) { const parts = m.split('|'); return fail(parts[0].slice(2), parts[1] || 'Request failed.'); }
    secLog('server_error', 'system', m.slice(0, 250));
    return fail('SERVER', 'Server error. Please retry.');
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function ok(data) { return json({ status: 'success', data: data }); }
function fail(code, message) { return json({ status: 'error', code: code, message: message }); }
function E(code, message) { return new Error('E:' + code + '|' + message); }

// ---------------------------------------------------------------------------
// 3. CRYPTO, TOKENS, SANITISATION
// ---------------------------------------------------------------------------
const _props = {};
function prop(k) { if (!(k in _props)) _props[k] = PropertiesService.getScriptProperties().getProperty(k) || ''; return _props[k]; }

function randomHex(n) { let s = ''; while (s.length < n) s += Utilities.getUuid().replace(/-/g, ''); return s.slice(0, n); }
function bytesToHex(b) { return Array.prototype.map.call(b, x => ('0' + (x & 255).toString(16)).slice(-2)).join(''); }
function hexToU8(h) { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
function sha256Hex(s) { return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hmacBytes(msg, key) { return Utilities.computeHmacSha256Signature(msg, key); }

/** Length-independent string comparison. */
function safeEq(a, b) {
  a = String(a === undefined || a === null ? '' : a); b = String(b === undefined || b === null ? '' : b);
  let r = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

function signToken(payload) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  const sig = Utilities.base64EncodeWebSafe(hmacBytes(body, prop('SESSION_SECRET')));
  return body + '.' + sig;
}
function verifyToken(tok) {
  if (typeof tok !== 'string' || tok.length > 1200) return null;
  const p = tok.split('.');
  if (p.length !== 2) return null;
  const sig = Utilities.base64EncodeWebSafe(hmacBytes(p[0], prop('SESSION_SECRET')));
  if (!safeEq(sig, p[1])) { secLog('bad_token_signature', 'anon', ''); return null; }
  let payload;
  try { payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0])).getDataAsString()); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}

// --- ChaCha20 (RFC 8439 block function, 32-bit counter) ---------------------
function rotl32(v, c) { return ((v << c) | (v >>> (32 - c))) >>> 0; }
function qround(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl32(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl32(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl32(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl32(x[b] ^ x[c], 7);
}
function le32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function chacha20(key32, nonce12, data) {
  const out = new Uint8Array(data.length);
  const st = new Uint32Array(16), x = new Uint32Array(16);
  st[0] = 0x61707865; st[1] = 0x3320646e; st[2] = 0x79622d32; st[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) st[4 + i] = le32(key32, i * 4);
  for (let i = 0; i < 3; i++) st[13 + i] = le32(nonce12, i * 4);
  let counter = 1;
  for (let off = 0; off < data.length; off += 64) {
    st[12] = counter++; x.set(st);
    for (let r = 0; r < 10; r++) {
      qround(x, 0, 4, 8, 12); qround(x, 1, 5, 9, 13); qround(x, 2, 6, 10, 14); qround(x, 3, 7, 11, 15);
      qround(x, 0, 5, 10, 15); qround(x, 1, 6, 11, 12); qround(x, 2, 7, 8, 13); qround(x, 3, 4, 9, 14);
    }
    for (let i = 0; i < 16; i++) {
      const w = (x[i] + st[i]) >>> 0;
      for (let j = 0; j < 4; j++) { const idx = off + i * 4 + j; if (idx < data.length) out[idx] = data[idx] ^ ((w >>> (8 * j)) & 255); }
    }
  }
  return out;
}
function toU8(signed) { const u = new Uint8Array(signed.length); for (let i = 0; i < signed.length; i++) u[i] = signed[i] & 255; return u; }
function toSigned(u8) { const a = new Array(u8.length); for (let i = 0; i < u8.length; i++) a[i] = u8[i] > 127 ? u8[i] - 256 : u8[i]; return a; }

/** Format:  enc1:<nonce hex>:<tag hex>:<base64 ciphertext>   (tag = HMAC(macKey, ciphertext)) */
function encryptText(plain) {
  const nonceHex = randomHex(24);
  const key = toU8(hmacBytes('enc|' + nonceHex, prop('DATA_KEY')));
  const ct = chacha20(key, hexToU8(nonceHex), toU8(Utilities.newBlob(plain).getBytes()));
  const b64 = Utilities.base64Encode(toSigned(ct));
  const tag = bytesToHex(hmacBytes('mac|' + nonceHex + '|' + b64, prop('DATA_KEY')));
  return 'enc1:' + nonceHex + ':' + tag + ':' + b64;
}
function decryptText(s) {
  if (typeof s !== 'string' || s.indexOf('enc1:') !== 0) return s;       // legacy plaintext rows
  const p = s.split(':');
  if (p.length < 4) throw E('DATA', 'Stored data is corrupted.');
  const nonceHex = p[1], tag = p[2], b64 = p.slice(3).join(':');
  const want = bytesToHex(hmacBytes('mac|' + nonceHex + '|' + b64, prop('DATA_KEY')));
  if (!safeEq(want, tag)) { secLog('tamper_detected', 'storage', ''); throw E('DATA', 'Stored data failed integrity check.'); }
  const key = toU8(hmacBytes('enc|' + nonceHex, prop('DATA_KEY')));
  const pt = chacha20(key, hexToU8(nonceHex), toU8(Utilities.base64Decode(b64)));
  return Utilities.newBlob(toSigned(pt)).getDataAsString();
}

// --- sanitisation ------------------------------------------------------------
/** Strip control chars and angle brackets, collapse whitespace, cap length. */
function clean(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 100);
}
/** Spreadsheet formula-injection guard: cells must never start a formula. */
function safeCell(v) { return (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) ? "'" + v : v; }
function stripProto(o) {
  if (!o || typeof o !== 'object') return o;
  ['__proto__', 'constructor', 'prototype'].forEach(k => { try { delete o[k]; } catch (e) {} });
  Object.keys(o).forEach(k => { if (o[k] && typeof o[k] === 'object') stripProto(o[k]); });
  return o;
}
function rankFor(xp) { let r = RANKS[0].name; RANKS.forEach(x => { if (xp >= x.min) r = x.name; }); return r; }

// --- rate limit + audit ------------------------------------------------------
function rateLimit(bucket, limit, windowSec) {
  const cache = CacheService.getScriptCache();
  const k = ('rl:' + bucket + ':' + Math.floor(Date.now() / (windowSec * 1000))).slice(0, 240);
  const n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), windowSec + 10);
  if (n > limit) { secLog('rate_limited', bucket, 'count=' + n); throw E('RATE_LIMITED', 'Too many requests. Slow down and retry shortly.'); }
}

function sheetOf(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#F97316').setFontColor('white');
    sh.setFrozenRows(1);
  }
  return sh;
}
function secLog(type, actor, detail) {
  try { sheetOf(SECURITY_SHEET, ['Timestamp', 'Type', 'Actor', 'Detail']).appendRow([new Date().toISOString(), safeCell(clean(type, 40)), safeCell(clean(actor, 40)), safeCell(clean(detail, 300))]); } catch (e) {}
}
function logActivity(uid, action, detail) {
  try { sheetOf(ACTIVITY_SHEET, ['Timestamp', 'User', 'Action', 'Detail']).appendRow([new Date().toISOString(), String(uid), safeCell(clean(action, 30)), safeCell(clean(detail, 200))]); } catch (e) {}
}

// ---------------------------------------------------------------------------
// 4. USERS TABLE (header-driven so legacy sheets keep working)
// ---------------------------------------------------------------------------
function usersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(USERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(USERS_SHEET);
    sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]).setFontWeight('bold').setBackground('#F97316').setFontColor('white');
    sh.setFrozenRows(1);
    sh.getRange(2, 2, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  } else {
    const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    const missing = USER_HEADERS.filter(h => have.indexOf(h) === -1);
    if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#F97316').setFontColor('white');
  }
  return sh;
}
function userTable() {
  const sh = usersSheet();
  const vals = sh.getDataRange().getValues();
  const col = {};
  vals[0].forEach((h, i) => { col[String(h)] = i; });
  return { sh: sh, vals: vals, col: col };
}
function findUser(t, mobile) {
  const c = t.col['Mobile (ID)'];
  for (let i = 1; i < t.vals.length; i++) if (String(t.vals[i][c]) === String(mobile)) return i;
  return -1;
}
function setUserCells(t, i, obj) {
  Object.keys(obj).forEach(h => {
    const c = t.col[h]; if (c === undefined) return;
    t.sh.getRange(i + 1, c + 1).setValue(safeCell(obj[h]));
    t.vals[i][c] = obj[h];
  });
}
function cell(t, i, h) { const c = t.col[h]; return c === undefined ? '' : t.vals[i][c]; }

// ---------------------------------------------------------------------------
// 5. LOGIN / REGISTRATION (device-bound)
// ---------------------------------------------------------------------------
function sanitizeProfile(u) {
  if (!u || typeof u !== 'object') return null;
  const mobile = String(u.mobile || '').trim();
  if (!/^[0-9]{10,15}$/.test(mobile)) return null;
  const name = clean(u.name, 60);
  if (!name) return null;
  const goal = Math.max(0, Math.min(16, Number(u.goal) || 0));
  const td = /^\d{4}-\d{2}-\d{2}$/.test(String(u.targetDate || '')) ? String(u.targetDate) : '';
  return {
    mobile: mobile, name: name, exam: clean(u.exam, 30), targetDate: td, goal: goal,
    notif: clean(Array.isArray(u.notif) ? u.notif.join(',') : u.notif, 60),
    resources: clean(Array.isArray(u.resources) ? u.resources.join(', ') : u.resources, 200),
    phase: clean(u.phase, 30), hours: clean(u.hours, 12)
  };
}

function handleLogin(req) {
  // honeypot: real users never fill it. Pretend success, reveal nothing.
  if (req.hp) { secLog('honeypot', 'bot', clean(req.hp, 60)); throw E('BAD_REQUEST', 'Could not complete sign-in.'); }
  let u = sanitizeProfile(req.userData);
  // v4: returning user on a new browser sends only the mobile number (restore: true); the stored profile is used.
  const restore = !!req.restore && !u;
  if (restore) {
    const mob = String((req.userData && req.userData.mobile) || '').trim();
    if (!/^[0-9]{10,15}$/.test(mob)) throw E('BAD_REQUEST', 'Enter the 10-15 digit mobile number you registered with.');
    u = { mobile: mob };
  }
  if (!u) throw E('BAD_REQUEST', 'Please check your name and 10-15 digit mobile number.');
  const dk = String(req.deviceKey || '');
  if (!/^[a-f0-9]{32,128}$/.test(dk)) throw E('BAD_REQUEST', 'Invalid device key.');
  rateLimit('login:' + u.mobile, RATE_LOGIN_PER_10MIN, 600);

  const dHash = sha256Hex(dk + '|' + prop('DATA_KEY'));
  const t = userTable();
  let i = findUser(t, u.mobile);
  let isNew = false, recoveryCode = '';
  const now = new Date().toISOString();

  if (i === -1 && restore) { secLog('restore_unknown', u.mobile, ''); throw E('NO_ACCOUNT', 'No account found for this mobile number. Create a new account instead.'); }
  if (i === -1) {
    isNew = true;
    recoveryCode = makeRecoveryCode();
    const row = {};
    USER_HEADERS.forEach(h => { row[h] = ''; });
    Object.assign(row, {
      'Timestamp': now, 'Mobile (ID)': u.mobile, 'Name': u.name, 'Exam Target': u.exam, 'Target Date': u.targetDate,
      'Daily Goal (hrs)': u.goal, 'Notifications': u.notif, 'Resources': u.resources, 'Prep Phase': u.phase,
      'Study Hours': u.hours, 'Device Hash': dHash, 'Recovery Hash': sha256Hex(recoveryCode + '|' + prop('DATA_KEY')),
      'Last Seen': now, 'Logins': 1, 'XP': 0, 'Rank': RANKS[0].name, 'Leaderboard Opt-in': 'no', 'Status': 'active'
    });
    const head = t.vals[0].map(String);
    const r = t.sh.getLastRow() + 1;
    t.sh.getRange(r, t.col['Mobile (ID)'] + 1).setNumberFormat('@');
    t.sh.getRange(r, 1, 1, head.length).setValues([head.map(h => safeCell(row[h] === undefined ? '' : row[h]))]);
    logActivity(u.mobile, 'signup', u.exam);
    tgSend('New signup: ' + u.name + ' (' + u.exam + ')');
  } else {
    if (String(cell(t, i, 'Status')) === 'blocked') { secLog('blocked_login', u.mobile, ''); throw E('FORBIDDEN', 'This account is disabled.'); }
    const bound = String(cell(t, i, 'Device Hash'));
    if (!bound) {                                            // legacy account: trust-on-first-use, issue recovery code
      recoveryCode = makeRecoveryCode();
      setUserCells(t, i, { 'Device Hash': dHash, 'Recovery Hash': sha256Hex(recoveryCode + '|' + prop('DATA_KEY')) });
    } else if (!safeEq(bound, dHash)) {
      const rc = String(req.recoveryCode || '').trim().toUpperCase();
      const rh = String(cell(t, i, 'Recovery Hash'));
      if (rc && rh && safeEq(sha256Hex(rc + '|' + prop('DATA_KEY')), rh)) {
        recoveryCode = makeRecoveryCode();                   // rotate on use
        setUserCells(t, i, { 'Device Hash': dHash, 'Recovery Hash': sha256Hex(recoveryCode + '|' + prop('DATA_KEY')) });
        secLog('device_rebound', u.mobile, 'via recovery code');
      } else {
        secLog('device_mismatch', u.mobile, rc ? 'bad recovery code' : 'no recovery code');
        throw E('DEVICE_MISMATCH', 'This account is linked to another device. Enter your recovery code to continue.');
      }
    }
    if (restore) setUserCells(t, i, { 'Last Seen': now, 'Logins': (Number(cell(t, i, 'Logins')) || 0) + 1 });   // never overwrite the stored profile
    else setUserCells(t, i, {
      'Name': u.name, 'Exam Target': u.exam, 'Target Date': u.targetDate, 'Daily Goal (hrs)': u.goal,
      'Notifications': u.notif, 'Resources': u.resources, 'Prep Phase': u.phase, 'Study Hours': u.hours,
      'Last Seen': now, 'Logins': (Number(cell(t, i, 'Logins')) || 0) + 1
    });
    logActivity(u.mobile, restore ? 'restore_login' : 'login', '');
  }
  let profile = null;
  if (restore) {
    const t3 = userTable(), k = findUser(t3, u.mobile);
    profile = {
      mobile: u.mobile, name: String(cell(t3, k, 'Name') || 'Student'), exam: String(cell(t3, k, 'Exam Target') || ''),
      targetDate: cellDate_(cell(t3, k, 'Target Date')), goal: Number(cell(t3, k, 'Daily Goal (hrs)')) || 0,
      notif: String(cell(t3, k, 'Notifications') || ''), resources: String(cell(t3, k, 'Resources') || ''),
      phase: String(cell(t3, k, 'Prep Phase') || ''), hours: String(cell(t3, k, 'Study Hours') || '')
    };
  }
  const exp = Date.now() + SESSION_TTL_MS;
  return {
    userId: u.mobile, token: signToken({ uid: u.mobile, role: 'user', exp: exp, jti: randomHex(8) }),
    exp: exp, isNew: isNew, recoveryCode: recoveryCode, profile: profile
  };
}
/** Sheets may hand a date cell back as a Date object: always return yyyy-MM-dd text. */
function cellDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(v || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}
function makeRecoveryCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  const hex = randomHex(20);
  for (let k = 0; k < 10; k++) s += A[parseInt(hex.substr(k * 2, 2), 16) % A.length];
  return s.slice(0, 5) + '-' + s.slice(5);
}

// ---------------------------------------------------------------------------
// 6. LOAD / SAVE / RESET / DELETE  (state encrypted at rest)
// ---------------------------------------------------------------------------
function mergeUpscPytsState(payload, upscPytsState) {
  const base = (payload && typeof payload === 'object') ? payload : {};
  const n = (upscPytsState && typeof upscPytsState === 'object') ? upscPytsState : {};
  if (!n.selectedSubject && !n.topics) return base;
  const next = Object.assign({}, base);
  next.upscCmsPyts = Object.assign({}, next.upscCmsPyts || {}, {
    selectedSubject: n.selectedSubject || (next.upscCmsPyts && next.upscCmsPyts.selectedSubject) || 'ALL',
    topics: n.topics || (next.upscCmsPyts && next.upscCmsPyts.topics) || {}
  });
  return next;
}

function readState(uid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('State_' + uid);
  if (!sheet) return null;
  const rows = sheet.getDataRange().getValues();
  let s = '';
  rows.forEach((r, idx) => { if (idx > 0 && r[0]) s += r[0]; });          // row 1 is the warning banner
  if (!s) return null;
  let state;
  try { state = JSON.parse(decryptText(s)); } catch (e) {
    if (/^E:/.test(String(e.message))) throw e;
    throw E('DATA', 'Stored data could not be read.');
  }
  const tSheet = ss.getSheetByName('Topics_' + uid);
  const master = {};
  if (tSheet) {
    const d = tSheet.getDataRange().getValues();
    for (let i = 1; i < d.length; i++) {
      const r = d[i]; if (!r[0]) continue;
      master[r[0]] = {
        emojiSubj: r[1], subject: r[2], topic: r[3], yield: r[4], label: r[5],
        r1: r[6] === true, r2: r[7] === true, r3: r[8] === true, completed: r[9] === true,
        notes: decryptText(String(r[10] || '')), isCustom: r[11] === true, diffLabel: r[12] || 'Moderate'
      };
    }
  }
  state.masterTopics = master;
  return state;
}

function writeState(uid, input) {
  const state = stripProto(typeof input === 'string' ? JSON.parse(input) : input);
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw E('BAD_REQUEST', 'Invalid payload.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterTopics = state.masterTopics || {};
  delete state.masterTopics;

  let sh = ss.getSheetByName('State_' + uid);
  if (!sh) {
    sh = ss.insertSheet('State_' + uid);
    sh.getRange('A1').setValue('WARNING: encrypted data. Do not edit. User ' + uid).setFontWeight('bold').setFontColor('red');
  }
  const cipher = encryptText(JSON.stringify(state));
  const chunks = [];
  for (let i = 0; i < cipher.length; i += CHUNK) chunks.push([cipher.substring(i, i + CHUNK)]);
  sh.getRange('A2:A').clearContent();
  if (chunks.length) sh.getRange(2, 1, chunks.length, 1).setValues(chunks);

  let tSheet = ss.getSheetByName('Topics_' + uid);
  if (!tSheet) tSheet = ss.insertSheet('Topics_' + uid);
  const headers = ['ID', 'Subject Emoji', 'Subject', 'Topic Name', 'Yield Score', 'Special Tag', 'R1', 'R2', 'R3', 'Lock (Completed)', 'Notes / Pearls (encrypted)', 'isCustom', 'Difficulty'];
  const rows = [headers];
  Object.keys(masterTopics).forEach(id => {
    const t = masterTopics[id] || {};
    rows.push([
      safeCell(clean(id, 80)), safeCell(clean(t.emojiSubj, 8)), safeCell(clean(t.subject, 40)), safeCell(clean(t.topic, 200)),
      safeCell(clean(t.yield, 20)), safeCell(clean(t.label, 40)), t.r1 === true, t.r2 === true, t.r3 === true, t.completed === true,
      t.notes ? encryptText(String(t.notes).slice(0, 5000)) : '', t.isCustom === true, clean(t.diffLabel || 'Moderate', 20)
    ]);
  });
  tSheet.clear();
  tSheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  tSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#F97316').setFontColor('white').setHorizontalAlignment('center');
  tSheet.setFrozenRows(1); tSheet.setColumnWidth(4, 300);
  if (rows.length > 1) tSheet.getRange(2, 7, rows.length - 1, 4).insertCheckboxes();
  state.masterTopics = masterTopics;
  return state;
}

function handleLoad(uid) {
  const state = readState(uid);
  const t = userTable(); const i = findUser(t, uid);
  if (i !== -1) setUserCells(t, i, { 'Last Seen': new Date().toISOString() });
  return state;
}

function handleSave(uid, payload, upscPytsState, opId) {
  const cache = CacheService.getScriptCache();
  // v4: a retried request carrying the same operation ID is answered from the cache instead of being written twice.
  const op = clean(opId, 64).replace(/[^A-Za-z0-9._\-]/g, '');
  if (op) {
    const prev = cache.get('op:' + uid + ':' + op);
    if (prev) { try { const r = JSON.parse(prev); r.duplicate = true; return r; } catch (e) {} }
  }
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const merged = mergeUpscPytsState(parsed, upscPytsState);
  let summary = null;
  try { summary = prepareTracker_(merged); } catch (e) { secLog('tracker_prepare', uid, String(e && e.message).slice(0, 200)); }   // never blocks a sync
  const state = writeState(uid, merged);
  const g = state.gamification || {};
  const xp = Math.max(0, Math.floor(Number(g.xp) || 0));
  const t = userTable(); const i = findUser(t, uid);
  if (i !== -1) {
    const cells = { 'Last Seen': new Date().toISOString(), 'XP': xp, 'Rank': rankFor(xp) };
    if (summary) Object.assign(cells, { 'Tests': summary.tests, 'Mistakes': summary.mistakes, 'Accuracy %': summary.accuracy, 'Pending Revisions': summary.pendingRev });
    setUserCells(t, i, cells);
  }
  if (!cache.get('act:' + uid)) { cache.put('act:' + uid, '1', 600); logActivity(uid, 'sync', 'xp=' + xp + (summary ? ' tests=' + summary.tests + ' mistakes=' + summary.mistakes : '')); }
  const out = { message: 'Sync successful', savedAt: Date.now(), version: API_VERSION, tracker: summary };
  if (op) {
    try { cache.put('op:' + uid + ':' + op, JSON.stringify(out), 21600); } catch (e) {}
    syncLog_(uid, op, 'save', 'ok');
  }
  return out;
}

// --- rolling encrypted snapshots: last 3 kept in "Backup_<uid>" ---------------
const BACKUP_KEEP = 3, BACKUP_MAX_COLS = 40;
function handleBackup(uid, why) {
  const state = readState(uid);
  if (!state) return { message: 'Nothing to back up yet.', skipped: true };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Backup_' + uid);
  if (!sh) { sh = ss.insertSheet('Backup_' + uid); sh.getRange('A1').setValue('Encrypted snapshots (newest last). Do not edit.'); }
  const cipher = encryptText(JSON.stringify(state));
  const parts = [];
  for (let i = 0; i < cipher.length; i += CHUNK) parts.push(cipher.substring(i, i + CHUNK));
  if (parts.length > BACKUP_MAX_COLS) throw E('TOO_LARGE', 'Data too large to snapshot.');
  const row = [new Date().toISOString(), clean(why, 20)].concat(parts);
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  while (sh.getLastRow() - 1 > BACKUP_KEEP) sh.deleteRow(2);
  return { message: 'Snapshot saved.', at: row[0] };
}
function handleListBackups(uid) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Backup_' + uid);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  return { items: v.map((r, i) => ({ index: i, at: String(r[0]), why: String(r[1]) })).reverse() };
}
function handleRestoreBackup(uid, index) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Backup_' + uid);
  const i = Number(index);
  if (!sh || !(i >= 0) || sh.getLastRow() < 2 + i) throw E('NOT_FOUND', 'Snapshot not found.');
  const row = sh.getRange(2 + i, 1, 1, sh.getLastColumn()).getValues()[0];
  let cipher = ''; for (let k = 2; k < row.length; k++) if (row[k]) cipher += row[k];
  const state = JSON.parse(decryptText(cipher));
  handleBackup(uid, 'pre-restore');            // never lose the state we are replacing
  writeState(uid, state);
  logActivity(uid, 'restore_backup', String(row[0]));
  return state;
}

/** Clears the planner (and replaces the streak) server-side without touching anything else. */
function handleResetPlanner(uid, req) {
  try { handleBackup(uid, 'pre-reset'); } catch (e) {}
  const state = readState(uid) || {};
  state.planner = {};
  if (req.streak && typeof req.streak === 'object') state.streak = stripProto(req.streak);
  writeState(uid, state);
  logActivity(uid, 'reset_planner', '');
  return { message: 'Planner reset on server.' };
}

function handleDeleteUser(uid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const t = userTable(); const i = findUser(t, uid);
  ['State_' + uid, 'Topics_' + uid, 'Backup_' + uid].forEach(n => { const s = ss.getSheetByName(n); if (s) ss.deleteSheet(s); });
  if (i !== -1) t.sh.deleteRow(i + 1);
  anonymiseActivity(uid);
  anonymiseSyncLog_(uid);
  logActivity('[deleted]', 'account_deleted', '');
  secLog('account_deleted', uid, 'self-service');
  return { message: 'Account and all associated data deleted.', existed: i !== -1 };
}
function anonymiseActivity(uid) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACTIVITY_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const rng = sh.getRange(2, 2, sh.getLastRow() - 1, 1); const v = rng.getValues();
  let changed = false;
  for (let k = 0; k < v.length; k++) if (String(v[k][0]) === String(uid)) { v[k][0] = '[deleted]'; changed = true; }
  if (changed) rng.setValues(v);
}

// ---------------------------------------------------------------------------
// 7. ANNOUNCEMENTS + LEADERBOARD
// ---------------------------------------------------------------------------
function handleAnnouncements() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BROADCAST_SHEET);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const n = Math.min(sh.getLastRow() - 1, 8);
  const rows = sh.getRange(sh.getLastRow() - n + 1, 1, n, 3).getValues();
  const cutoff = Date.now() - 14 * 86400000;
  return { items: rows.filter(r => new Date(r[0]).getTime() > cutoff).map(r => ({ ts: r[0], id: String(r[1]), message: String(r[2]) })).reverse() };
}

function handleSetLeaderboard(uid, optIn) {
  const t = userTable(); const i = findUser(t, uid);
  if (i === -1) throw E('NOT_FOUND', 'User not found.');
  setUserCells(t, i, { 'Leaderboard Opt-in': optIn ? 'yes' : 'no' });
  CacheService.getScriptCache().remove('lb');
  return { optIn: !!optIn };
}

function handleLeaderboard(uid) {
  const cache = CacheService.getScriptCache();
  let top = cache.get('lb');
  if (top) top = JSON.parse(top);
  else {
    const t = userTable(); const list = [];
    for (let i = 1; i < t.vals.length; i++) {
      if (String(cell(t, i, 'Leaderboard Opt-in')) !== 'yes') continue;
      const nm = String(cell(t, i, 'Name')).split(' ');
      list.push({ id: String(cell(t, i, 'Mobile (ID)')), name: nm[0] + (nm[1] ? ' ' + nm[1][0] + '.' : ''), xp: Number(cell(t, i, 'XP')) || 0, rank: String(cell(t, i, 'Rank')) });
    }
    list.sort((a, b) => b.xp - a.xp);
    top = list.slice(0, 25);
    cache.put('lb', JSON.stringify(top), 60);
  }
  const t2 = userTable(); const me = findUser(t2, uid);
  return {
    top: top.map((r, k) => ({ pos: k + 1, name: r.name, xp: r.xp, rank: r.rank, me: r.id === String(uid) })),
    optIn: me !== -1 && String(cell(t2, me, 'Leaderboard Opt-in')) === 'yes'
  };
}

// ---------------------------------------------------------------------------
// 8. ADMIN
// ---------------------------------------------------------------------------
function handleAdminLogin(req) {
  const cache = CacheService.getScriptCache();
  const failKey = 'adminfail';
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) { secLog('admin_locked', 'admin', 'too many bad PINs'); throw E('LOCKED', 'Admin login locked for 15 minutes.'); }
  const pin = prop('ADMIN_PIN');
  if (!pin || !safeEq(req.pin, pin)) {
    cache.put(failKey, String(fails + 1), 900);
    secLog('admin_bad_pin', 'admin', 'attempt ' + (fails + 1));
    tgSend('Security: failed admin PIN attempt (' + (fails + 1) + '/5)');
    throw E('FORBIDDEN', 'Wrong PIN.');
  }
  cache.remove(failKey);
  const exp = Date.now() + ADMIN_TTL_MS;
  secLog('admin_login', 'admin', 'ok');
  return { token: signToken({ role: 'admin', sid: randomHex(10), exp: exp }), exp: exp };
}

function handleAdmin(action, req) {
  switch (action) {
    case 'adminStats': return adminStats();
    case 'adminUsers': return adminUsers();
    case 'adminActivity': return adminActivity(String(req.userId || ''));
    case 'adminSecurity': return adminSecurity();
    case 'adminBroadcast': return adminBroadcast(req.message);
    case 'adminExport': return adminExport();
    // ---- v4: a student's performance (decrypts only that student's state, on request, and is audited) ----
    case 'adminUserAnalytics': return adminUserAnalytics(String(req.userId || ''), req.filter);
    case 'adminUserReport': return adminUserReport(String(req.userId || ''), req.kind, req.options);
    case 'adminResetDevice': return adminSetUser(String(req.userId || ''), { 'Device Hash': '', 'Recovery Hash': '' }, 'device reset');
    case 'adminBlock': return adminSetUser(String(req.userId || ''), { 'Status': req.block ? 'blocked' : 'active' }, req.block ? 'blocked' : 'unblocked');
    case 'adminDeleteUser': if (!/^[0-9]{10,15}$/.test(String(req.userId))) throw E('BAD_REQUEST', 'Bad id.'); secLog('admin_delete_user', 'admin', req.userId); return handleDeleteUser(String(req.userId));
    default: throw E('BAD_ACTION', 'Unknown admin action.');
  }
}

function adminStats() {
  const t = userTable(); const now = Date.now(); const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  let total = 0, a24 = 0, a7 = 0, signToday = 0, blocked = 0, testsLogged = 0, mistakesLogged = 0, pendingRev = 0; const byExam = {}, daily = {};
  for (let i = 1; i < t.vals.length; i++) {
    if (!cell(t, i, 'Mobile (ID)')) continue;
    total++;
    const ls = new Date(cell(t, i, 'Last Seen') || 0).getTime();
    if (now - ls < 86400000) a24++;
    if (now - ls < 7 * 86400000) a7++;
    const ts = cell(t, i, 'Timestamp'); const tsd = ts ? Utilities.formatDate(new Date(ts), tz, 'yyyy-MM-dd') : '';
    if (tsd === today) signToday++;
    if (tsd) daily[tsd] = (daily[tsd] || 0) + 1;
    if (String(cell(t, i, 'Status')) === 'blocked') blocked++;
    testsLogged += Number(cell(t, i, 'Tests')) || 0; mistakesLogged += Number(cell(t, i, 'Mistakes')) || 0; pendingRev += Number(cell(t, i, 'Pending Revisions')) || 0;
    const ex = String(cell(t, i, 'Exam Target') || 'Unknown'); byExam[ex] = (byExam[ex] || 0) + 1;
  }
  return { total: total, active24h: a24, active7d: a7, signupsToday: signToday, blocked: blocked, byExam: byExam, signupsByDay: daily,
    testsLogged: testsLogged, mistakesLogged: mistakesLogged, pendingRevisions: pendingRev };
}
function adminUsers() {
  const t = userTable(); const out = [];
  for (let i = 1; i < t.vals.length; i++) {
    if (!cell(t, i, 'Mobile (ID)')) continue;
    out.push({
      id: String(cell(t, i, 'Mobile (ID)')), name: String(cell(t, i, 'Name')), exam: String(cell(t, i, 'Exam Target')),
      joined: String(cell(t, i, 'Timestamp')), lastSeen: String(cell(t, i, 'Last Seen')), logins: Number(cell(t, i, 'Logins')) || 0,
      xp: Number(cell(t, i, 'XP')) || 0, rank: String(cell(t, i, 'Rank')), status: String(cell(t, i, 'Status') || 'active'),
      tests: Number(cell(t, i, 'Tests')) || 0, mistakes: Number(cell(t, i, 'Mistakes')) || 0,
      accuracy: cell(t, i, 'Accuracy %') === '' ? '' : Number(cell(t, i, 'Accuracy %')) || 0, pendingRev: Number(cell(t, i, 'Pending Revisions')) || 0
    });
  }
  out.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
  return { users: out.slice(0, 1000) };
}
function adminActivity(uid) {
  if (!/^[0-9]{10,15}$/.test(uid)) throw E('BAD_REQUEST', 'Bad user id.');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACTIVITY_SHEET);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  const items = [];
  for (let k = v.length - 1; k >= 0 && items.length < 100; k--) if (String(v[k][1]) === uid) items.push({ ts: v[k][0], action: v[k][2], detail: v[k][3] });
  return { items: items };
}
function adminSecurity() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SECURITY_SHEET);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const n = Math.min(sh.getLastRow() - 1, 100);
  const v = sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues().reverse();
  return { items: v.map(r => ({ ts: r[0], type: r[1], actor: r[2], detail: r[3] })) };
}
function adminBroadcast(message) {
  const m = clean(message, 500);
  if (m.length < 3) throw E('BAD_REQUEST', 'Message is too short.');
  const id = Utilities.getUuid().slice(0, 8);
  sheetOf(BROADCAST_SHEET, ['Timestamp', 'Id', 'Message']).appendRow([new Date().toISOString(), id, safeCell(m)]);
  secLog('broadcast', 'admin', m.slice(0, 100));
  tgSend('Broadcast published to all app users:\n' + m);
  return { id: id, message: 'Broadcast published. Users see it next time the app opens.' };
}
function adminExport() {
  const u = adminUsers().users;
  return { exportedAt: new Date().toISOString(), count: u.length, users: u };
}
function adminSetUser(uid, fields, what) {
  if (!/^[0-9]{10,15}$/.test(uid)) throw E('BAD_REQUEST', 'Bad user id.');
  const t = userTable(); const i = findUser(t, uid);
  if (i === -1) throw E('NOT_FOUND', 'User not found.');
  setUserCells(t, i, fields);
  secLog('admin_user_change', 'admin', uid + ': ' + what);
  return { message: 'Done: ' + what };
}

// ---------------------------------------------------------------------------
// 9. TELEGRAM ADMIN BOT  (only the configured admin chat is ever obeyed)
// ---------------------------------------------------------------------------
function tgSend(text) {
  const token = prop('TELEGRAM_BOT_TOKEN'), chat = prop('ADMIN_CHAT_ID');
  if (!token || !chat) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chat, text: String(text).slice(0, 3900), disable_web_page_preview: true })
    });
  } catch (e) {}
}

function handleTelegramUpdate(e, update) {
  const okResp = json({ ok: true });
  try {
    const secret = prop('TG_WEBHOOK_SECRET');
    if (!secret || !safeEq(e.parameter && e.parameter.tg, secret)) { secLog('tg_bad_secret', 'telegram', ''); return okResp; }
    const msg = update.message;
    if (!msg || !msg.chat || !msg.from) return okResp;
    if (String(msg.chat.id) !== String(prop('ADMIN_CHAT_ID')) || msg.chat.type !== 'private') {
      secLog('tg_unauthorised', clean(msg.from.id, 20), 'chat ' + clean(msg.chat.id, 20));
      return okResp;
    }
    const text = clean(msg.text, 600);
    const lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      const m = /^\/(\w+)(?:@\w+)?\s*(.*)$/.exec(text);
      if (!m) return okResp;
      const cmd = m[1].toLowerCase(), arg = m[2];
      if (cmd === 'stats') {
        const s = adminStats();
        tgSend('Users: ' + s.total + '\nActive 24h: ' + s.active24h + '\nActive 7d: ' + s.active7d + '\nSignups today: ' + s.signupsToday + '\nBlocked: ' + s.blocked +
          '\nTests logged: ' + s.testsLogged + '\nMistakes logged: ' + s.mistakesLogged + '\nPending revisions: ' + s.pendingRevisions);
      } else if (cmd === 'users') {
        const u = adminUsers().users.slice(0, 15);
        tgSend(u.length ? u.map(x => x.name + ' | ' + x.exam + ' | ' + x.rank + ' | XP ' + x.xp).join('\n') : 'No users yet.');
      } else if (cmd === 'broadcast') {
        tgSend(arg ? adminBroadcast(arg).message : 'Usage: /broadcast your message');
      } else if (cmd === 'resetdevice') {
        tgSend(/^[0-9]{10,15}$/.test(arg) ? adminSetUser(arg, { 'Device Hash': '', 'Recovery Hash': '' }, 'device reset').message : 'Usage: /resetdevice 9876543210');
      } else if (cmd === 'user') {
        tgSend(/^[0-9]{10,15}$/.test(arg) ? tgUserSummary_(arg) : 'Usage: /user 9876543210');
      } else if (cmd === 'security') {
        const it = adminSecurity().items.slice(0, 10);
        tgSend(it.length ? it.map(x => String(x.ts).slice(5, 16) + ' ' + x.type + ' ' + x.actor).join('\n') : 'No security events.');
      } else {
        tgSend('Commands: /stats /users /user <mobile> /security /broadcast <msg> /resetdevice <mobile>');
      }
    } finally { try { lock.releaseLock(); } catch (e3) {} }
  } catch (err) { secLog('tg_error', 'telegram', String(err && err.message).slice(0, 200)); }
  return okResp;
}

// ---------------------------------------------------------------------------
// 10. TEST & MISTAKE TRACKER  (v4)
//     Data lives inside each user's encrypted state:
//       state.tests[]   -> each test has a permanent Test ID (tid) + subject rows
//       state.errors[]  -> mistakes, linked to a test by testId, with R1/R2/R3 + history
//       state.tracker   -> manual weightage, reserved IDs, synced draft
//     The browser does the same maths offline with the same engine (section 11);
//     these endpoints give the server-verified numbers and the report data.
// ---------------------------------------------------------------------------
const TRK_LIMITS = { tests: 5000, errors: 20000, hist: 60, subjects: 40 };

/** Caps a text field without touching anything else. */
function capText_(o, key, max) { if (o && typeof o[key] === 'string' && o[key].length > max) o[key] = o[key].slice(0, max); }

/**
 * Runs before every save. Additive and forgiving: assigns missing Test / Mistake IDs,
 * trims oversized text, drops obviously broken rows from subject tables. It never rejects a sync.
 * Returns the summary written to Users_DB.
 */
function prepareTracker_(state) {
  if (!state || typeof state !== 'object') return null;
  if (!Array.isArray(state.tests)) state.tests = [];
  if (!Array.isArray(state.errors)) state.errors = [];
  if (state.tests.length > TRK_LIMITS.tests) state.tests = state.tests.slice(-TRK_LIMITS.tests);
  if (state.errors.length > TRK_LIMITS.errors) state.errors = state.errors.slice(-TRK_LIMITS.errors);
  state.tests.forEach(function (t) {
    if (!t || typeof t !== 'object') return;
    ['name', 'provider', 'tid', 'format', 'type'].forEach(function (k) { capText_(t, k, 120); });
    capText_(t, 'topicsCovered', 1000); capText_(t, 'remarks', 3000);
    if (t.tid !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._\-]{1,39}$/.test(String(t.tid))) delete t.tid;      // a bad ID is re-issued below
    if (Array.isArray(t.subjects)) {
      t.subjects = t.subjects.filter(function (x) { return x && typeof x === 'object' && typeof x.subject === 'string' && x.subject; }).slice(0, TRK_LIMITS.subjects);
      t.subjects.forEach(function (x) { capText_(x, 'subject', 60); capText_(x, 'remarks', 300); });
    }
  });
  state.errors.forEach(function (m) {
    if (!m || typeof m !== 'object') return;
    ['source', 'subject', 'subjectKey', 'qno', 'category', 'priority', 'testId', 'mid'].forEach(function (k) { capText_(m, k, 160); });
    capText_(m, 'broad', 160); capText_(m, 'subT', 240);
    ['reason', 'concept'].forEach(function (k) { capText_(m, k, 2000); });
    ['explanation', 'notes'].forEach(function (k) { capText_(m, k, 5000); });
    if (Array.isArray(m.hist)) { m.hist = m.hist.filter(function (h) { return h && typeof h === 'object'; }).slice(-TRK_LIMITS.hist); m.hist.forEach(function (h) { capText_(h, 'notes', 2000); }); }
  });
  ZTE.cleanAk(state);          // v4.1: planner tasks, settings, subject list, topic library (validated + size-capped)
  ZTE.normalize(state);
  return ZTE.userSummary(state);
}

/** The caller's own state, decrypted and normalised (read-only use). */
function trackerState_(uid) {
  const state = readState(uid);
  if (!state) throw E('NO_DATA', 'Nothing has been synced yet. Log a test and sync first.');
  ZTE.normalize(state);
  return state;
}
function cleanFilter_(f) {
  f = (f && typeof f === 'object' && !Array.isArray(f)) ? f : {};
  const d = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''; };
  return {
    type: clean(f.type, 12) || 'ALL', format: clean(f.format, 20) || 'ALL', from: d(f.from), to: d(f.to),
    subject: clean(f.subject, 60), topic: clean(f.topic, 80), testId: clean(f.testId, 40), exactTestId: clean(f.exactTestId, 40),
    priority: clean(f.priority, 10), category: clean(f.category, 40), rev: clean(f.rev, 6), q: clean(f.q, 80)
  };
}
function handleAnalytics(uid, filter) {
  const s = trackerState_(uid);
  const a = ZTE.analytics(s, cleanFilter_(filter));
  a.streaks = ZTE.streaks(s, Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  a.serverTime = new Date().toISOString(); a.version = API_VERSION;
  return a;
}
function handleWeightage(uid, exam, blueprint) {
  const bp = (blueprint && typeof blueprint === 'object' && !Array.isArray(blueprint)) ? stripProto(blueprint) : null;
  return ZTE.weightage(trackerState_(uid), clean(exam, 20) || 'NEET PG', bp, null);
}
function handleReport(uid, kind, options) {
  const o = (options && typeof options === 'object' && !Array.isArray(options)) ? options : {};
  const k = clean(kind, 12);
  if (['test', 'tests', 'subjects', 'mistakes', 'revisions', 'planner', 'mcq', 'overall'].indexOf(k) === -1) throw E('BAD_REQUEST', 'Unknown report.');
  try { return ZTE.report(trackerState_(uid), k, { id: clean(o.id, 40), filter: cleanFilter_(o.filter) }); }
  catch (e) { if (/^E:/.test(String(e.message))) throw e; throw E('NOT_FOUND', String(e.message || 'Report failed.').slice(0, 120)); }
}
function handleTrackerSummary(uid) { return ZTE.userSummary(trackerState_(uid)); }

// --- sync log (one row per confirmed, operation-tagged save) -----------------
function syncLog_(uid, opId, action, status) {
  try {
    const sh = sheetOf(SYNCLOG_SHEET, ['Timestamp', 'User', 'OpId', 'Action', 'Status']);
    sh.appendRow([new Date().toISOString(), String(uid), safeCell(clean(opId, 64)), safeCell(clean(action, 30)), safeCell(clean(status, 20))]);
    if (sh.getLastRow() > SYNCLOG_MAX_ROWS + 500) sh.deleteRows(2, 500);
  } catch (e) {}
}
function handleSyncLog(uid) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SYNCLOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const n = Math.min(sh.getLastRow() - 1, 1500);
  const v = sh.getRange(sh.getLastRow() - n + 1, 1, n, 5).getValues(), items = [];
  for (let k = v.length - 1; k >= 0 && items.length < 40; k--) if (String(v[k][1]) === String(uid)) items.push({ at: String(v[k][0]), opId: String(v[k][2]), action: String(v[k][3]), status: String(v[k][4]) });
  return { items: items };
}
function anonymiseSyncLog_(uid) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SYNCLOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const rng = sh.getRange(2, 2, sh.getLastRow() - 1, 1), v = rng.getValues(); let changed = false;
  for (let k = 0; k < v.length; k++) if (String(v[k][0]) === String(uid)) { v[k][0] = '[deleted]'; changed = true; }
  if (changed) rng.setValues(v);
}

// --- admin: one student's performance ---------------------------------------
function adminUserAnalytics(uid, filter) {
  if (!/^[0-9]{10,15}$/.test(uid)) throw E('BAD_REQUEST', 'Bad user id.');
  const t = userTable(); const i = findUser(t, uid);
  if (i === -1) throw E('NOT_FOUND', 'User not found.');
  secLog('admin_view_performance', 'admin', uid);
  const a = handleAnalytics(uid, filter);
  // the admin sees numbers and topic names only, never the student's private notes
  return { user: { id: uid, name: String(cell(t, i, 'Name')), exam: String(cell(t, i, 'Exam Target')) }, totals: a.totals, byType: a.byType, byFormat: a.byFormat,
    bySubject: a.bySubject, mistakes: a.mistakes, topTopics: a.topTopics, streaks: { test: a.streaks.test.current, mcq: a.streaks.mcq.current, revision: a.streaks.revision.current },
    series: a.series.slice(-60) };
}
function adminUserReport(uid, kind, options) {
  if (!/^[0-9]{10,15}$/.test(uid)) throw E('BAD_REQUEST', 'Bad user id.');
  const k = clean(kind, 12);
  if (['tests', 'subjects', 'overall'].indexOf(k) === -1) throw E('BAD_REQUEST', 'Admins can export the tests, subjects and overall reports only.');
  secLog('admin_export_performance', 'admin', uid + ': ' + k);
  return handleReport(uid, k, options);
}
function tgUserSummary_(uid) {
  const t = userTable(); const i = findUser(t, uid);
  if (i === -1) return 'User not found.';
  return String(cell(t, i, 'Name')) + ' | ' + String(cell(t, i, 'Exam Target')) + '\nRank: ' + String(cell(t, i, 'Rank')) + ' | XP ' + (Number(cell(t, i, 'XP')) || 0) +
    '\nTests logged: ' + (Number(cell(t, i, 'Tests')) || 0) + '\nOverall accuracy: ' + (cell(t, i, 'Accuracy %') === '' ? 'N/A' : cell(t, i, 'Accuracy %') + '%') +
    '\nMistakes: ' + (Number(cell(t, i, 'Mistakes')) || 0) + ' (pending revision ' + (Number(cell(t, i, 'Pending Revisions')) || 0) + ')' +
    '\nLast seen: ' + String(cell(t, i, 'Last Seen')).slice(0, 16).replace('T', ' ');
}

// ---------------------------------------------------------------------------
// 11. TRACKER ENGINE  (identical to zona-tracker-engine.js in the frontend:
//     if you change one, change the other so the app and the server always agree)
// ---------------------------------------------------------------------------
var ZTE = (function () {
  'use strict';
  var VERSION = '4.1.0';

  var TEST_TYPES = { GT: 'Grand Test', SWT: 'Subject-Wise Test', Mock: 'Mock Test', Daily: 'Daily MCQ Practice', Custom: 'Custom Test' };
  var TYPE_KEYS = ['GT', 'SWT', 'Mock', 'Daily', 'Custom'];
  /* marks per question, negative marking per wrong answer, default paper size */
  var FORMATS = {
    'NEET PG': { mpq: 4, neg: 1, total: 180 },
    'INICET': { mpq: 1, neg: 0.33, total: 200 },
    'FMGE': { mpq: 1, neg: 0, total: 300 },
    'UPSC CMS': { mpq: 2.08, neg: 0.69, total: 240 },
    'Other': { mpq: 1, neg: 0, total: 200 }
  };
  var MISTAKE_CATEGORIES = ['Conceptual error', 'Forgotten fact', 'Knowledge gap', 'Incorrect interpretation', 'Confusion between options',
    'Clinical reasoning error', 'Image-based error', 'Calculation error', 'Silly mistake', 'Guesswork', 'Time-management error', 'Other'];
  var PRIORITIES = ['High', 'Medium', 'Low'];
  var UPCOMING_STATUS = ['Scheduled', 'Completed', 'Missed', 'Cancelled'];
  var REWARDS = { analysis: 30, mistake: 5, r1: 10, r2: 15, r3: 20 };
  /* v4.1 AKTrack task planner + settings */
  var TASK_STATUS = ['Not Started', 'In Progress', 'Completed', 'Postponed'];
  var TASK_TAGS = ['High Yield', 'Needs Revision', 'Must Revise', 'Weak Topic', 'Completed'];
  var AK_DEFAULTS = { userName: '', inicetDate: '2027-05-09', neetpgDate: '', plannerStart: '2026-11-15', plannerEnd: '2027-09-01', dailyGoalHours: 8, dailyMcqTarget: 100, inicetTotalQ: 200, neetpgTotalQ: 200 };
  var AK_LIMITS = { tasks: 20000, topics: 20000, subjects: 60, periodDays: 1100 };

  /* ------------------------------------------------------------ helpers */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function pct(a, b) { return b > 0 ? Math.round(a / b * 10000) / 100 : null; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
  function weekStart(s) { var d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); }
  function str(v, max) { return String(v === undefined || v === null ? '' : v).slice(0, max || 200); }
  function fmtPct(v) { return v === null || v === undefined ? 'N/A' : v + '%'; }
  function typeLabel(k) { return TEST_TYPES[k] || k || ''; }
  /* subject shown with an emoji in the old notebook ("🦴 Anatomy") -> plain key */
  function subjKey(e) { return str(e.subjectKey || String(e.subject || '').replace(/^[^A-Za-z]+/, '') || 'Unspecified', 60); }

  /* ------------------------------------------------- ids + normalisation */
  function tracker(s) {
    if (!isObj(s.tracker)) s.tracker = {};
    var T = s.tracker;
    if (!isObj(T.weights)) T.weights = {};
    if (!isObj(T.usedIds)) T.usedIds = {};
    if (!('draft' in T)) T.draft = null;
    return T;
  }
  function nextId(T, prefix) {
    var max = 0, P = prefix.toUpperCase();
    Object.keys(T.usedIds).forEach(function (k) { if (k.indexOf(P) === 0) { var n = parseInt(k.slice(P.length), 10); if (n > max) max = n; } });
    var id;
    do { max++; id = prefix + ('00' + max).slice(-3); } while (T.usedIds[id.toUpperCase()]);
    T.usedIds[id.toUpperCase()] = 1;
    return id;
  }
  /** Next free ZO-YYYYMMDD-NNN for the TEST date. IDs are permanent and never reused, even after a delete. */
  function nextTestId(s, date) { return nextId(tracker(s), 'ZO-' + (isDate(date) ? date : '00000000').replace(/-/g, '') + '-'); }
  function peekTestId(s, date) {
    var T = tracker(s), prefix = ('ZO-' + (isDate(date) ? date : '00000000').replace(/-/g, '') + '-'), max = 0;
    Object.keys(T.usedIds).forEach(function (k) { if (k.indexOf(prefix) === 0) { var n = parseInt(k.slice(prefix.length), 10); if (n > max) max = n; } });
    return prefix + ('00' + (max + 1)).slice(-3);
  }
  function idTaken(s, id) { return !!tracker(s).usedIds[String(id).toUpperCase()]; }
  function nextMistakeId(s, testTid, date) {
    return nextId(tracker(s), testTid ? testTid + '-M' : 'NB-' + (isDate(date) ? date : '00000000').replace(/-/g, '') + '-M');
  }
  function findTest(s, tid) { var u = String(tid || '').toUpperCase(), a = s.tests || []; for (var i = 0; i < a.length; i++) if (String(a[i].tid || '').toUpperCase() === u) return a[i]; return null; }

  /**
   * Additive migration: every old test gets a permanent Test ID, every old notebook
   * entry gets a mistake ID and starts at "R1 pending". Nothing is removed. Returns true if it changed anything.
   */
  function normalize(s) {
    if (!isObj(s)) return false;
    var changed = false;
    if (!Array.isArray(s.tests)) s.tests = [];
    if (!Array.isArray(s.errors)) s.errors = [];
    if (!Array.isArray(s.upcomingTests)) s.upcomingTests = [];
    if (!isObj(s.tracker)) changed = true;
    var T = tracker(s);
    s.tests.forEach(function (t) { if (t && t.tid) T.usedIds[String(t.tid).toUpperCase()] = 1; });
    s.errors.forEach(function (e) { if (e && e.mid) T.usedIds[String(e.mid).toUpperCase()] = 1; });
    // two devices can hand out the same automatic ID while offline: after a merge the later test gets a fresh one
    var seenTid = {};
    s.tests.slice().sort(function (a, b) { return num(a && a.id) - num(b && b.id); }).forEach(function (t) {
      if (!t || !t.tid) return;
      var u = String(t.tid).toUpperCase();
      if (seenTid[u]) { delete t.tid; changed = true; } else seenTid[u] = 1;
    });
    s.tests.filter(function (t) { return t && !t.tid; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : num(a.id) - num(b.id); })
      .forEach(function (t) { t.tid = nextTestId(s, t.date); changed = true; });
    s.tests.forEach(function (t) {
      if (!t) return;
      if (!Array.isArray(t.subjects)) t.subjects = [];
      if (t.wrong === undefined && t.incorrect !== undefined) t.wrong = num(t.incorrect);
    });
    s.errors.filter(function (e) { return e && !e.mid; })
      .sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : num(a.id) - num(b.id); })
      .forEach(function (e) { e.mid = nextMistakeId(s, e.testId || '', e.date); changed = true; });
    s.errors.forEach(function (e) {
      if (!e) return;
      if (!e.r1) e.r1 = 'Pending';
      if (!e.r2) e.r2 = e.r1 === 'Completed' ? 'Pending' : 'Locked';
      if (!e.r3) e.r3 = e.r2 === 'Completed' ? 'Pending' : 'Locked';
      if (!Array.isArray(e.hist)) e.hist = [];
      if (!e.category) e.category = 'Other';
      if (!e.priority) e.priority = 'Medium';
      if (!e.subjectKey) e.subjectKey = subjKey(e);
    });
    return changed;
  }

  /* ------------------------------------------------------ test statistics */
  function stats(o) {
    var t = num(o.total !== undefined ? o.total : o.totalQ), a = num(o.attempted), c = num(o.correct), i = num(o.wrong !== undefined ? o.wrong : o.incorrect);
    return { totalQ: t, attempted: a, correct: c, incorrect: i, unattempted: Math.max(0, t - a) };
  }
  function pctBlock(s) {
    return { attempt: pct(s.attempted, s.totalQ), correct: pct(s.correct, s.totalQ), incorrect: pct(s.incorrect, s.totalQ),
      unattempted: pct(s.unattempted, s.totalQ), accuracy: pct(s.correct, s.attempted) };          // accuracy null => N/A
  }
  function wholeErr(v, label, out) { if (v !== '' && v !== null && v !== undefined && !/^\d+$/.test(String(v))) out.push(label + ' must be a whole number of 0 or more.'); }
  function qErrors(o, label, out) {
    wholeErr(o.total !== undefined ? o.total : o.totalQ, label + 'Total questions', out); wholeErr(o.attempted, label + 'Attempted', out);
    wholeErr(o.correct, label + 'Correct', out); wholeErr(o.wrong !== undefined ? o.wrong : o.incorrect, label + 'Incorrect', out);
    var s = stats(o);
    if (s.totalQ < 1) out.push(label + 'Total questions must be at least 1.');
    if (s.attempted > s.totalQ) out.push(label + 'Attempted (' + s.attempted + ') cannot exceed total questions (' + s.totalQ + ').');
    if (s.correct > s.attempted) out.push(label + 'Correct (' + s.correct + ') cannot exceed attempted (' + s.attempted + ').');
    if (s.incorrect > s.attempted) out.push(label + 'Incorrect (' + s.incorrect + ') cannot exceed attempted (' + s.attempted + ').');
    if (s.correct + s.incorrect !== s.attempted) out.push(label + 'Correct + Incorrect (' + (s.correct + s.incorrect) + ') must equal Attempted (' + s.attempted + ').');
  }
  function subjectSums(rows) {
    var r = { totalQ: 0, attempted: 0, correct: 0, incorrect: 0 };
    (rows || []).forEach(function (x) { var s = stats(x); r.totalQ += s.totalQ; r.attempted += s.attempted; r.correct += s.correct; r.incorrect += s.incorrect; });
    return r;
  }
  /** Full validation of a test form: returns a list of human-readable problems (empty = valid). */
  function validateTest(t, rows, incomplete) {
    var e = [];
    if (!isDate(t.date)) e.push('Test date is required.');
    if (!str(t.name, 120).trim()) e.push('Test name is required.');
    if (!TEST_TYPES[t.type]) e.push('Choose a test category.');
    qErrors(t, '', e);
    var seen = {};
    (rows || []).forEach(function (r) {
      if (seen[r.subject]) e.push(r.subject + ' is listed twice.'); seen[r.subject] = 1;
      qErrors(r, r.subject + ': ', e);
    });
    if ((rows || []).length && !incomplete) {
      var sm = subjectSums(rows), st = stats(t), bad = [];
      [['totalQ', 'total questions'], ['attempted', 'attempted'], ['correct', 'correct'], ['incorrect', 'incorrect']].forEach(function (k) {
        if (sm[k[0]] !== st[k[0]]) bad.push(k[1] + ': subjects ' + sm[k[0]] + ' vs overall ' + st[k[0]]);
      });
      if (bad.length) e.push('Subject-wise totals do not match the overall test (' + bad.join('; ') + '). Correct them, or tick "Subject breakdown is incomplete".');
    }
    if (t.score !== '' && t.score !== undefined && t.max !== '' && t.max !== undefined && num(t.score) > num(t.max)) e.push('Marks obtained cannot exceed total marks.');
    return e;
  }
  function autoScore(correct, wrong, mpq, neg) { return round2(num(correct) * num(mpq) - num(wrong) * Math.abs(num(neg))); }
  function scorePct(t) {
    if (t.score === '' || t.score === undefined || t.score === null || !(num(t.max) > 0)) return null;
    return round2(num(t.score) / num(t.max) * 100);
  }

  /* ------------------------------------------------------------ mistakes */
  function mistakeSummary(rows) {
    var s = { total: rows.length, r1Done: 0, r1Pending: 0, r2Done: 0, r2Pending: 0, r3Done: 0, r3Pending: 0, fullyRevised: 0, pending: 0 };
    rows.forEach(function (r) {
      var a = r.r1 === 'Completed', b = r.r2 === 'Completed', c = r.r3 === 'Completed';
      if (a) s.r1Done++; else s.r1Pending++;
      if (b) s.r2Done++; else if (a) s.r2Pending++;
      if (c) { s.r3Done++; s.fullyRevised++; } else if (b) s.r3Pending++;
    });
    s.pending = s.total - s.fullyRevised;
    return s;
  }
  function mistakeCounts(s) {
    var m = {};
    (s.errors || []).forEach(function (r) {
      if (!r || !r.testId) return;
      var c = m[r.testId] || (m[r.testId] = { total: 0, r1: 0, r2: 0, r3: 0 });
      c.total++; if (r.r1 === 'Completed') c.r1++; if (r.r2 === 'Completed') c.r2++; if (r.r3 === 'Completed') c.r3++;
    });
    return m;
  }
  function filterMistakes(s, f) {
    f = f || {};
    var q = str(f.q, 80).toLowerCase(), topic = str(f.topic, 80).toLowerCase(), tid = str(f.testId, 40).toLowerCase();
    return (s.errors || []).filter(function (r) {
      if (!r) return false;
      if (f.subject && subjKey(r) !== f.subject) return false;
      if (tid && String(r.testId || '').toLowerCase().indexOf(tid) === -1) return false;
      if (f.exactTestId && r.testId !== f.exactTestId) return false;
      if (f.type && r.testType !== f.type) return false;
      if (f.priority && r.priority !== f.priority) return false;
      if (f.category && r.category !== f.category) return false;
      if (isDate(f.from) && (r.date || '') < f.from) return false;
      if (isDate(f.to) && (r.date || '') > f.to) return false;
      if (topic && ((r.broad || '') + ' ' + (r.subT || '')).toLowerCase().indexOf(topic) === -1) return false;
      var a = r.r1 === 'Completed', b = r.r2 === 'Completed', c = r.r3 === 'Completed';
      if (f.rev === 'r1p' && a) return false;
      if (f.rev === 'r2p' && !(a && !b)) return false;
      if (f.rev === 'r3p' && !(b && !c)) return false;
      if (f.rev === 'full' && !c) return false;
      if (q && [r.mid, r.source, r.subjectKey, r.broad, r.subT, r.reason, r.concept, r.explanation, r.notes, r.category].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (x, y) { return (x.date || '') < (y.date || '') ? 1 : (x.date || '') > (y.date || '') ? -1 : (String(x.mid) < String(y.mid) ? -1 : 1); });
  }
  /**
   * R1 -> R2 -> R3 engine. action: 'complete' | 'reopen'. Appends to the mistake's history (never overwrites).
   * Throws Error(message) when the step is not allowed.
   */
  function revise(m, stage, action, date, notes, today, nowIso) {
    stage = Number(stage);
    if ([1, 2, 3].indexOf(stage) === -1) throw new Error('Revision stage must be R1, R2 or R3.');
    var k = 'r' + stage, nk = 'r' + (stage + 1), reopen = action === 'reopen', d = today;
    if (!reopen) {
      if (m[k] === 'Completed') throw new Error('R' + stage + ' is already completed for this mistake.');
      if (stage > 1 && m['r' + (stage - 1)] !== 'Completed') throw new Error('Complete R' + (stage - 1) + ' before R' + stage + '.');
      d = date ? String(date) : today;
      if (!isDate(d)) throw new Error('Completion date is not valid.');
      if (d > today) throw new Error('Completion date cannot be in the future.');
      m[k] = 'Completed'; m[k + 'Date'] = d; if (stage < 3) m[nk] = 'Pending';
    } else {
      if (m[k] !== 'Completed') throw new Error('R' + stage + ' is not completed, so it cannot be reopened.');
      if (stage < 3 && m[nk] === 'Completed') throw new Error('Reopen R' + (stage + 1) + ' first.');
      m[k] = 'Pending'; m[k + 'Date'] = ''; if (stage < 3) m[nk] = 'Locked';
    }
    if (!Array.isArray(m.hist)) m.hist = [];
    m.hist.push({ stage: 'R' + stage, action: reopen ? 'Reopened' : 'Completed', date: d, notes: str(notes, 2000), at: nowIso || new Date().toISOString() });
    m.resolved = m.r3 === 'Completed';
    return m;
  }

  /* ------------------------------------------------------------ analytics
     cumulative accuracy is WEIGHTED: sum(correct) / sum(attempted) */
  function selectTests(s, f) {
    f = f || {};
    return (s.tests || []).filter(function (r) {
      if (!r || !isDate(r.date)) return false;
      if (f.type && f.type !== 'ALL' && r.type !== f.type) return false;
      if (f.format && f.format !== 'ALL' && r.format !== f.format) return false;
      if (isDate(f.from) && r.date < f.from) return false;
      if (isDate(f.to) && r.date > f.to) return false;
      return true;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : num(a.id) - num(b.id); });
  }
  function sumBlock() { return { tests: 0, totalQ: 0, attempted: 0, correct: 0, incorrect: 0, unattempted: 0 }; }
  function addTo(b, st) { b.tests++; b.totalQ += st.totalQ; b.attempted += st.attempted; b.correct += st.correct; b.incorrect += st.incorrect; b.unattempted += st.unattempted; }
  function finish(b) { b.pct = pctBlock(b); return b; }

  function analytics(s, f) {
    f = f || {};
    var tests = selectTests(s, f), ids = {}, totals = sumBlock(), byType = {}, byFormat = {}, weekly = {}, monthly = {}, series = [];
    var mc = mistakeCounts(s), cumC = 0, cumA = 0, scoreSum = 0, scoreN = 0, subj = {};
    function sb(name) { return subj[name] || (subj[name] = (function () { var b = sumBlock(); b.subject = name; b.name = name; b.mistakes = 0; b.revised = 0; return b; })()); }
    tests.forEach(function (r) {
      var st = stats(r), p = pctBlock(st);
      ids[r.tid] = 1; addTo(totals, st);
      addTo(byType[r.type] || (byType[r.type] = sumBlock()), st);
      addTo(byFormat[r.format] || (byFormat[r.format] = sumBlock()), st);
      var wk = weekStart(r.date), mo = r.date.slice(0, 7);
      addTo(weekly[wk] || (weekly[wk] = sumBlock()), st); addTo(monthly[mo] || (monthly[mo] = sumBlock()), st);
      cumC += st.correct; cumA += st.attempted;
      var sp = scorePct(r); if (sp !== null) { scoreSum += sp; scoreN++; }
      series.push({ id: r.tid, key: r.id, name: r.name || '', date: r.date, type: r.type, format: r.format, totalQ: st.totalQ, attempted: st.attempted, correct: st.correct,
        incorrect: st.incorrect, accuracy: p.accuracy, attemptPct: p.attempt, incorrectPct: p.incorrect, scorePct: sp, score: r.score, max: r.max,
        cumAccuracy: pct(cumC, cumA), mistakes: (mc[r.tid] || { total: 0 }).total });
      (r.subjects || []).forEach(function (x) { if (x && x.subject) addTo(sb(x.subject), stats(x)); });
    });
    finish(totals);
    totals.avgScorePct = scoreN ? round2(scoreSum / scoreN) : null;

    var plain = (!f.type || f.type === 'ALL') && (!f.format || f.format === 'ALL'), known = {};
    (s.tests || []).forEach(function (t) { if (t && t.tid) known[t.tid] = 1; });
    var mrows = (s.errors || []).filter(function (m) {
      if (!m) return false;
      if (m.testId && known[m.testId]) return !!ids[m.testId];   // a mistake whose test was deleted counts like a notebook entry
      if (!plain) return false;                                   // notebook entries (no test) only count in the unfiltered view
      if (isDate(f.from) && (m.date || '') < f.from) return false;
      if (isDate(f.to) && (m.date || '') > f.to) return false;
      return true;
    });
    var heat = {}, topics = {};
    mrows.forEach(function (m) {
      var k = subjKey(m), b = sb(k);
      b.mistakes++; if (m.r3 === 'Completed') b.revised++;
      var h = heat[k] || (heat[k] = {}); h[m.category] = (h[m.category] || 0) + 1;
      if (m.broad) { var tk = k + '|' + String(m.broad).toLowerCase(); var t = topics[tk] || (topics[tk] = { subject: k, topic: m.broad, count: 0 }); t.count++; }
    });
    function keyed(o) { return Object.keys(o).sort().map(function (k) { var b = finish(o[k]); b.key = k; return b; }); }
    return {
      filter: { type: f.type || 'ALL', format: f.format || 'ALL', from: f.from || '', to: f.to || '' },
      totals: totals, series: series,
      byType: TYPE_KEYS.map(function (k) { var b = finish(byType[k] || sumBlock()); b.key = k; b.label = TEST_TYPES[k]; return b; }),
      byFormat: keyed(byFormat), weekly: keyed(weekly), monthly: keyed(monthly),
      bySubject: Object.keys(subj).sort().map(function (k) { return finish(subj[k]); }),
      mistakes: mistakeSummary(mrows), heat: heat, categories: MISTAKE_CATEGORIES,
      topTopics: Object.keys(topics).map(function (k) { return topics[k]; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 20)
    };
  }

  /**
   * Weightage predictor. "blueprint" = the app's editable estimate, "manual" = figures the student typed,
   * "estimated" = derived from the student's own GT / Mock tests of that exam with a complete subject breakdown.
   * Nothing here is an official weightage.
   */
  function weightage(s, exam, blueprint, subjects) {
    var T = tracker(s), fmt = /^INICET/i.test(exam) ? 'INICET' : exam;
    var manual = isObj(T.weights[exam]) ? T.weights[exam] : {};
    var bp = (blueprint && isObj(blueprint.subjects)) ? blueprint.subjects : {};
    var examTotal = num(blueprint && blueprint.max) || (FORMATS[fmt] || FORMATS.Other).total;
    var basis = {}, basisQ = 0, basisN = 0, share = {};
    (s.tests || []).forEach(function (t) {
      if (!t || t.format !== fmt || (t.type !== 'GT' && t.type !== 'Mock') || !(t.subjects || []).length || t.subjIncomplete) return;
      basis[t.tid] = 1; basisQ += stats(t).totalQ; basisN++;
      t.subjects.forEach(function (x) { share[x.subject] = (share[x.subject] || 0) + stats(x).totalQ; });
    });
    var a = analytics(s, {}), perf = {};
    a.bySubject.forEach(function (b) { perf[b.subject] = b; });
    var names = subjects && subjects.length ? subjects.slice() : Object.keys(bp);
    Object.keys(perf).concat(Object.keys(manual)).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
    return {
      exam: exam, format: fmt, examTotal: examTotal, basisTests: basisN,
      rows: names.map(function (n) {
        var b = perf[n];
        return { subject: n, blueprint: bp[n] === undefined ? '' : num(bp[n]), manual: manual[n] === undefined || manual[n] === '' ? '' : num(manual[n]),
          estimated: basisQ ? round2((share[n] || 0) / basisQ * examTotal) : null,
          attempted: b ? b.attempted : 0, accuracy: b ? b.pct.accuracy : null, mistakes: b ? b.mistakes : 0 };
      }),
      topTopics: a.topTopics
    };
  }

  /* -------------------------------------------------------------- streaks */
  function streakStats(dates, today) {
    var set = {}; dates.forEach(function (d) { if (isDate(d) && d <= today) set[d] = 1; });
    var sorted = Object.keys(set).sort(), longest = 0, run = 0, prev = '';
    sorted.forEach(function (d) { run = (prev && addDays(prev, 1) === d) ? run + 1 : 1; if (run > longest) longest = run; prev = d; });
    var cur = 0, d = set[today] ? today : addDays(today, -1);
    while (set[d]) { cur++; d = addDays(d, -1); }
    return { current: cur, longest: longest, total: sorted.length, last: sorted[sorted.length - 1] || '', dates: sorted.slice(-400) };
  }
  /** Activity streaks derived from the records themselves (so they can never drift or be double counted). */
  function streaks(s, today) {
    var test = [], mcq = [], rev = [];
    (s.tests || []).forEach(function (t) { if (!t) return; if (t.type === 'Daily') mcq.push(t.date); else test.push(t.date); });
    (s.mcqPractice || []).forEach(function (m) { if (m) mcq.push(m.date); });
    (s.errors || []).forEach(function (e) { (e && e.hist || []).forEach(function (h) { if (h.action === 'Completed') rev.push(h.date); }); });
    var plan = [];   // v4.1: completed planner tasks count as study days, MCQs done in a task count for the MCQ streak
    (Array.isArray(s.plannerTasks) ? s.plannerTasks : []).forEach(function (p) { if (!isObj(p) || !isDate(p.date) || (today && p.date > today)) return; if (num(p.mcqDone) > 0) mcq.push(p.date); if (p.status === 'Completed') plan.push(p.date); });
    return { test: streakStats(test, today), mcq: streakStats(mcq, today), revision: streakStats(rev, today), study: streakStats(test.concat(mcq, rev, plan), today) };
  }

  /* -------------------------------------------------------------- reports
     Every report is { title, subtitle, sections:[{ name, columns, rows }] } so one writer
     can turn any of them into PDF, Excel or CSV. */
  var MISTAKE_COLS = ['Mistake ID', 'Test ID', 'Source / test', 'Date', 'Test type', 'Subject', 'Topic', 'Subtopic', 'Q no.', 'Category', 'Priority', 'Reason',
    'Correct answer / concept', 'Explanation', 'Learning notes', 'R1', 'R1 date', 'R2', 'R2 date', 'R3', 'R3 date'];
  function mistakeRow(m) {
    return [m.mid || '', m.testId || '', m.source || '', m.date || '', typeLabel(m.testType), subjKey(m), m.broad || '', m.subT || '', m.qno || '', m.category || '', m.priority || '',
      m.reason || '', m.concept || '', m.explanation || '', m.notes || '', m.r1 || '', m.r1Date || '', m.r2 || '', m.r2Date || '', m.r3 || '', m.r3Date || ''];
  }
  var STAT_COLS = ['Total', 'Attempted', 'Correct', 'Incorrect', 'Unattempted', 'Attempt %', 'Accuracy %', 'Correct %', 'Incorrect %', 'Unattempted %'];
  function statRow(st) { var p = pctBlock(st); return [st.totalQ, st.attempted, st.correct, st.incorrect, st.unattempted, fmtPct(p.attempt), fmtPct(p.accuracy), fmtPct(p.correct), fmtPct(p.incorrect), fmtPct(p.unattempted)]; }
  function revisionSection(rows) {
    var out = [];
    rows.forEach(function (m) { (m.hist || []).forEach(function (h) { out.push([m.mid || '', m.testId || '', h.stage, h.action, h.date, h.notes || '', h.at || '']); }); });
    return { name: 'Revision history', columns: ['Mistake ID', 'Test ID', 'Stage', 'Action', 'Date', 'Notes', 'Recorded at'], rows: out };
  }
  function testReport(s, tid) {
    var t = findTest(s, tid);
    if (!t) throw new Error('Test not found.');
    var st = stats(t), p = pctBlock(st), ms = (s.errors || []).filter(function (m) { return m && m.testId === t.tid; });
    return { title: 'Zona Occludens Test Report - ' + t.tid, subtitle: (t.name || '') + ' | ' + t.date + ' | ' + typeLabel(t.type), sections: [
      { name: 'Test', columns: ['Field', 'Value'], rows: [['Test ID', t.tid], ['Test name', t.name || ''], ['Test type', typeLabel(t.type)], ['Exam format', t.format || ''], ['Provider', t.provider || ''],
        ['Test date', t.date], ['Start time', t.startTime || ''], ['End time', t.endTime || ''], ['Duration (min)', t.durationMin === undefined ? '' : t.durationMin],
        ['Marks per question', t.mpq === undefined ? '' : t.mpq], ['Negative marking', t.neg === undefined ? '' : t.neg], ['Marks obtained', t.score === undefined ? '' : t.score], ['Total marks', t.max === undefined ? '' : t.max],
        ['Subjects covered', (t.coveredSubjects || []).join(', ')], ['Topics covered', t.topicsCovered || ''], ['Remarks', t.remarks || ''],
        ['Total questions', st.totalQ], ['Attempted', st.attempted], ['Correct', st.correct], ['Incorrect', st.incorrect], ['Unattempted', st.unattempted],
        ['Attempt %', fmtPct(p.attempt)], ['Accuracy % (this test only)', fmtPct(p.accuracy)], ['Correct %', fmtPct(p.correct)], ['Incorrect %', fmtPct(p.incorrect)], ['Unattempted %', fmtPct(p.unattempted)],
        ['Subject data', (t.subjects || []).length ? (t.subjIncomplete ? 'incomplete' : 'complete') : 'none'], ['Analysed', t.analysed ? 'Yes' : 'No'], ['Mistakes recorded', ms.length]] },
      { name: 'Subject performance', columns: ['Subject'].concat(STAT_COLS, ['Marks', 'Remarks']), rows: (t.subjects || []).map(function (x) { return [x.subject].concat(statRow(stats(x)), [x.marks === undefined ? '' : x.marks, x.remarks || '']); }) },
      { name: 'Mistakes', columns: MISTAKE_COLS, rows: ms.map(mistakeRow) },
      revisionSection(ms)
    ] };
  }
  /* ------------------------------------------------ v4.1 task planner, settings, subject list, topic library */
  function cleanStr(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[<>]/g, '').trim().slice(0, n); }
  function cleanText(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n); }
  function optNum(v, lo, hi, half) { if (v === '' || v === null || v === undefined) return ''; var n = Number(v); if (!isFinite(n)) return ''; n = Math.max(lo, Math.min(hi, n)); return half ? Math.round(n * 2) / 2 : Math.round(n); }
  /** Settings with defaults; every value validated (dates ISO, start <= end, at most 1100 days, sane numbers). */
  function akSettings(s, profile) {
    var a = isObj(s.akSettings) ? s.akSettings : {}, o = {};
    Object.keys(AK_DEFAULTS).forEach(function (k) { o[k] = a[k] === undefined ? AK_DEFAULTS[k] : a[k]; });
    ['inicetDate', 'neetpgDate'].forEach(function (k) { if (o[k] !== '' && !isDate(o[k])) o[k] = AK_DEFAULTS[k]; });
    if (!isDate(o.plannerStart)) o.plannerStart = AK_DEFAULTS.plannerStart;
    if (!isDate(o.plannerEnd) || o.plannerEnd < o.plannerStart || dayDiff(o.plannerStart, o.plannerEnd) > AK_LIMITS.periodDays) o.plannerEnd = addDays(o.plannerStart, Math.min(AK_LIMITS.periodDays, Math.max(0, dayDiff(AK_DEFAULTS.plannerStart, AK_DEFAULTS.plannerEnd))));
    o.dailyGoalHours = optNum(o.dailyGoalHours, 0, 24, true); if (o.dailyGoalHours === '') o.dailyGoalHours = AK_DEFAULTS.dailyGoalHours;
    o.dailyMcqTarget = optNum(o.dailyMcqTarget, 0, 2000); if (o.dailyMcqTarget === '') o.dailyMcqTarget = AK_DEFAULTS.dailyMcqTarget;
    ['inicetTotalQ', 'neetpgTotalQ'].forEach(function (k) { o[k] = optNum(o[k], 1, 1000); if (o[k] === '') o[k] = AK_DEFAULTS[k]; });
    o.userName = cleanStr(o.userName || (profile && profile.name) || '', 60);
    return o;
  }
  /** Validates the settings form. Returns { ok, settings, errors }. */
  function validateSettings(p) {
    var e = [], o = {};
    o.userName = cleanStr(p.userName, 60);
    ['inicetDate', 'neetpgDate'].forEach(function (k) { var v = String(p[k] || ''); if (v && !isDate(v)) e.push('Enter a valid ' + (k === 'inicetDate' ? 'INICET' : 'NEET PG') + ' date.'); o[k] = isDate(v) ? v : ''; });
    o.plannerStart = String(p.plannerStart || ''); o.plannerEnd = String(p.plannerEnd || '');
    if (!isDate(o.plannerStart) || !isDate(o.plannerEnd)) e.push('Planner start and end dates are required.');
    else if (o.plannerStart > o.plannerEnd) e.push('The planner start date must be on or before the end date.');
    else if (dayDiff(o.plannerStart, o.plannerEnd) > AK_LIMITS.periodDays) e.push('The planner period can be at most ' + AK_LIMITS.periodDays + ' days.');
    var chk = function (k, lo, hi, label, half) { var v = p[k]; if (v === '' || v === null || v === undefined || !isFinite(Number(v)) || Number(v) < lo || Number(v) > hi) { e.push(label + ' must be between ' + lo + ' and ' + hi + '.'); o[k] = AK_DEFAULTS[k]; } else o[k] = half ? Math.round(Number(v) * 2) / 2 : Math.round(Number(v)); };
    chk('dailyGoalHours', 0, 24, 'Daily study goal (hours)', true); chk('dailyMcqTarget', 0, 2000, 'Daily MCQ target');
    chk('inicetTotalQ', 1, 1000, 'INICET total questions'); chk('neetpgTotalQ', 1, 1000, 'NEET PG total questions');
    return { ok: !e.length, settings: o, errors: e };
  }
  /** One planner task, validated. period = { plannerStart, plannerEnd } (optional). Returns { ok, task, errors }. */
  function normTask(p, period) {
    p = isObj(p) ? p : {}; var e = [], date = String(p.date || '');
    if (!isDate(date)) e.push('Task date is required.');
    else if (period && isDate(period.plannerStart) && isDate(period.plannerEnd) && (date < period.plannerStart || date > period.plannerEnd)) e.push('Date must be inside the planner period (' + period.plannerStart + ' to ' + period.plannerEnd + ').');
    var hrs = p.hours === '' || p.hours === undefined || p.hours === null ? '' : Number(p.hours);
    if (hrs !== '' && (!isFinite(hrs) || hrs < 0 || hrs > 24)) e.push('Study hours must be between 0 and 24.');
    var intF = function (k, label) { var v = p[k]; if (v === '' || v === undefined || v === null) return ''; var n = Number(v); if (!isFinite(n) || n < 0 || n > 5000 || Math.floor(n) !== n) { e.push(label + ' must be a whole number from 0 to 5000.'); return ''; } return n; };
    var t = { id: cleanStr(p.id, 40), date: date, subject: cleanStr(p.subject, 60), topic: cleanStr(p.topic, 120), subtopic: cleanStr(p.subtopic, 120), studyTarget: cleanStr(p.studyTarget, 300),
      hours: hrs === '' || !isFinite(hrs) ? '' : Math.round(Math.max(0, Math.min(24, hrs)) * 4) / 4, mcqTarget: intF('mcqTarget', 'MCQ target'), mcqDone: intF('mcqDone', 'MCQs done'),
      revisionTarget: cleanStr(p.revisionTarget, 300), gtTarget: cleanStr(p.gtTarget, 200), priority: TASK_TAGS.indexOf(p.priority) > -1 ? p.priority : '',
      status: TASK_STATUS.indexOf(p.status) > -1 ? p.status : 'Not Started', remarks: cleanText(p.remarks, 1000), rescheduledFrom: isDate(p.rescheduledFrom) ? p.rescheduledFrom : '' };
    if (!t.subject && !t.topic && !t.studyTarget && !t.revisionTarget && !t.gtTarget && t.mcqTarget === '') e.push('Enter at least a subject, topic or target.');
    if (isObj(p.xpA)) t.xpA = p.xpA;
    if (p.created) t.created = cleanStr(p.created, 40);
    if (p.updated) t.updated = cleanStr(p.updated, 40);
    return { ok: !e.length, task: t, errors: e };
  }
  var isMissedTask = function (t, today) { return !!t && t.date < today && (t.status === 'Not Started' || t.status === 'In Progress'); };
  /** done / total for planner tasks between two dates (postponed copies are not counted). */
  function taskStats(s, from, to, today) {
    var total = 0, done = 0, missed = 0;
    (Array.isArray(s.plannerTasks) ? s.plannerTasks : []).forEach(function (t) {
      if (!isObj(t) || !isDate(t.date) || t.status === 'Postponed') return;
      if ((from && t.date < from) || (to && t.date > to)) return;
      total++; if (t.status === 'Completed') done++; if (today && isMissedTask(t, today)) missed++;
    });
    return { total: total, done: done, missed: missed, pct: total ? Math.round(done / total * 100) : 0 };
  }
  /** Caps sizes and cleans every v4.1 field. Used by the server on every sync; safe to run on the client too. */
  function cleanAk(s) {
    if (!isObj(s)) return s;
    if (s.plannerTasks !== undefined) {
      var seen = {}, out = [];
      (Array.isArray(s.plannerTasks) ? s.plannerTasks : []).forEach(function (p) {
        if (!isObj(p)) return; var r = normTask(p, null), t = r.task;
        if (!isDate(t.date)) return;
        if (!t.id || seen[t.id]) t.id = 'PL-' + t.date.replace(/-/g, '') + '-' + Object.keys(seen).length;
        seen[t.id] = 1; out.push(t);
      });
      s.plannerTasks = out.slice(-AK_LIMITS.tasks);
    }
    if (s.topicLibrary !== undefined) {
      var key = {}, lib = [];
      (Array.isArray(s.topicLibrary) ? s.topicLibrary : []).forEach(function (x) {
        if (!isObj(x)) return; var o = { id: cleanStr(x.id, 40), subject: cleanStr(x.subject, 60), topic: cleanStr(x.topic, 120), subtopic: cleanStr(x.subtopic, 120), src: x.src === 'auto' ? 'auto' : 'manual' };
        if (!o.subject || !o.topic) return; var k = (o.subject + '|' + o.topic + '|' + o.subtopic).toLowerCase(); if (key[k]) return; key[k] = 1;
        if (!o.id) o.id = 'TP-' + lib.length; lib.push(o);
      });
      s.topicLibrary = lib.slice(-AK_LIMITS.topics);
    }
    if (s.akSubjects !== undefined) {
      var names = {}, subs = [];
      (Array.isArray(s.akSubjects) ? s.akSubjects : []).forEach(function (x, i) {
        if (!isObj(x)) return; var n = cleanStr(x.name, 60); if (!n || names[n.toLowerCase()]) return; names[n.toLowerCase()] = 1;
        subs.push({ name: n, base: cleanStr(x.base || n, 60), short: cleanStr(x.short, 8).toUpperCase(), color: /^#[0-9a-fA-F]{6}$/.test(String(x.color)) ? String(x.color) : '#7856FF', order: optNum(x.order, 0, 999) === '' ? i + 1 : optNum(x.order, 0, 999), active: x.active !== false });
      });
      s.akSubjects = subs.slice(0, AK_LIMITS.subjects);
    }
    if (s.akSettings !== undefined) s.akSettings = akSettings(s, s.userProfile);
    return s;
  }

  /** kind: test | tests | subjects | mistakes | revisions | planner | mcq | overall */
  function report(s, kind, o) {
    o = o || {}; var f = o.filter || {};
    var range = (f.from || f.to) ? (' | ' + (f.from || 'start') + ' to ' + (f.to || 'today')) : '';
    if (kind === 'test') return testReport(s, o.id);
    if (kind === 'tests') {
      var mc = mistakeCounts(s), tests = selectTests(s, f);
      return { title: 'Zona Occludens Test History', subtitle: 'Tests: ' + tests.length + range, sections: [{ name: 'Tests',
        columns: ['Test ID', 'Test name', 'Date', 'Type', 'Format', 'Provider'].concat(STAT_COLS, ['Marks', 'Total marks', 'Mistakes', 'R1 done', 'R2 done', 'R3 done']),
        rows: tests.map(function (t) { var m = mc[t.tid] || { total: 0, r1: 0, r2: 0, r3: 0 }; return [t.tid, t.name || '', t.date, typeLabel(t.type), t.format || '', t.provider || ''].concat(statRow(stats(t)), [t.score === undefined ? '' : t.score, t.max === undefined ? '' : t.max, m.total, m.r1, m.r2, m.r3]); }) }] };
    }
    if (kind === 'subjects' || kind === 'overall') {
      var a = analytics(s, f), T = a.totals, M = a.mistakes;
      var subj = { name: 'Subject analytics', columns: ['Subject', 'Tests'].concat(STAT_COLS, ['Mistakes', 'Fully revised']),
        rows: a.bySubject.map(function (b) { return [b.name, b.tests].concat(statRow(b), [b.mistakes, b.revised]); }) };
      if (kind === 'subjects') return { title: 'Zona Occludens Subject-wise Analytics', subtitle: 'Filter: ' + a.filter.type + range, sections: [subj] };
      return { title: 'Zona Occludens Overall Performance Report', subtitle: 'Filter: ' + a.filter.type + range, sections: [
        { name: 'Summary', columns: ['Metric', 'Value'], rows: [['Total tests', T.tests], ['Total questions', T.totalQ], ['Total attempted', T.attempted], ['Total correct', T.correct],
          ['Total incorrect', T.incorrect], ['Total unattempted', T.unattempted], ['Overall cumulative accuracy (weighted)', fmtPct(T.pct.accuracy)], ['Overall attempt %', fmtPct(T.pct.attempt)],
          ['Average test score %', fmtPct(T.avgScorePct)], ['Total mistakes', M.total], ['R1 completed', M.r1Done], ['R2 completed', M.r2Done], ['R3 completed', M.r3Done], ['Pending revisions', M.pending]] },
        { name: 'By test type', columns: ['Type', 'Tests'].concat(STAT_COLS), rows: a.byType.map(function (b) { return [b.label, b.tests].concat(statRow(b)); }) },
        { name: 'By exam format', columns: ['Format', 'Tests'].concat(STAT_COLS), rows: a.byFormat.map(function (b) { return [b.key, b.tests].concat(statRow(b)); }) },
        { name: 'Test-wise', columns: ['Test ID', 'Test name', 'Date', 'Type', 'Accuracy %', 'Attempt %', 'Cumulative accuracy %', 'Mistakes'],
          rows: a.series.map(function (x) { return [x.id, x.name, x.date, typeLabel(x.type), fmtPct(x.accuracy), fmtPct(x.attemptPct), fmtPct(x.cumAccuracy), x.mistakes]; }) },
        subj] };
    }
    if (kind === 'mistakes' || kind === 'revisions') {
      var rows = filterMistakes(s, f);
      if (kind === 'revisions') return { title: 'Zona Occludens R1-R2-R3 Revision History', subtitle: 'Mistakes: ' + rows.length, sections: [
        { name: 'Revision status', columns: ['Mistake ID', 'Test ID', 'Subject', 'Topic', 'R1', 'R1 date', 'R2', 'R2 date', 'R3', 'R3 date'],
          rows: rows.map(function (m) { return [m.mid || '', m.testId || '', subjKey(m), m.broad || '', m.r1, m.r1Date || '', m.r2, m.r2Date || '', m.r3, m.r3Date || '']; }) }, revisionSection(rows)] };
      return { title: f.exactTestId ? 'Zona Occludens Mistake Log - ' + f.exactTestId : 'Zona Occludens Global Mistake Log', subtitle: 'Mistakes: ' + rows.length, sections: [{ name: 'Mistakes', columns: MISTAKE_COLS, rows: rows.map(mistakeRow) }] };
    }
    if (kind === 'planner') {
      var days = Object.keys(isObj(s.planner) ? s.planner : {}).filter(function (d) { return isDate(d) && (!isDate(f.from) || d >= f.from) && (!isDate(f.to) || d <= f.to); }).sort(), prow = [];
      days.forEach(function (d) {
        var e = s.planner[d]; if (!isObj(e)) return;
        var tg = (e.targets || []).map(function (t) { return typeof t === 'string' ? { text: t, done: false } : t; });
        if (!tg.length && !e.subject && !e.notes) return;
        prow.push([d, e.subject || '', e.priority || '', tg.map(function (t) { return (t.done ? '[x] ' : '[ ] ') + t.text; }).join('\n'), tg.filter(function (t) { return t.done; }).length + ' / ' + tg.length,
          e.dayFinished ? 'Yes' : 'No', e.starClaimed ? 'Yes' : 'No', e.trophyEarned ? 'Yes' : 'No', (e.arsenal || []).join(', '), e.notes || '']);
      });
      var trow = (Array.isArray(s.plannerTasks) ? s.plannerTasks : []).filter(function (t) { return isObj(t) && isDate(t.date) && (!isDate(f.from) || t.date >= f.from) && (!isDate(f.to) || t.date <= f.to); })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
        .map(function (t) { return [t.date, t.subject || '', t.topic || '', t.subtopic || '', t.studyTarget || '', t.hours === undefined ? '' : t.hours, t.mcqTarget === undefined ? '' : t.mcqTarget, t.mcqDone === undefined ? '' : t.mcqDone, t.revisionTarget || '', t.gtTarget || '', t.priority || '', t.status || '', t.rescheduledFrom || '', t.remarks || '']; });
      var ts = taskStats(s, isDate(f.from) ? f.from : '', isDate(f.to) ? f.to : '', '');
      return { title: 'Zona Occludens Planner', subtitle: (f.from || 'start') + ' to ' + (f.to || 'end') + ' | ' + trow.length + ' tasks (' + ts.done + ' completed) | ' + prow.length + ' classic planner days', sections: [
        { name: 'Planner tasks', columns: ['Date', 'Subject', 'Topic', 'Subtopic', 'Study target', 'Hours', 'MCQ target', 'MCQs done', 'Revision target', 'Grand Test target', 'Priority tag', 'Status', 'Moved from', 'Remarks'], rows: trow },
        { name: 'Classic planner', columns: ['Date', 'Subject', 'Priority', 'Targets', 'Done', 'Day finished', 'Star', 'Trophy', 'Resources', 'Notes'], rows: prow }] };
    }
    if (kind === 'mcq') {
      var ms = (s.mcqPractice || []).filter(function (m) { return m && (!isDate(f.from) || (m.date || '') >= f.from) && (!isDate(f.to) || (m.date || '') <= f.to); })
        .sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
      return { title: 'Zona Occludens Daily MCQ Practice', subtitle: 'Sessions: ' + ms.length + range, sections: [{ name: 'MCQ practice',
        columns: ['Date', 'Source', 'Subject', 'Topics', 'Attempted', 'Correct', 'Wrong', 'Accuracy %'],
        rows: ms.map(function (m) { return [m.date || '', m.source || '', m.subject || '', m.topics || '', m.attempted === undefined ? '' : m.attempted, m.correct === undefined ? '' : m.correct, m.wrong === undefined ? '' : m.wrong, m.accuracy === undefined ? '' : m.accuracy]; }) }] };
    }
    throw new Error('Unknown report.');
  }

  /** Small per-user summary kept in Users_DB so the admin panel can show performance without decrypting everything. */
  function userSummary(s) {
    var a = analytics(s, {});
    return { tests: a.totals.tests, mistakes: a.mistakes.total, accuracy: a.totals.pct.accuracy === null ? '' : a.totals.pct.accuracy, pendingRev: a.mistakes.pending };
  }

  return {
    VERSION: VERSION, TEST_TYPES: TEST_TYPES, TYPE_KEYS: TYPE_KEYS, FORMATS: FORMATS, MISTAKE_CATEGORIES: MISTAKE_CATEGORIES, PRIORITIES: PRIORITIES,
    UPCOMING_STATUS: UPCOMING_STATUS, REWARDS: REWARDS, TASK_STATUS: TASK_STATUS, TASK_TAGS: TASK_TAGS, AK_DEFAULTS: AK_DEFAULTS, AK_LIMITS: AK_LIMITS,
    akSettings: akSettings, validateSettings: validateSettings, normTask: normTask, isMissedTask: isMissedTask, taskStats: taskStats, cleanAk: cleanAk,
    isObj: isObj, num: num, pct: pct, round2: round2, isDate: isDate, addDays: addDays, dayDiff: dayDiff, weekStart: weekStart, fmtPct: fmtPct, typeLabel: typeLabel, subjKey: subjKey,
    tracker: tracker, normalize: normalize, nextTestId: nextTestId, peekTestId: peekTestId, idTaken: idTaken, nextMistakeId: nextMistakeId, findTest: findTest,
    stats: stats, pctBlock: pctBlock, qErrors: qErrors, subjectSums: subjectSums, validateTest: validateTest, autoScore: autoScore, scorePct: scorePct,
    mistakeSummary: mistakeSummary, mistakeCounts: mistakeCounts, filterMistakes: filterMistakes, revise: revise,
    selectTests: selectTests, analytics: analytics, weightage: weightage, streakStats: streakStats, streaks: streaks,
    testReport: testReport, report: report, userSummary: userSummary
  };
})();
