/* =====================================================================
   Zona Admin: client. Every action is authorised server-side with a signed admin token
   obtained by sending the PIN to the backend. Nothing sensitive lives in this file.
   All dynamic text is inserted with textContent (no innerHTML with user data).
   ===================================================================== */
(function () {
  'use strict';
  var CFG = window.ZONA_CONFIG, $ = function (id) { return document.getElementById(id); };
  var IDLE_MS = 15 * 60 * 1000;
  var token = null, users = [], sort = { k: 'lastSeen', dir: -1 }, lastActive = Date.now();

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    });
    var add = function (c) { if (c == null || c === false) return; if (Array.isArray(c)) return c.forEach(add); el.append(c.nodeType ? c : document.createTextNode(String(c))); };   // v4: arrays of children allowed
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  }
  function toast(msg) { var t = h('div', { class: 'toast', role: 'status', text: msg }); document.body.append(t); setTimeout(function () { t.remove(); }, 3400); }
  function fmt(iso) { if (!iso) return 'Never'; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

  function api(action, params) {
    return fetch(CFG.API_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify(Object.assign({ action: action, key: CFG.API_KEY, token: token }, params || {})) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status !== 'success') {
          var msg = j.message || 'Request failed';
          if (/Invalid action command/i.test(msg)) msg = 'The Apps Script is still the OLD code.gs. Paste the new code.gs and deploy a NEW VERSION.';
          else if (j.code === 'FORBIDDEN' && /^Forbidden/.test(msg)) msg = 'API key mismatch: API_KEY in zona-config.js must equal CFG.API_KEY in code.gs (run setupZona after editing).';
          else if (j.code === 'NOT_CONFIGURED') msg = 'Backend not set up: run setupZona() in Apps Script first.';
          var e = new Error(msg); e.code = j.code; throw e;
        }
        return j.data;
      }, function () { throw new Error('Cannot reach the backend. Check API_URL in zona-config.js and that the web app is deployed with access set to Anyone.'); })
      .catch(function (e) { if (e.code === 'AUTH') { lock('Session expired. Sign in again.'); } throw e; });
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (res) {
      var ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', text: okLabel || 'Confirm' });
      var no = h('button', { class: 'btn', type: 'button', text: 'Cancel' });
      var ov = h('div', { class: 'ov', role: 'alertdialog', 'aria-modal': 'true' }, h('div', { class: 'card' }, h('h3', { text: title }), h('p', { text: text, style: 'color:var(--text-muted)' }), h('div', { style: 'display:flex;gap:10px;justify-content:flex-end' }, no, ok)));
      function done(v) { ov.remove(); res(v); }
      ok.addEventListener('click', function () { done(true); }); no.addEventListener('click', function () { done(false); });
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) done(false); });
      document.body.append(ov); no.focus();
    });
  }

  /* ---------- auth ---------- */
  function lock(msg) {
    token = null; try { sessionStorage.removeItem('zona-admin'); } catch (e) {}
    $('app').classList.add('hidden'); $('login').classList.remove('hidden');
    $('pin').value = ''; $('loginErr').textContent = msg || '';
  }
  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('loginBtn'); btn.disabled = true; $('loginErr').textContent = '';
    token = null;
    api('adminLogin', { pin: $('pin').value }).then(function (d) {
      token = d.token; try { sessionStorage.setItem('zona-admin', JSON.stringify({ t: d.token, e: d.exp })); } catch (e) {}
      $('pin').value = ''; show();
    }).catch(function (e) { $('loginErr').textContent = e.message; }).then(function () { btn.disabled = false; });
  });
  $('logout').addEventListener('click', function () { api('logout').catch(function () {}); lock(''); });
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true, capture: true }); });
  setInterval(function () { if (token && Date.now() - lastActive > IDLE_MS) lock('Locked after 15 minutes of inactivity.'); }, 20000);

  /* ---------- data ---------- */
  function show() {
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    loadAll();
  }
  function loadAll() {
    Promise.all([api('adminStats'), api('adminUsers'), api('adminSecurity')]).then(function (r) {
      renderStats(r[0]); users = r[1].users; renderUsers(); renderSecurity(r[2].items);
    }).catch(function (e) { toast(e.message); });
  }
  $('refresh').addEventListener('click', function () { loadAll(); toast('Refreshed'); });

  function renderStats(s) {
    var defs = [['t1', 'Total users', s.total], ['t2', 'Active (24 h)', s.active24h], ['t3', 'Active (7 days)', s.active7d], ['t4', 'Signups today', s.signupsToday]];
    // v4: test & mistake tracker totals (shown only when the backend is v4)
    if (s.testsLogged !== undefined) defs.push(['t1', 'Tests logged', s.testsLogged], ['t2', 'Mistakes logged', s.mistakesLogged], ['t3', 'Pending revisions', s.pendingRevisions]);
    $('tiles').replaceChildren.apply($('tiles'), defs.map(function (d) { return h('div', { class: 'card tile ' + d[0] }, h('small', { text: d[1] }), h('b', { text: String(d[2]) })); }));
    // last 14 days
    var days = [], now = new Date();
    for (var i = 13; i >= 0; i--) { var d = new Date(now); d.setDate(d.getDate() - i); days.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')); }
    var max = Math.max.apply(null, days.map(function (k) { return s.signupsByDay[k] || 0; }).concat([1]));
    $('signBars').replaceChildren.apply($('signBars'), days.map(function (k) {
      var n = s.signupsByDay[k] || 0;
      return h('div', { title: k + ': ' + n }, h('span', { text: n ? String(n) : '' }), h('i', { style: 'height:' + Math.max(3, n / max * 90) + '%' }), h('span', { text: k.slice(8) }));
    }));
    var ex = Object.keys(s.byExam).sort(function (a, b) { return s.byExam[b] - s.byExam[a]; }), tot = Math.max(1, s.total);
    $('examBars').replaceChildren.apply($('examBars'), ex.map(function (k) {
      return h('div', { class: 'hbar' }, h('span', { text: k }), h('span', { class: 'tr' }, h('i', { style: 'width:' + (s.byExam[k] / tot * 100) + '%' })), h('b', { text: String(s.byExam[k]) }));
    }));
  }

  var COLS = [['name', 'Name'], ['id', 'Mobile'], ['exam', 'Exam'], ['rank', 'Rank'], ['xp', 'XP'], ['tests', 'Tests'], ['accuracy', 'Accuracy %'], ['mistakes', 'Mistakes'], ['lastSeen', 'Last seen'], ['logins', 'Logins'], ['status', 'Status']];
  function renderUsers() {
    $('thead').replaceChildren.apply($('thead'), COLS.map(function (c) {
      var th = h('th', { scope: 'col', 'aria-sort': sort.k === c[0] ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none', text: c[1] + (sort.k === c[0] ? (sort.dir > 0 ? ' ▲' : ' ▼') : '') });
      th.addEventListener('click', function () { sort = { k: c[0], dir: sort.k === c[0] ? -sort.dir : 1 }; renderUsers(); });
      return th;
    }).concat([h('th', { text: 'Actions' })]));
    var q = $('uSearch').value.trim().toLowerCase();
    var rows = users.filter(function (u) { return !q || (u.name + ' ' + u.id + ' ' + u.exam).toLowerCase().indexOf(q) > -1; });
    rows.sort(function (a, b) { var x = a[sort.k], y = b[sort.k]; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir; });
    $('tbody').replaceChildren.apply($('tbody'), rows.slice(0, 300).map(function (u) {
      var blocked = u.status === 'blocked';
      var act = h('button', { class: 'btn sm', type: 'button', title: 'Activity log', 'aria-label': 'Activity log for ' + u.name }, h('i', { class: 'fas fa-clock-rotate-left' }));
      var perf = h('button', { class: 'btn sm', type: 'button', title: 'Test performance', 'aria-label': 'Test performance of ' + u.name }, h('i', { class: 'fas fa-chart-simple' }));
      perf.addEventListener('click', function () { performance(u); });
      var rst = h('button', { class: 'btn sm', type: 'button', title: 'Reset device binding', 'aria-label': 'Reset device for ' + u.name }, h('i', { class: 'fas fa-mobile-screen' }));
      var blk = h('button', { class: 'btn sm', type: 'button', title: blocked ? 'Unblock' : 'Block', 'aria-label': (blocked ? 'Unblock ' : 'Block ') + u.name }, h('i', { class: 'fas ' + (blocked ? 'fa-unlock' : 'fa-ban') }));
      var del = h('button', { class: 'btn sm danger', type: 'button', title: 'Delete user', 'aria-label': 'Delete ' + u.name }, h('i', { class: 'fas fa-trash' }));
      act.addEventListener('click', function () { activity(u); });
      rst.addEventListener('click', function () { confirmBox('Reset device?', u.name + ' will need their recovery code (or you can let them re-bind on next login).', 'Reset').then(function (ok) { if (ok) api('adminResetDevice', { userId: u.id }).then(function (d) { toast(d.message); }).catch(function (e) { toast(e.message); }); }); });
      blk.addEventListener('click', function () { confirmBox((blocked ? 'Unblock ' : 'Block ') + u.name + '?', blocked ? 'They will be able to sign in again.' : 'They will not be able to sign in.', blocked ? 'Unblock' : 'Block', !blocked).then(function (ok) { if (ok) api('adminBlock', { userId: u.id, block: !blocked }).then(function (d) { toast(d.message); loadAll(); }).catch(function (e) { toast(e.message); }); }); });
      del.addEventListener('click', function () { confirmBox('Delete ' + u.name + '?', 'This permanently erases their account and all cloud data. It cannot be undone.', 'Delete forever', true).then(function (ok) { if (ok) api('adminDeleteUser', { userId: u.id }).then(function () { toast('User deleted'); loadAll(); }).catch(function (e) { toast(e.message); }); }); });
      return h('tr', { class: blocked ? 'blocked' : '' },
        h('td', { text: u.name }), h('td', { text: u.id }), h('td', { text: u.exam }), h('td', { text: u.rank }), h('td', { text: String(u.xp) }),
        h('td', { text: u.tests === undefined ? '' : String(u.tests) }), h('td', { text: u.accuracy === '' || u.accuracy === undefined ? 'N/A' : u.accuracy + '%' }), h('td', { text: u.mistakes === undefined ? '' : String(u.mistakes) + (u.pendingRev ? ' (' + u.pendingRev + ' pending)' : '') }),
        h('td', { text: fmt(u.lastSeen) }), h('td', { text: String(u.logins) }), h('td', null, h('span', { class: 'pill ' + (blocked ? 'bad' : 'ok'), text: u.status })),
        h('td', null, h('div', { class: 'acts' }, act, perf, rst, blk, del)));
    }));
    $('uCount').textContent = rows.length + ' of ' + users.length + ' users' + (rows.length > 300 ? ' (showing first 300; refine your search)' : '');
  }
  $('uSearch').addEventListener('input', renderUsers);

  function activity(u) {
    api('adminActivity', { userId: u.id }).then(function (d) {
      var list = h('div', { class: 'list' }, d.items.length ? d.items.map(function (i) { return h('div', null, h('span', { text: i.action + (i.detail ? ' · ' + i.detail : '') }), h('small', { text: fmt(i.ts) })); }) : h('div', { text: 'No activity recorded.' }));
      var close = h('button', { class: 'btn', type: 'button', text: 'Close' });
      var ov = h('div', { class: 'ov', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'card' }, h('h3', { text: 'Activity: ' + u.name }), list, h('div', { style: 'text-align:right' }, close)));
      close.addEventListener('click', function () { ov.remove(); }); ov.addEventListener('mousedown', function (e) { if (e.target === ov) ov.remove(); });
      document.body.append(ov); close.focus();
    }).catch(function (e) { toast(e.message); });
  }

  /* v4: one student's test performance (numbers only; their private notes are never sent to the admin) */
  function pc(v) { return v === null || v === undefined || v === '' ? 'N/A' : v + '%'; }
  function performance(u) {
    api('adminUserAnalytics', { userId: u.id }).then(function (d) {
      var T = d.totals, M = d.mistakes;
      var kv = function (k, v) { return h('div', null, h('span', { text: k }), h('small', { text: String(v) })); };
      var subj = d.bySubject.filter(function (b) { return b.attempted > 0 || b.mistakes > 0; });
      var close = h('button', { class: 'btn', type: 'button', text: 'Close' });
      var csv = h('button', { class: 'btn', type: 'button', text: 'Download report (CSV)' });
      csv.addEventListener('click', function () {
        api('adminUserReport', { userId: u.id, kind: 'overall' }).then(function (r) {
          var q = function (v) { var s = String(v == null ? '' : v); if (/^[=+@\t\r-]/.test(s) && isNaN(Number(s))) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }, out = [q(r.title + ' - ' + u.name), ''];
          r.sections.forEach(function (s) { out.push(q(s.name)); out.push(s.columns.map(q).join(',')); s.rows.forEach(function (row) { out.push(row.map(q).join(',')); }); out.push(''); });
          download('zona-performance-' + u.id + '-' + Date.now() + '.csv', '\uFEFF' + out.join('\r\n'), 'text/csv');
        }).catch(function (e) { toast(e.message); });
      });
      var body = h('div', { class: 'list' },
        kv('Tests logged', T.tests), kv('Questions attempted', T.attempted + ' / ' + T.totalQ), kv('Overall cumulative accuracy (weighted)', pc(T.pct.accuracy)), kv('Average test score', pc(T.avgScorePct)),
        kv('Mistakes', M.total + ' (R1 ' + M.r1Done + ' · R2 ' + M.r2Done + ' · R3 ' + M.r3Done + ', pending ' + M.pending + ')'),
        kv('Current streaks', 'tests ' + d.streaks.test + ' d · MCQ ' + d.streaks.mcq + ' d · revision ' + d.streaks.revision + ' d'),
        d.byType.filter(function (b) { return b.tests; }).map(function (b) { return kv(b.label + ' (' + b.tests + ')', 'accuracy ' + pc(b.pct.accuracy) + ' · attempt ' + pc(b.pct.attempt)); }),
        subj.length ? subj.map(function (b) { return kv(b.name, 'accuracy ' + pc(b.pct.accuracy) + ' · ' + b.attempted + ' attempted · ' + b.mistakes + ' mistakes'); }) : kv('Subjects', 'no subject-wise data yet'));
      var ov = h('div', { class: 'ov', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'card' }, h('h3', { text: 'Performance: ' + u.name + ' (' + (d.user.exam || '') + ')' }), body, h('div', { style: 'text-align:right;display:flex;gap:8px;justify-content:flex-end' }, csv, close)));
      close.addEventListener('click', function () { ov.remove(); }); ov.addEventListener('mousedown', function (e) { if (e.target === ov) ov.remove(); });
      document.body.append(ov); close.focus();
    }).catch(function (e) { toast(e.code === 'NO_DATA' ? u.name + ' has not synced any tests yet.' : e.message); });
  }

  function renderSecurity(items) {
    $('secList').replaceChildren.apply($('secList'), items.length ? items.map(function (i) { return h('div', null, h('span', { text: i.type + ' · ' + i.actor + (i.detail ? ' · ' + i.detail : '') }), h('small', { text: fmt(i.ts) })); }) : [h('div', { text: 'No security events.' })]);
  }

  /* ---------- broadcast ---------- */
  $('bMsg').addEventListener('input', function () { $('bCount').textContent = this.value.length + ' / 500'; });
  $('bSend').addEventListener('click', function () {
    var m = $('bMsg').value.trim();
    if (m.length < 3) return toast('Write a longer message first.');
    confirmBox('Send to every user?', '"' + m.slice(0, 120) + (m.length > 120 ? '…' : '') + '"', 'Send broadcast').then(function (ok) {
      if (!ok) return;
      api('adminBroadcast', { message: m }).then(function (d) { toast(d.message); $('bMsg').value = ''; $('bCount').textContent = '0 / 500'; }).catch(function (e) { toast(e.message); });
    });
  });

  /* ---------- export ---------- */
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type })), a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 3000);
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                        // spreadsheet formula-injection guard
    return '"' + s.replace(/"/g, '""') + '"';
  }
  $('expJson').addEventListener('click', function () { api('adminExport').then(function (d) { download('zona-users-' + Date.now() + '.json', JSON.stringify(d, null, 1), 'application/json'); }).catch(function (e) { toast(e.message); }); });
  $('expCsv').addEventListener('click', function () {
    api('adminExport').then(function (d) {
      var keys = ['id', 'name', 'exam', 'rank', 'xp', 'tests', 'accuracy', 'mistakes', 'pendingRev', 'logins', 'joined', 'lastSeen', 'status'];
      var csv = [keys.join(',')].concat(d.users.map(function (u) { return keys.map(function (k) { return csvCell(u[k]); }).join(','); })).join('\r\n');
      download('zona-users-' + Date.now() + '.csv', '﻿' + csv, 'text/csv');
    }).catch(function (e) { toast(e.message); });
  });

  /* ---------- resume an existing tab session ---------- */
  try {
    var s = JSON.parse(sessionStorage.getItem('zona-admin') || 'null');
    if (s && s.t && s.e > Date.now() + 60000) { token = s.t; show(); }
  } catch (e) {}
})();
