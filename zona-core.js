/* =====================================================================
   Zona Occludens: core runtime  (loaded BEFORE the main inline script)
   ---------------------------------------------------------------------
   Everything is exposed on window.Zona. Nothing here touches the page
   until Zona.boot() runs (from zona-boot.js, after the main script).

   Modules
     Zona.util      tiny helpers (h(), storage, throttle, ids)
     Zona.bus       event bus  ->  Zona.bus.on('state', fn)
     Zona.modal     promise-based confirm / prompt / choice / custom dialogs
     Zona.session   device key + signed session token
     Zona.api       authenticated POST client for Apps Script
     Zona.sync      dirty tracking, debounced save, offline + retry, status pill
     Zona.lock      15-minute inactivity lock
     Zona.makeEmbed fullscreen manager for iframe cards (iOS fallback included)
     Zona.theme     5 themes, persisted locally + in state.settings
     Zona.data      export / import (validate, merge, replace) / snapshots / delete account
     Zona.settings  Settings page
     Zona.social    announcements + leaderboard
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.ZONA_CONFIG || {};
  const Zona = window.Zona = { version: '3.0.0', deleting: false, origin: (location.origin === 'null' ? '*' : location.origin) };   // postMessage target for our own iframes

  /* ------------------------------------------------------------------ util */
  const util = Zona.util = {};
  util.$ = id => document.getElementById(id);
  /** Safe element builder: strings become text nodes, never HTML. */
  util.h = function (tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    const kids = Array.prototype.slice.call(arguments, 2);
    (function add(list) {
      list.forEach(c => {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) add(c);
        else el.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return el;
  };
  util.ico = (name, extra) => util.h('i', { class: 'fas fa-' + name + (extra ? ' ' + extra : ''), 'aria-hidden': 'true' });
  const store = (area) => ({
    get(k) { try { return window[area].getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window[area].setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { window[area].removeItem(k); } catch (e) {} }
  });
  util.ls = store('localStorage');
  util.ss = store('sessionStorage');
  util.randHex = function (bytes) {
    const a = new Uint8Array(bytes);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, b => ('0' + b.toString(16)).slice(-2)).join('');
  };
  util.throttle = function (fn, ms) { let t = 0; return function () { const n = Date.now(); if (n - t >= ms) { t = n; fn.apply(this, arguments); } }; };
  util.debounce = function (fn, ms) { let t; const w = function () { clearTimeout(t); const a = arguments, c = this; t = setTimeout(() => fn.apply(c, a), ms); }; w.now = function () { clearTimeout(t); return fn.apply(this, arguments); }; return w; };
  util.toast = function (msg, type) { try { if (typeof showToast === 'function') return showToast(msg, type || 'info'); } catch (e) {} };
  util.isoToday = function () { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  util.fmtDate = function (iso) { try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso); } };
  util.profile = function () { try { return (typeof state !== 'undefined' && state.userProfile && state.userProfile.mobile) ? state.userProfile : null; } catch (e) { return null; } };
  util.settings = function () {
    if (typeof state === 'undefined') return {};
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    const s = state.settings;
    if (!s.notif || typeof s.notif !== 'object') s.notif = { daily: false, time: '20:00', streak: true, announce: true };
    if (typeof s.autoBackupMin !== 'number') s.autoBackupMin = CFG.DEFAULT_AUTOBACKUP_MIN || 15;
    if (typeof s.lockMin !== 'number') s.lockMin = CFG.INACTIVITY_LOCK_MIN || 15;
    return s;
  };
  util.mkErr = (code, message) => { const e = new Error(message || code); e.code = code; return e; };
  /** Turns a backend/network error into a sentence a human can act on. */
  util.explain = function (e) {
    const c = e && e.code, m = (e && e.message) || '';
    if (c === 'OLD_BACKEND' || /Invalid action command/i.test(m)) return 'Your Apps Script is still the OLD code.gs. Paste the new code.gs and deploy a NEW VERSION.';
    if (c === 'FORBIDDEN' && /^Forbidden/.test(m)) return 'API key mismatch: API_KEY in zona-config.js must equal the one in code.gs (then run setupZona).';
    if (c === 'NOT_CONFIGURED') return 'Backend is not set up yet: run setupZona() in Apps Script.';
    if (c === 'NETWORK') return 'Cannot reach the backend. Check API_URL in zona-config.js and that the web app access is set to Anyone.';
    if (c === 'OFFLINE') return 'You are offline.';
    return m || 'Unknown error';
  };

  /* ------------------------------------------------------------------- bus */
  const listeners = {};
  Zona.bus = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit(ev, data) { (listeners[ev] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error('[Zona.bus]', ev, e); } }); }
  };

  /* ----------------------------------------------------------------- modal */
  const modal = Zona.modal = {};
  let modalSeq = 0;
  /**
   * opts: { title, message|body(Node), icon, danger, input:{placeholder, match, label, type, maxlength},
   *         buttons:[{id,label,primary,danger}], cancelValue }
   * resolves with: button id (or {id,value} when an input is present). Escape / backdrop => cancelValue.
   */
  modal.open = function (opts) {
    return new Promise(resolve => {
      const h = util.h, uid = 'zm' + (++modalSeq);
      const prevFocus = document.activeElement;
      const cancelValue = 'cancelValue' in opts ? opts.cancelValue : null;
      let input = null, body;
      const btns = (opts.buttons || [{ id: 'ok', label: 'OK', primary: true }]).map(b => {
        const el = h('button', { type: 'button', class: 'btn ' + (b.primary ? (opts.danger ? 'btn-danger' : 'btn-primary') : 'btn-outline'), 'data-id': b.id, text: b.label });
        el.addEventListener('click', () => finish(b.id));
        return el;
      });
      if (opts.input) {
        input = h('input', { class: 'form-control zm-input', type: opts.input.type || 'text', placeholder: opts.input.placeholder || '', maxlength: opts.input.maxlength || 80, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': opts.input.label || opts.title });
        if (opts.input.match) {
          const primary = btns.find(b => b.classList.contains('btn-danger') || b.classList.contains('btn-primary'));
          if (primary) primary.disabled = true;
          input.addEventListener('input', () => { if (primary) primary.disabled = input.value.trim() !== opts.input.match; });
        }
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { const p = btns.find(b => !b.disabled && !b.classList.contains('btn-outline')); if (p) p.click(); } });
      }
      body = h('div', { class: 'zm-body' },
        opts.message ? h('p', { class: 'zm-msg', text: opts.message }) : null,
        opts.body || null,
        opts.input ? h('label', { class: 'zm-lbl', for: uid + 'i', text: opts.input.label || '' }) : null,
        input);
      if (input) { input.id = uid + 'i'; }
      const box = h('div', { class: 'zm-box' + (opts.danger ? ' danger' : ''), role: opts.danger ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': uid + 't' },
        h('div', { class: 'zm-ico' }, util.ico(opts.icon || (opts.danger ? 'triangle-exclamation' : 'circle-info'))),
        h('h3', { id: uid + 't', class: 'zm-title', text: opts.title || '' }),
        body,
        h('div', { class: 'zm-actions' }, btns));
      const ov = h('div', { class: 'zm-overlay' }, box);
      document.body.append(ov);
      document.documentElement.classList.add('zm-open');
      requestAnimationFrame(() => ov.classList.add('show'));
      setTimeout(() => { (input || btns[btns.length - 1]).focus({ preventScroll: true }); }, 60);

      function finish(id) {
        document.removeEventListener('keydown', onKey, true);
        ov.classList.remove('show');
        document.documentElement.classList.remove('zm-open');
        setTimeout(() => ov.remove(), 220);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) {}
        if (id === '__cancel') return resolve(cancelValue);
        resolve(input ? { id: id, value: input.value.trim() } : id);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); finish('__cancel'); return; }
        if (e.key !== 'Tab') return;
        const f = box.querySelectorAll('button:not([disabled]), input, a[href]');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey, true);
      ov.addEventListener('mousedown', e => { if (e.target === ov && opts.dismissible !== false) finish('__cancel'); });
    });
  };
  modal.confirm = function (o) {
    return modal.open({
      title: o.title, message: o.message, danger: o.danger, icon: o.icon, cancelValue: false,
      input: o.typeToConfirm ? { placeholder: 'Type ' + o.typeToConfirm, match: o.typeToConfirm, label: 'Type ' + o.typeToConfirm + ' to confirm', maxlength: 20 } : null,
      buttons: [{ id: 'no', label: o.cancelLabel || 'Cancel' }, { id: 'yes', label: o.confirmLabel || 'Confirm', primary: true }]
    }).then(r => (r && (r === 'yes' || r.id === 'yes')) ? true : false);
  };
  modal.prompt = function (o) {
    return modal.open({
      title: o.title, message: o.message, icon: o.icon || 'key', cancelValue: null,
      input: { placeholder: o.placeholder, label: o.label, type: o.type, maxlength: o.maxlength },
      buttons: [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: o.confirmLabel || 'Continue', primary: true }]
    }).then(r => (r && r.id === 'yes' && r.value) ? r.value : null);
  };
  modal.choice = function (o) {
    return modal.open({
      title: o.title, message: o.message, icon: o.icon, body: o.body, cancelValue: null,
      buttons: [{ id: '__x', label: 'Cancel' }].concat(o.choices)
    }).then(r => (r === '__x' ? null : r));
  };
  modal.alert = function (o) {
    return modal.open({ title: o.title, message: o.message, icon: o.icon, body: o.body, buttons: [{ id: 'ok', label: o.okLabel || 'OK', primary: true }], cancelValue: 'ok' });
  };
  /** Full-screen success / busy overlay. Returns {close()} */
  modal.busy = function (label) {
    const h = util.h;
    const ov = h('div', { class: 'zm-overlay show', role: 'alert', 'aria-live': 'assertive' },
      h('div', { class: 'zm-box zm-busy' }, h('div', { class: 'zm-spin', 'aria-hidden': 'true' }), h('p', { class: 'zm-msg', text: label })));
    document.body.append(ov);
    return { close() { ov.remove(); } };
  };
  modal.success = function (title, sub, ms) {
    const h = util.h;
    return new Promise(res => {
      const svg = '<svg viewBox="0 0 52 52" class="zm-check" aria-hidden="true"><circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="3" class="zm-check-c"/><path d="M14 27l8 8 16-17" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="zm-check-p"/></svg>';
      const wrap = h('div', { class: 'zm-ico zm-ico-ok' }); wrap.innerHTML = svg;   // static literal, no user data
      const ov = h('div', { class: 'zm-overlay show', role: 'status' },
        h('div', { class: 'zm-box zm-success' }, wrap, h('h3', { class: 'zm-title', text: title }), h('p', { class: 'zm-msg', text: sub || '' })));
      document.body.append(ov);
      setTimeout(() => { ov.classList.remove('show'); setTimeout(() => { ov.remove(); res(); }, 220); }, ms || 1900);
    });
  };

  /* -------------------------------------------------------------- confetti */
  Zona.confetti = function (count) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = util.h('canvas', { class: 'zona-confetti', 'aria-hidden': 'true' });
    document.body.append(cv);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
    const ctx = cv.getContext('2d');
    const cols = ['#f59e0b', '#a855f7', '#34d399', '#60a5fa', '#ec4899', '#fbbf24'];
    const P = Array.from({ length: count || 140 }, () => ({
      x: W / 2 + (Math.random() - .5) * W * .25, y: H * .38, r: 4 + Math.random() * 6 * dpr,
      vx: (Math.random() - .5) * 15 * dpr, vy: -(6 + Math.random() * 12) * dpr, rot: Math.random() * 6, vr: (Math.random() - .5) * .4,
      c: cols[(Math.random() * cols.length) | 0], life: 0
    }));
    let f = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      P.forEach(p => {
        p.vy += .45 * dpr; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= .995; p.life++;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1 - p.life / 130);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
      });
      if (++f < 135) requestAnimationFrame(tick); else cv.remove();
    })();
  };

  /* --------------------------------------------------------------- session */
  const SESS_KEY = 'zona-session', DEV_KEY = 'zona-device-key';
  const session = Zona.session = {
    deviceKey() {
      let k = util.ls.get(DEV_KEY);
      if (!/^[a-f0-9]{32,128}$/.test(k || '')) { k = util.randHex(32); util.ls.set(DEV_KEY, k); }
      return k;
    },
    get() { try { const s = JSON.parse(util.ss.get(SESS_KEY) || 'null'); if (s && s.token && s.exp > Date.now() + 30000) return s; } catch (e) {} return null; },
    set(token, exp) { util.ss.set(SESS_KEY, JSON.stringify({ token: token, exp: exp })); },
    clear() { util.ss.del(SESS_KEY); }
  };

  /* ------------------------------------------------------------------- api */
  async function rawPost(action, params, token) {
    const ctrl = ('AbortController' in window) ? new AbortController() : null;
    const to = ctrl ? setTimeout(() => ctrl.abort(), 55000) : null;
    try {
      const res = await fetch(CFG.API_URL, {
        method: 'POST', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined,
        body: JSON.stringify(Object.assign({ action: action, key: CFG.API_KEY, token: token }, params || {}))   // text/plain => no CORS preflight
      });
      return await res.json();
    } catch (e) {
      throw util.mkErr(navigator.onLine ? 'NETWORK' : 'OFFLINE', navigator.onLine ? 'Network error. Please retry.' : 'You are offline.');
    } finally { if (to) clearTimeout(to); }
  }
  let loginPromise = null;
  function serverProfile(p) {
    return { mobile: p.mobile, name: p.name, exam: p.exam, phase: p.phase, hours: p.hours, resources: p.resources, targetDate: p.targetDate, goal: p.goal, notif: p.notif };
  }
  /** Sign in (or register) with the device key. Resolves {token, exp, isNew}. */
  function login(opts) {
    opts = opts || {};
    if (loginPromise) return loginPromise;
    loginPromise = (async () => {
      try {
        const p = opts.profile || util.profile();
        if (!p) throw util.mkErr('NO_PROFILE', 'Not signed in.');
        let recovery = opts.recoveryCode || '';
        for (let attempt = 0; attempt < 2; attempt++) {
          const json = await rawPost('login', { userData: serverProfile(p), deviceKey: session.deviceKey(), recoveryCode: recovery, hp: opts.hp || '', restore: !!opts.restore });
          if (json.status === 'success') {
            const d = json.data;
            if (!d || !d.token) throw util.mkErr('OLD_BACKEND', 'old backend');
            session.set(d.token, d.exp);
            if (d.recoveryCode) { if (opts.deferRecovery) d._pendingRecovery = d.recoveryCode; else await showRecoveryCode(d.recoveryCode); }
            return d;
          }
          if (json.code === 'DEVICE_MISMATCH' && attempt === 0 && !opts.noPrompt) {
            recovery = await modal.prompt({ title: 'Verify this device', message: json.message, label: 'Recovery code', placeholder: 'XXXXX-XXXXX', confirmLabel: 'Verify', maxlength: 14 });
            if (!recovery) throw util.mkErr('DEVICE_MISMATCH', json.message);
            continue;
          }
          throw util.mkErr(json.code || 'ERROR', json.message || 'Sign-in failed.');
        }
      } finally { loginPromise = null; }
    })();
    return loginPromise;
  }
  async function showRecoveryCode(code) {
    const h = util.h;
    const copy = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Copy code' });
    copy.addEventListener('click', () => { try { navigator.clipboard.writeText(code).then(() => util.toast('Recovery code copied.', 'success')); } catch (e) {} });
    await modal.open({
      title: 'Save your recovery code', icon: 'shield-halved', dismissible: false,
      message: 'Your account is bound to this device for security. If you ever clear your browser data or switch phones, this one-time code lets you get back in. It is shown only once.',
      body: h('div', { class: 'zm-code-wrap' }, h('div', { class: 'zm-code', text: code }), copy),
      buttons: [{ id: 'ok', label: 'I have saved it', primary: true }], cancelValue: 'ok'
    });
  }
  /** Authenticated call. Re-logs in silently once if the session expired. */
  async function call(action, params, opts) {
    opts = opts || {};
    if (Zona.deleting && action === 'save') throw util.mkErr('DELETING', 'Account is being deleted.');
    if (Zona.lock && Zona.lock.locked) throw util.mkErr('LOCKED', 'Session is locked.');
    if (!navigator.onLine) throw util.mkErr('OFFLINE', 'You are offline.');
    let s = session.get();
    if (!s) s = await login();
    const json = await rawPost(action, params, s.token);
    if (json.status === 'error' && json.code === 'AUTH' && !opts.retried) { session.clear(); return call(action, params, { retried: true }); }
    if (json.status === 'error' && json.code === 'NOT_FOUND' && !opts.reg && util.profile()) { session.clear(); await login({ noPrompt: true }); return call(action, params, { retried: true, reg: true }); }
    if (json.status !== 'success') throw util.mkErr(json.code || 'ERROR', json.message || 'Request failed.');
    return json.data;
  }
  Zona.api = { call: call, login: login, raw: rawPost };

  /** Step-by-step connection check: tells you exactly what is wrong with the cloud link. */
  Zona.diagnose = async function () {
    const h = util.h, rows = [];
    const add = (ok, label, hint) => rows.push(h('li', { class: ok ? 'ok' : 'bad' }, h('b', { text: (ok ? '✔ ' : '✘ ') + label }), hint ? h('small', { text: hint }) : null));
    const keyOk = !!CFG.API_KEY && !/^CHANGE_ME/.test(CFG.API_KEY);
    add(!!CFG.API_URL && /^https:\/\/script\.google\.com\//.test(CFG.API_URL), 'API_URL looks like an Apps Script /exec URL', 'Edit zona-config.js');
    add(keyOk, 'API_KEY is set in zona-config.js', keyOk ? '' : 'It still says CHANGE_ME. Use the same value as CFG.API_KEY in code.gs.');
    add(navigator.onLine, 'Device is online');
    let backendOk = false;
    if (navigator.onLine) {
      try {
        const r = await rawPost('ping', {});
        if (r.status === 'success' && r.data && r.data.version) { backendOk = true; add(true, 'Backend reachable, version ' + r.data.version); }
        else if (r.code === 'FORBIDDEN') add(false, 'Backend rejected the API key', util.explain({ code: 'FORBIDDEN', message: 'Forbidden.' }));
        else if (r.code === 'NOT_CONFIGURED') add(false, 'Backend is not configured', util.explain({ code: 'NOT_CONFIGURED' }));
        else add(false, 'Backend answered, but it is the OLD code.gs', util.explain({ code: 'OLD_BACKEND' }));
      } catch (e) { add(false, 'Cannot reach the backend', util.explain(e)); }
    }
    if (backendOk && util.profile()) {
      try { session.clear(); await login({ noPrompt: true }); add(true, 'Signed in with this device key'); }
      catch (e) { add(false, 'Sign-in failed: ' + (e.code || ''), util.explain(e)); }
      if (session.get()) { try { await call('load'); add(true, 'Cloud data can be loaded'); } catch (e) { add(false, 'Loading failed', util.explain(e)); } }
    }
    const retry = rows.every(r => r.className === 'ok');
    await modal.open({ title: retry ? 'Connection is healthy' : 'Connection check', icon: retry ? 'circle-check' : 'plug-circle-exclamation', body: h('ul', { class: 'diag-list' }, rows), buttons: [{ id: 'ok', label: 'Close', primary: true }], cancelValue: 'ok' });
    if (retry) sync.flush(true);
  };

  /* ------------------------------------------------------------------ sync */
  const DIRTY_KEY = 'zona-dirty', BACKUP_KEY = 'zona-last-backup';
  const sync = Zona.sync = { ver: 0, inflight: false, again: false, status: 'idle', timer: null, backoff: 0, blockedUntil: 0, lastOk: 0 };
  sync.isDirty = () => util.ls.get(DIRTY_KEY) === '1';
  sync.setStatus = function (kind, detail) {
    sync.status = kind;
    const el = util.$('saveStatus');
    document.body.classList.toggle('is-offline', kind === 'offline');
    if (!el) return;
    const M = {
      synced: ['circle-check', 'Synced', 'var(--green)'], syncing: ['arrows-rotate fa-spin', 'Syncing…', 'var(--blue)'],
      offline: ['wifi', 'Offline · saved on device', 'var(--orange)'], error: ['triangle-exclamation', 'Sync error · retrying', 'var(--red)'],
      pending: ['clock', 'Unsynced', 'var(--orange)'], idle: ['cloud', 'Local only', 'var(--text-dim)']
    }[kind] || ['cloud', kind, 'var(--text-dim)'];
    el.replaceChildren(util.h('i', { class: 'fas fa-' + M[0], 'aria-hidden': 'true' }), ' ' + M[1]);
    el.style.color = M[2]; el.title = detail || M[1]; el.dataset.state = kind;
    el.classList.add('sync-pill');
    if (!el._z) { el._z = 1; el.style.cursor = 'pointer'; el.setAttribute('role', 'button'); el.addEventListener('click', () => Zona.diagnose()); }
    Zona.bus.emit('sync-status', { kind: kind, detail: detail });
  };
  sync.markDirty = function () {
    if (Zona.deleting) return;
    sync.ver++; util.ls.set(DIRTY_KEY, '1');
    try { needsSync = true; } catch (e) {}
    sync.setStatus(navigator.onLine ? 'pending' : 'offline');
    sync.schedule(2200);
  };
  sync.schedule = function (ms) { clearTimeout(sync.timer); sync.timer = setTimeout(() => sync.flush(), ms); };
  /** force=true (Sync now, back online) ignores the error back-off; silent timers respect it. */
  sync.flush = async function (force) {
    if (Zona.deleting || !util.profile() || (Zona.lock && Zona.lock.locked)) return false;
    if (!navigator.onLine) { sync.setStatus('offline'); return false; }
    if (!force && Date.now() < sync.blockedUntil - 50) return false;
    if (sync.inflight) { sync.again = true; return false; }
    const startVer = sync.ver;
    sync.inflight = true; sync.setStatus('syncing');
    try {
      await call('save', { payload: state, upscPytsState: (typeof getUpscPytsStatePayload === 'function') ? getUpscPytsStatePayload() : undefined });
      sync.lastOk = Date.now(); sync.backoff = 0; sync.blockedUntil = 0;
      if (sync.ver === startVer) { util.ls.del(DIRTY_KEY); try { needsSync = false; } catch (e) {} sync.setStatus('synced', 'Last synced ' + new Date().toLocaleTimeString()); }
      else sync.schedule(400);
      try { UI.markSynced(); } catch (e) {}
      return true;
    } catch (e) {
      if (e.code === 'OFFLINE') sync.setStatus('offline');
      else if (e.code === 'LOCKED' || e.code === 'DELETING' || e.code === 'NO_PROFILE') sync.setStatus('idle');
      else {
        sync.setStatus('error', util.explain(e) + ' (tap for a connection check)');
        sync.backoff = Math.min(sync.backoff ? sync.backoff * 2 : 5000, 120000);
        sync.blockedUntil = Date.now() + sync.backoff;
        sync.schedule(sync.backoff);
        if (e.code === 'DEVICE_MISMATCH' || e.code === 'FORBIDDEN') util.toast(e.message, 'error');
      }
      return false;
    } finally {
      sync.inflight = false;
      if (sync.again) { sync.again = false; sync.schedule(300); }
    }
  };
  window.addEventListener('online', () => { util.toast('Back online. Syncing…', 'info'); sync.setStatus(sync.isDirty() ? 'pending' : 'synced'); sync.flush(true); });
  window.addEventListener('offline', () => { sync.setStatus('offline'); util.toast('You are offline. Changes are saved on this device.', 'warn'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && sync.isDirty()) sync.flush(); });

  /** Cloud snapshot every N minutes (only when something changed since the last one). */
  let lastBackupVer = -1;
  async function autoBackupTick() {
    const mins = util.settings().autoBackupMin;
    if (!mins || !util.profile() || !navigator.onLine || (Zona.lock && Zona.lock.locked) || Zona.deleting) return;
    const last = Number(util.ls.get(BACKUP_KEY) || 0);
    if (Date.now() - last < mins * 60000 || lastBackupVer === sync.ver) return;
    try {
      if (sync.isDirty()) { const ok = await sync.flush(); if (!ok) return; }
      await call('backup');
      lastBackupVer = sync.ver; util.ls.set(BACKUP_KEY, String(Date.now()));
      Zona.bus.emit('backup-done');
    } catch (e) { /* retried on next tick */ }
  }

  /* ------------------------------------------------------------------ lock */
  const lock = Zona.lock = { locked: false, last: Date.now(), el: null };
  lock.init = function () {
    const bump = util.throttle(() => { if (!lock.locked) lock.last = Date.now(); }, 1000);
    ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel', 'mousemove'].forEach(ev => window.addEventListener(ev, bump, { passive: true, capture: true }));
    setInterval(lock.check, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lock.check(); });
  };
  lock.check = function () {
    if (lock.locked || !util.profile() || Zona.deleting) return;
    const app = util.$('mainAppContent');
    if (!app || app.style.display === 'none') return;
    const mins = util.settings().lockMin || 15;
    if (Date.now() - lock.last >= mins * 60000) lock.lock('Locked after ' + mins + ' minutes of inactivity.');
  };
  lock.lock = function (why) {
    if (lock.locked || !util.profile()) return;
    const h = util.h;
    if (sync.isDirty()) sync.flush();        // best effort before the session is dropped
    setTimeout(() => {
      session.clear(); lock.locked = true;
      const input = h('input', { class: 'form-control', type: 'tel', inputmode: 'numeric', maxlength: 15, placeholder: 'Your mobile number', autocomplete: 'off', 'aria-label': 'Mobile number' });
      const err = h('p', { class: 'zm-err', role: 'alert', text: '' });
      const go = h('button', { type: 'button', class: 'btn btn-primary', text: 'Unlock' });
      const out = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Not you? Sign out' });
      const submit = async () => {
        if (input.value.trim() !== String(util.profile().mobile)) { err.textContent = 'That number does not match this account.'; return; }
        go.disabled = true; go.textContent = 'Unlocking…';
        try { if (navigator.onLine) await login({ noPrompt: false }); lock.locked = false; lock.last = Date.now(); lock.el.remove(); lock.el = null; sync.flush(); }
        catch (e) { if (e.code === 'OFFLINE' || e.code === 'NETWORK') { lock.locked = false; lock.last = Date.now(); lock.el.remove(); lock.el = null; } else err.textContent = e.message; }
        finally { go.disabled = false; go.textContent = 'Unlock'; }
      };
      go.addEventListener('click', submit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      out.addEventListener('click', async () => { if (await modal.confirm({ title: 'Sign out?', message: 'Your data stays on this device and in the cloud. You will need your mobile number and, on a new device, your recovery code.', confirmLabel: 'Sign out' })) { Zona.data.clearLocal(); location.replace(location.pathname); } });
      lock.el = h('div', { class: 'zm-overlay show zm-lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Session locked' },
        h('div', { class: 'zm-box' }, h('div', { class: 'zm-ico' }, util.ico('lock')), h('h3', { class: 'zm-title', text: 'Session locked' }),
          h('p', { class: 'zm-msg', text: why || 'Locked for your security.' }), input, err, h('div', { class: 'zm-actions' }, out, go)));
      document.body.append(lock.el);
      setTimeout(() => input.focus({ preventScroll: true }), 80);
    }, 350);
  };

  /* ----------------------------------------------------------------- embed */
  /**
   * Fullscreen manager for an iframe card. Works on desktop + Android (Fullscreen API)
   * and on iPhone/iPad Safari (fixed-position fallback with body scroll lock).
   * o = { card, frame, btn, label, pageId, bodyClass }
   */
  Zona.makeEmbed = function (o) {
    let fake = false, scrollY = 0, poppedByUs = false;
    const $ = util.$;
    const card = () => $(o.card), frame = () => $(o.frame);
    const nativeEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const isFs = () => (!!nativeEl() && nativeEl() === card()) || fake;
    function lockBody(on) {
      const b = document.body;
      if (on) {
        scrollY = window.pageYOffset || 0;
        b.classList.add('embed-lock'); b.style.top = (-scrollY) + 'px';
      } else if (b.classList.contains('embed-lock')) {
        b.classList.remove('embed-lock'); b.style.top = '';
        window.scrollTo(0, scrollY);
      }
    }
    function fallbackOn() {
      if (fake) return; fake = true;
      card().classList.add('is-fs'); lockBody(true);
      try { history.pushState({ zonaFs: o.card }, ''); poppedByUs = true; } catch (e) {}
      sync();
    }
    function fallbackOff() {
      if (!fake) return; fake = false;
      const c = card(); if (c) c.classList.remove('is-fs');
      lockBody(false);
      if (poppedByUs) { poppedByUs = false; try { if (history.state && history.state.zonaFs === o.card) history.back(); } catch (e) {} }
    }
    function enter() {
      const c = card(); if (!c || isFs()) return;
      const req = c.requestFullscreen || c.webkitRequestFullscreen;
      const can = (document.fullscreenEnabled || document.webkitFullscreenEnabled) && req;
      if (!can) { fallbackOn(); return; }
      try {
        const r = req.call(c);
        if (r && r.then) r.then(() => { c.classList.add('is-fs'); lockBody(true); sync(); }, fallbackOn);
        else { c.classList.add('is-fs'); lockBody(true); sync(); }
      } catch (e) { fallbackOn(); }
    }
    function exit() {
      if (nativeEl()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
      fallbackOff();
      const c = card(); if (c && !nativeEl()) { c.classList.remove('is-fs'); lockBody(false); }
      sync();
    }
    function toggle() { if (isFs()) exit(); else enter(); }
    function sync() {
      const on = isFs(), btn = $(o.btn), lbl = $(o.label), c = card();
      if (c) c.classList.toggle('is-fs', on);
      if (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false'); btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
        const i = btn.querySelector('i'); if (i) i.className = on ? 'fas fa-compress' : 'fas fa-expand';
      }
      if (lbl) lbl.textContent = on ? 'Exit' : 'Fullscreen';
      fit();
    }
    function fit() {
      const f = frame(); if (!f) return;
      try { f.contentWindow.postMessage({ source: 'zona', type: 'resize' }, Zona.origin); } catch (e) {}
    }
    const onFsChange = () => { if (!nativeEl() && !fake) { const c = card(); if (c) c.classList.remove('is-fs'); lockBody(false); } sync(); };
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, onFsChange));
    window.addEventListener('popstate', () => { if (fake) { poppedByUs = false; fallbackOff(); sync(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && fake) { exit(); } });
    const refit = util.debounce(fit, 150);
    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', () => setTimeout(fit, 260));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
    return { toggle, enter: () => setTimeout(fit, 50), leave() { if (isFs()) exit(); }, exit, sync, fit, isFs };
  };

  /* ----------------------------------------------------------------- theme */
  const THEMES = Zona.THEMES = [
    { id: 'dark', name: 'Dark', icon: 'moon', color: '#120a2f', sw: ['#120a2f', '#f59e0b', '#a855f7'] },
    { id: 'light', name: 'Light', icon: 'sun', color: '#f7f8fb', sw: ['#f7f8fb', '#f97316', '#0e2a58'] },
    { id: 'oled', name: 'AMOLED Black', icon: 'circle-half-stroke', color: '#000000', sw: ['#000000', '#fb923c', '#a855f7'] },
    { id: 'midnight', name: 'Midnight Blue', icon: 'star', color: '#050b1f', sw: ['#050b1f', '#38bdf8', '#818cf8'] },
    { id: 'solarized', name: 'Solarized', icon: 'cloud-sun', color: '#002b36', sw: ['#002b36', '#b58900', '#268bd2'] }
  ];
  Zona.theme = {
    ids: THEMES.map(t => t.id),
    get() { return document.documentElement.getAttribute('data-theme') || 'dark'; },
    set(id, announce) {
      if (!THEMES.some(t => t.id === id)) id = 'dark';
      const root = document.documentElement;
      root.classList.add('theme-anim');
      root.setAttribute('data-theme', id);
      util.ls.set('zona-theme', id);
      setTimeout(() => root.classList.remove('theme-anim'), 480);
      try { util.settings().theme = id; } catch (e) {}
      Zona.bus.emit('theme', id);
      document.querySelectorAll('iframe[data-zona-frame]').forEach(f => { try { f.contentWindow.postMessage({ source: 'zona', type: 'theme', theme: id }, Zona.origin); } catch (e) {} });
      if (announce) { try { saveData(); } catch (e) {} }
    },
    next() { const i = THEMES.findIndex(t => t.id === Zona.theme.get()); return THEMES[(i + 1) % THEMES.length].id; }
  };

  /* ------------------------------------------------------------------ data */
  const data = Zona.data = {};
  const LOCAL_PREFIXES = ['zona', 'pgmedprep', 'upsc-pyts', 'mednotes'];
  data.clearLocal = function () {
    try {
      const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(k => { if (k && LOCAL_PREFIXES.some(p => k.indexOf(p) === 0)) localStorage.removeItem(k); });
    } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
  };
  data.exportJson = function () {
    const payload = { app: 'zona-occludens', schema: 2, exportedAt: new Date().toISOString(), state: state };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = util.h('a', { href: url, download: 'Zona_Occludens_Backup_' + util.isoToday() + '.json' });
    document.body.append(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
    util.toast('Backup downloaded.', 'success');
  };
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function scrub(o, depth) {
    if (!o || typeof o !== 'object' || depth > 12) return o;
    ['__proto__', 'constructor', 'prototype'].forEach(k => { if (Object.prototype.hasOwnProperty.call(o, k)) delete o[k]; });
    Object.keys(o).forEach(k => scrub(o[k], depth + 1));
    return o;
  }
  data.validate = function (raw) {
    let obj = raw;
    if (!isObj(obj)) return { ok: false, error: 'This file is not a Zona backup.' };
    if (obj.app === 'zona-occludens' && isObj(obj.state)) obj = obj.state;
    obj = scrub(obj, 0);
    for (const k of ['tests', 'errors', 'mcqPractice', 'upcomingTests']) if (k in obj && !Array.isArray(obj[k])) return { ok: false, error: 'Backup is corrupted: "' + k + '" should be a list.' };
    for (const k of ['planner', 'masterTopics', 'subjectProgress']) if (k in obj && !isObj(obj[k])) return { ok: false, error: 'Backup is corrupted: "' + k + '" is malformed.' };
    const looksRight = ['tests', 'masterTopics', 'planner', 'gamification', 'mcqPractice', 'errors', 'streak'].some(k => k in obj);
    if (!looksRight) return { ok: false, error: 'No study data found in this file.' };
    const g = isObj(obj.gamification) ? obj.gamification : {};
    return {
      ok: true, state: obj,
      newer: typeof obj._v === 'number' && typeof STATE_VERSION !== 'undefined' && obj._v > STATE_VERSION,
      summary: {
        tests: (obj.tests || []).length, mistakes: (obj.errors || []).length, mcq: (obj.mcqPractice || []).length,
        topics: Object.keys(obj.masterTopics || {}).length, plannerDays: Object.keys(obj.planner || {}).length, xp: Math.floor(Number(g.xp) || 0)
      }
    };
  };
  function unionById(a, b) {
    const m = new Map(); (a || []).forEach(x => m.set(x && x.id !== undefined ? String(x.id) : JSON.stringify(x), x));
    (b || []).forEach(x => m.set(x && x.id !== undefined ? String(x.id) : JSON.stringify(x), x));
    return Array.from(m.values());
  }
  /** Non-destructive merge: never loses progress on either side. */
  data.merge = function (local, inc) {
    const out = Object.assign({}, local);
    ['tests', 'errors', 'mcqPractice', 'upcomingTests'].forEach(k => { out[k] = unionById(local[k], inc[k]); });
    const mt = Object.assign({}, local.masterTopics || {});
    Object.keys(inc.masterTopics || {}).forEach(id => {
      const a = mt[id], b = inc.masterTopics[id];
      if (!a) { mt[id] = b; return; }
      mt[id] = Object.assign({}, b, a, {
        r1: !!(a.r1 || b.r1), r2: !!(a.r2 || b.r2), r3: !!(a.r3 || b.r3), completed: !!(a.completed || b.completed),
        notes: String((a.notes || '').length >= (b.notes || '').length ? a.notes || '' : b.notes || '')
      });
    });
    out.masterTopics = mt;
    const pl = Object.assign({}, local.planner || {});
    Object.keys(inc.planner || {}).forEach(d => {
      const a = pl[d], b = inc.planner[d];
      if (!a || !isObj(a)) { pl[d] = b; return; }
      if (!isObj(b)) return;
      const tg = unionById((a.targets || []).map(t => typeof t === 'string' ? { text: t, done: false } : t).map(t => Object.assign({ id: t.text }, t)),
        (b.targets || []).map(t => typeof t === 'string' ? { text: t, done: false } : t).map(t => Object.assign({ id: t.text }, t)));
      pl[d] = Object.assign({}, b, a, {
        targets: tg.map(t => { const c = Object.assign({}, t); delete c.id; return c; }),
        dayFinished: !!(a.dayFinished || b.dayFinished), starClaimed: !!(a.starClaimed || b.starClaimed), trophyEarned: !!(a.trophyEarned || b.trophyEarned),
        notes: a.notes || b.notes || '', arsenal: Array.from(new Set([].concat(a.arsenal || [], b.arsenal || [])))
      });
    });
    out.planner = pl;
    const sp = Object.assign({}, local.subjectProgress || {});
    Object.keys(inc.subjectProgress || {}).forEach(k => { sp[k] = Math.max(Number(sp[k]) || 0, Number(inc.subjectProgress[k]) || 0); });
    out.subjectProgress = sp;
    const gx = o => Number(o && o.gamification && o.gamification.xp) || 0;
    if (inc.gamification && gx(inc) > gx(local)) out.gamification = inc.gamification;
    if (inc.streak && (Number(inc.streak.count) || 0) > (Number(local.streak && local.streak.count) || 0)) out.streak = inc.streak;
    if (inc.medNotes && !local.medNotes) out.medNotes = inc.medNotes;
    if (inc.errorTracker) out.errorTracker = Object.assign({}, inc.errorTracker, local.errorTracker || {});
    if (inc.guidelines && isObj(inc.guidelines.checks)) out.guidelines = { checks: Object.assign({}, inc.guidelines.checks, (local.guidelines && local.guidelines.checks) || {}) };
    return out;
  };
  data.importFile = async function (file) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return util.toast('Backup file is too large (max 25 MB).', 'error');
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch (e) { return util.toast('That is not valid JSON.', 'error'); }
    const v = data.validate(parsed);
    if (!v.ok) return util.toast(v.error, 'error');
    const h = util.h, s = v.summary;
    const list = h('ul', { class: 'zm-list' }, [['Tests', s.tests], ['Mistakes', s.mistakes], ['MCQ sets', s.mcq], ['Topics', s.topics], ['Planner days', s.plannerDays], ['XP', s.xp]].map(r => h('li', null, h('span', { text: r[0] }), h('b', { text: String(r[1]) }))));
    const choice = await modal.choice({
      title: 'Import backup', icon: 'file-import',
      message: (v.newer ? 'This backup was made by a newer version; some data may be ignored. ' : '') + 'Merge keeps everything on this device and adds what is missing. Replace swaps all study data for the file (your sign-in stays).',
      body: list,
      choices: [{ id: 'merge', label: 'Merge', primary: true }, { id: 'replace', label: 'Replace' }]
    });
    if (!choice) return;
    util.ls.set('zona-pre-import-backup', JSON.stringify(state));      // safety copy so a bad import is recoverable
    const profile = state.userProfile;
    try {
      if (choice === 'merge') state = migrateState(data.merge(state, v.state));
      else state = migrateState(Object.assign({}, v.state));
      state.userProfile = profile;                                      // identity always stays
      if (!isObj(state.settings)) state.settings = {};
      saveData(); finalizeInit();
      util.toast('Backup ' + (choice === 'merge' ? 'merged' : 'restored') + '. A safety copy of your previous data was kept on this device.', 'success');
      Zona.bus.emit('imported');
    } catch (e) {
      try { state = migrateState(JSON.parse(util.ls.get('zona-pre-import-backup'))); finalizeInit(); } catch (e2) {}
      util.toast('Import failed, your data was left unchanged.', 'error');
    }
  };
  data.deleteAccount = async function () {
    const ok = await modal.confirm({
      title: 'Delete your account?', danger: true, confirmLabel: 'Delete forever', typeToConfirm: 'DELETE',
      message: 'This permanently deletes your profile, planner, tests, XP, badges and cloud backups from Google Sheets and from this device. It cannot be undone.'
    });
    if (!ok) return;
    if (!navigator.onLine) return util.toast('Connect to the internet to delete your cloud data first.', 'error');
    const busy = modal.busy('Deleting your data…');
    try { Zona.deleting = true; clearTimeout(sync.timer); await call('deleteUser'); }
    catch (e) { Zona.deleting = false; busy.close(); return util.toast('Could not delete cloud data: ' + e.message, 'error'); }
    busy.close();
    await modal.success('Account deleted', 'All your data has been erased. Taking you to onboarding…', 1900);
    data.clearLocal();
    location.replace(location.pathname);
  };

  /* -------------------------------------------------------------- settings */
  const settings = Zona.settings = {};
  settings.render = function () {
    const root = util.$('settingsRoot'); if (!root) return;
    const h = util.h, ico = util.ico, S = util.settings(), p = util.profile() || {};
    const card = (icon, title, sub, ...kids) => h('section', { class: 'glass-card set-card reveal' }, h('div', { class: 'set-head' }, h('span', { class: 'set-ico' }, ico(icon)), h('div', null, h('h3', { text: title }), sub ? h('p', { text: sub }) : null)), ...kids);
    const row = (label, ctrl, hint) => h('div', { class: 'set-row' }, h('div', { class: 'set-lbl' }, h('span', { text: label }), hint ? h('small', { text: hint }) : null), ctrl);
    const sel = (opts, cur, fn) => { const s = h('select', { class: 'form-control set-sel' }, opts.map(o => h('option', { value: o[0], selected: String(o[0]) === String(cur) ? true : null, text: o[1] }))); s.addEventListener('change', () => fn(s.value)); return s; };
    const toggle = (on, fn, label) => { const b = h('button', { type: 'button', class: 'zm-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label }, h('i')); b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', v ? 'true' : 'false'); b.classList.toggle('on', v); fn(v); }); return b; };
    const save = (msg) => { try { saveData(); } catch (e) {} if (msg) util.toast(msg, 'success'); };

    /* Appearance */
    const grid = h('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': 'Theme' }, THEMES.map(t => {
      const b = h('button', { type: 'button', class: 'theme-opt' + (Zona.theme.get() === t.id ? ' active' : ''), role: 'radio', 'aria-checked': Zona.theme.get() === t.id ? 'true' : 'false', 'data-theme-id': t.id },
        h('span', { class: 'theme-sw', style: { background: 'linear-gradient(135deg,' + t.sw[0] + ' 0 55%,' + t.sw[1] + ' 55% 78%,' + t.sw[2] + ' 78%)' } }), h('span', { text: t.name }));
      b.addEventListener('click', () => { Zona.theme.set(t.id, true); grid.querySelectorAll('.theme-opt').forEach(x => { const on = x.getAttribute('data-theme-id') === t.id; x.classList.toggle('active', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); }); util.toast('Theme: ' + t.name, 'info'); });
      return b;
    }));

    /* Profile */
    const nameIn = h('input', { class: 'form-control', value: p.name || '', maxlength: 60, 'aria-label': 'Name' });
    const examSel = sel([['NEET PG', 'NEET PG'], ['INICET Nov', 'INICET Nov'], ['INICET May 2027', 'INICET May 2027'], ['FMGE', 'FMGE'], ['UPSC CMS', 'UPSC CMS']], p.exam || 'NEET PG', () => {});
    const dateIn = h('input', { class: 'form-control', type: 'date', value: p.targetDate || '', 'aria-label': 'Target date' });
    const goalIn = h('input', { class: 'form-control', type: 'number', min: 1, max: 16, step: 0.5, value: p.goal || 6, 'aria-label': 'Daily study goal in hours' });
    const saveProfile = h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Save profile' });
    saveProfile.addEventListener('click', () => {
      const nm = nameIn.value.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!nm) return util.toast('Name cannot be empty.', 'error');
      state.userProfile = Object.assign({}, state.userProfile, { name: nm, exam: examSel.value, targetDate: /^\d{4}-\d{2}-\d{2}$/.test(dateIn.value) ? dateIn.value : '', goal: Math.max(1, Math.min(16, Number(goalIn.value) || 6)) });
      save('Profile updated.'); try { setUserGreeting(); Gami.refreshChrome(); } catch (e) {} Zona.bus.emit('profile');
    });

    /* Notifications */
    const N = S.notif;
    const timeIn = h('input', { class: 'form-control set-time', type: 'time', value: N.time || '20:00', 'aria-label': 'Reminder time' });
    timeIn.addEventListener('change', () => { N.time = timeIn.value || '20:00'; save(); });
    const dailyTg = toggle(!!N.daily, async v => {
      N.daily = v;
      if (v && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) {} }
      if (v && 'Notification' in window && Notification.permission === 'denied') util.toast('Browser notifications are blocked. Reminders will appear inside the app only.', 'warn');
      save();
    }, 'Daily reminder');

    /* Backup */
    const lastB = Number(util.ls.get(BACKUP_KEY) || 0);
    const statusLine = h('span', { class: 'set-status', id: 'setSyncLine', text: sync.status === 'synced' ? 'Synced' : sync.status });
    const snapBox = h('div', { class: 'snap-list', 'aria-live': 'polite' }, h('p', { class: 'set-hint', text: 'Cloud snapshots load on demand.' }));
    const loadSnaps = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Show cloud snapshots' });
    loadSnaps.addEventListener('click', async () => {
      loadSnaps.disabled = true; snapBox.replaceChildren(h('p', { class: 'set-hint', text: 'Loading…' }));
      try {
        const r = await call('backups');
        if (!r.items.length) { snapBox.replaceChildren(h('p', { class: 'set-hint', text: 'No snapshots yet. The first one is taken automatically.' })); return; }
        snapBox.replaceChildren(...r.items.map(it => {
          const b = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Restore' });
          b.addEventListener('click', async () => {
            if (!(await modal.confirm({ title: 'Restore this snapshot?', message: 'Your current data is snapshotted first, then replaced by the version from ' + util.fmtDate(it.at) + '.', confirmLabel: 'Restore' }))) return;
            const busy = modal.busy('Restoring…');
            try {
              const st = await call('restoreBackup', { index: it.index });
              const profile = state.userProfile; state = migrateState(st); state.userProfile = profile;
              util.ls.set('zona-dirty', '1'); saveData(); finalizeInit(); busy.close(); util.toast('Snapshot restored.', 'success'); settings.render();
            } catch (e) { busy.close(); util.toast('Restore failed: ' + e.message, 'error'); }
          });
          return h('div', { class: 'snap-row' }, h('span', null, h('b', { text: util.fmtDate(it.at) }), h('small', { text: ' · ' + it.why })), b);
        }));
      } catch (e) { snapBox.replaceChildren(h('p', { class: 'set-hint', text: e.message })); }
      finally { loadSnaps.disabled = false; }
    });
    const diagBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Connection check' }); diagBtn.addEventListener('click', () => Zona.diagnose());
    const syncNow = h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Sync now' });
    syncNow.addEventListener('click', async () => { syncNow.disabled = true; const ok = await sync.flush(true); syncNow.disabled = false; util.toast(ok ? 'Synced to cloud.' : 'Could not sync right now. It will retry automatically.', ok ? 'success' : 'warn'); });
    const expBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Export JSON' }); expBtn.addEventListener('click', data.exportJson);
    const impBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Import JSON' }); impBtn.addEventListener('click', () => { const f = util.$('importFile'); if (f) f.click(); });

    /* Leaderboard */
    const lbTg = toggle(!!S.leaderboard, async v => {
      S.leaderboard = v; save();
      try { await call('setLeaderboard', { optIn: v }); util.toast(v ? 'You are on the leaderboard (first name + XP only).' : 'You left the leaderboard.', 'success'); }
      catch (e) { util.toast(util.explain(e), 'warn'); }
    }, 'Show me on the leaderboard');

    /* Security */
    const lockSel = sel([[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']], S.lockMin, v => { S.lockMin = Number(v); save('Auto-lock updated.'); });
    const lockNow = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Lock now' }); lockNow.addEventListener('click', () => lock.lock('Locked manually.'));
    const signOut = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Sign out' });
    signOut.addEventListener('click', async () => {
      if (!(await modal.confirm({ title: 'Sign out of this device?', message: 'Unsynced changes are pushed first. Your cloud data stays safe; sign back in with your mobile number (and recovery code on a new device).', confirmLabel: 'Sign out' }))) return;
      if (sync.isDirty()) await sync.flush();
      try { await call('logout'); } catch (e) {}
      data.clearLocal(); location.replace(location.pathname);
    });

    /* Danger zone */
    const rp = h('button', { type: 'button', class: 'btn btn-outline btn-sm danger-outline', text: 'Reset planner' }); rp.addEventListener('click', () => window.resetPlannerProgress && window.resetPlannerProgress());
    const del = h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Delete account' }); del.addEventListener('click', data.deleteAccount);

    root.replaceChildren(
      card('palette', 'Appearance', 'Five themes, applied instantly and remembered on every device.', grid),
      card('user-gear', 'Profile & goals', 'Your name, exam and daily target. Mobile number is your permanent ID.',
        row('Name', nameIn), row('Mobile', h('b', { class: 'set-static', text: '+' + (p.mobile || '') })), row('Target exam', examSel), row('Target date', dateIn), row('Daily study goal (hours)', goalIn), h('div', { class: 'set-actions' }, saveProfile)),
      card('bell', 'Notifications', 'Reminders fire while the app is open (browsers cannot wake a closed tab).',
        row('Daily study reminder', dailyTg), row('Reminder time', timeIn), row('Streak-at-risk nudge', toggle(!!N.streak, v => { N.streak = v; save(); }, 'Streak nudge')), row('Announcements from the team', toggle(N.announce !== false, v => { N.announce = v; save(); }, 'Announcements'))),
      card('cloud-arrow-up', 'Backup & sync', 'Every change syncs within seconds. Snapshots protect you from accidental overwrites.',
        row('Status', statusLine, lastB ? 'Last snapshot: ' + util.fmtDate(lastB) : 'No snapshot yet'),
        row('Auto-backup snapshot', sel([[0, 'Off'], [5, 'Every 5 min'], [15, 'Every 15 min'], [30, 'Every 30 min'], [60, 'Every hour']], S.autoBackupMin, v => { S.autoBackupMin = Number(v); save('Auto-backup updated.'); })),
        h('div', { class: 'set-actions' }, syncNow, diagBtn, expBtn, impBtn, loadSnaps), snapBox),
      card('ranking-star', 'Leaderboard', 'Opt in to appear with your first name, rank and XP. Nothing else is shared.', row('Show me on the leaderboard', lbTg)),
      card('shield-halved', 'Security', 'Your session is signed, expires and is bound to this device.',
        row('Auto-lock after inactivity', lockSel), h('div', { class: 'set-actions' }, lockNow, signOut)),
      card('triangle-exclamation', 'Danger zone', 'These actions cannot be undone.', h('div', { class: 'set-actions' }, rp, del))
    );
    root.closest('.page') && root.closest('.page').querySelectorAll('.reveal').forEach((e, i) => { e.style.animationDelay = (i * 60) + 'ms'; });
  };
  Zona.bus.on('sync-status', e => { const el = util.$('setSyncLine'); if (el) el.textContent = ({ synced: 'Synced', syncing: 'Syncing…', offline: 'Offline', error: 'Error: retrying', pending: 'Unsynced', idle: 'Local only' })[e.kind] || e.kind; });

  /* ---------------------------------------------------------------- social */
  const social = Zona.social = {};
  social.announcements = async function () {
    if (!util.profile() || !navigator.onLine) return;
    if (util.settings().notif.announce === false) return;
    try {
      const r = await call('announcements');
      let seen = []; try { seen = JSON.parse(util.ls.get('zona-seen-ann') || '[]'); } catch (e) {}
      const fresh = r.items.filter(i => seen.indexOf(i.id) === -1).slice(0, 3);
      fresh.reverse().forEach((i, k) => setTimeout(() => util.toast('📢 ' + i.message, 'info'), 900 + k * 1400));
      util.ls.set('zona-seen-ann', JSON.stringify(r.items.map(i => i.id).concat(seen).slice(0, 40)));
    } catch (e) {}
  };
  social.renderLeaderboard = async function () {
    const page = util.$('page-rewards'); if (!page) return;
    const h = util.h;
    let root = util.$('leaderboardRoot');
    if (!root) { root = h('section', { class: 'glass-card lb-card reveal', id: 'leaderboardRoot' }); page.append(root); }
    const RANKS = Zona.RANKS;
    const xp = Math.floor((state.gamification && state.gamification.xp) || 0);
    let idx = 0; RANKS.forEach((r, i) => { if (xp >= r.min) idx = i; });
    const next = RANKS[idx + 1];
    const pct = next ? Math.min(100, Math.round((xp - RANKS[idx].min) / (next.min - RANKS[idx].min) * 100)) : 100;
    const tabs = h('div', { class: 'lb-tabs', role: 'tablist' });
    const body = h('div', { class: 'lb-body' });
    const local = () => body.replaceChildren(
      h('div', { class: 'lb-me' }, h('span', { class: 'lb-ico', text: RANKS[idx].icon }), h('div', null, h('b', { text: RANKS[idx].name }), h('small', { text: xp.toLocaleString() + ' XP' }))),
      h('div', { class: 'lb-bar', 'aria-label': 'Progress to next rank' }, h('i', { style: { width: pct + '%' } })),
      h('p', { class: 'set-hint', text: next ? (next.min - xp).toLocaleString() + ' XP to ' + next.name + ' ' + next.icon : 'You have reached the top rank. Outstanding.' }),
      h('ol', { class: 'lb-ladder' }, RANKS.map((r, i) => h('li', { class: i < idx ? 'done' : i === idx ? 'now' : '' }, h('span', { text: r.icon }), h('b', { text: r.name }), h('small', { text: r.min.toLocaleString() + '+ XP' })))));
    const global = async () => {
      body.replaceChildren(h('div', { class: 'skeleton sk-tall' }));
      try {
        if (sync.isDirty()) await sync.flush(true);          // make sure your latest XP is on the server
        const r = await call('leaderboard');
        const join = r.optIn ? null : h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Join the leaderboard' });
        if (join) join.addEventListener('click', async () => {
          join.disabled = true;
          try { util.settings().leaderboard = true; saveData(); await call('setLeaderboard', { optIn: true }); util.toast('You joined the leaderboard.', 'success'); global(); }
          catch (e) { join.disabled = false; util.toast(util.explain(e), 'error'); }
        });
        if (!r.top.length) { body.replaceChildren(h('p', { class: 'set-hint', text: 'No one has joined yet. Be the first!' }), join); return; }
        body.replaceChildren(
          h('ol', { class: 'lb-list' }, r.top.map(t => h('li', { class: t.me ? 'me' : '' }, h('span', { class: 'lb-pos', text: '#' + t.pos }), h('span', { class: 'lb-name', text: t.name + (t.me ? ' (you)' : '') }), h('small', { text: t.rank }), h('b', { text: t.xp.toLocaleString() + ' XP' })))),
          r.optIn ? null : h('p', { class: 'set-hint', text: 'You are not listed yet. Only your first name, rank and XP would be shown.' }), join);
      } catch (e) { const retry = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Connection check' }); retry.addEventListener('click', () => Zona.diagnose()); body.replaceChildren(h('p', { class: 'set-hint', text: util.explain(e) }), retry); }
    };
    const mk = (id, label, fn) => { const b = h('button', { type: 'button', role: 'tab', class: 'lb-tab', text: label }); b.addEventListener('click', () => { tabs.querySelectorAll('.lb-tab').forEach(x => x.classList.remove('active')); b.classList.add('active'); fn(); }); return b; };
    const t1 = mk('local', 'My rank', local), t2 = mk('global', 'Leaderboard', global);
    tabs.append(t1, t2);
    root.replaceChildren(h('div', { class: 'set-head' }, h('span', { class: 'set-ico' }, util.ico('ranking-star')), h('div', null, h('h3', { text: 'Rank ladder & leaderboard' }), h('p', { text: 'Aspirant to Gold Medalist. Opt-in global board shows first name + XP only.' }))), tabs, body);
    t1.classList.add('active'); local();
  };

  /** Academic rank ladder (same XP thresholds as the old level table). */
  Zona.RANKS = [
    { name: 'Aspirant', min: 0, icon: '🌱' }, { name: 'Scholar', min: 500, icon: '📘' }, { name: 'Achiever', min: 2000, icon: '🎯' },
    { name: 'Topper', min: 5000, icon: '🏅' }, { name: 'Rank Holder', min: 12000, icon: '🥇' },
    { name: 'AIR Contender', min: 25000, icon: '🚀' }, { name: 'Gold Medalist', min: 50000, icon: '🏆' }
  ];

  /* ------------------------------------------------------------ reminders */
  function reminderTick() {
    try {
      const N = util.settings().notif; if (!N || !N.daily || !util.profile()) return;
      const now = new Date(), [hh, mm] = String(N.time || '20:00').split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
      const key = 'zona-reminded-' + util.isoToday(); if (util.ls.get(key)) return;
      util.ls.set(key, '1');
      const msg = 'Time for today\'s study block. Keep your streak alive!';
      if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('Zona Occludens', { body: msg, icon: 'favicon.png' }); } catch (e) {} }
      util.toast('⏰ ' + msg, 'info');
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ boot */
  Zona.boot = function () {
    lock.init();
    setInterval(autoBackupTick, 60000);
    setInterval(reminderTick, 60000);
    window.addEventListener('beforeunload', () => { if (sync.isDirty() && navigator.sendBeacon === undefined) sync.flush(); });
  };
})();
