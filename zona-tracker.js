/* =====================================================================
   Zona Occludens: Test & Mistake Tracker  (v4, part 1 of 2)
   ---------------------------------------------------------------------
   Loaded AFTER the main inline script and BEFORE zona-boot.js.
   Adds, without replacing anything that already exists:
     - Detailed Test Log  (permanent Test ID, subject-wise rows, mistakes inside the test)
     - Test History cards + complete Test Record
     - Mistake Log & Revision (R1 / R2 / R3 with append-only history)
   It writes into the SAME state.tests / state.errors lists the old pages use, so the old
   "Log a Test", "Test Records" and "Mistake Notebook" pages keep working and see the same data.
   All maths comes from zona-tracker-engine.js (also embedded in code.gs).
   Part 2 (zona-tracker-analytics.js): dashboard analytics, trends, subjects, weightage, exports.
   ===================================================================== */
(function () {
  'use strict';
  const Z = window.Zona, E = window.ZonaTrackerEngine;
  const $ = id => document.getElementById(id);
  const TRK = window.ZonaTracker = { version: E.VERSION };
  const S = TRK.S = { page: '', filt: { type: 'ALL', format: 'ALL', from: '', to: '' }, charts: {}, mIndex: {}, tvId: '',
    hist: { q: '', type: '', format: '', from: '', to: '', page: 1 },
    mf: { subject: '', topic: '', testId: '', from: '', to: '', type: '', priority: '', category: '', rev: '', q: '', page: 1 }, wx: 'NEET PG' };
  const RENDER = TRK.RENDER = {}, ACT = TRK.ACT = {}, CH = TRK.CH = {}, IN = TRK.IN = {};

  /* ------------------------------------------------------------- helpers */
  const C = TRK.C = { saffron: '#FF9F43', purple: '#7856FF', blue: '#6495ED', teal: '#20C9A6', cyan: '#35C8F4', coral: '#FF5B6E', gold: '#F7C948', lilac: '#B388FF' };
  const TYPE_C = TRK.TYPE_C = { GT: C.saffron, SWT: C.blue, Mock: C.purple, Daily: C.teal, Custom: C.cyan };
  const PRIO_C = { High: C.coral, Medium: C.saffron, Low: C.blue };
  const SUBJ_PALETTE = ['#FF9F43', '#7856FF', '#6495ED', '#20C9A6', '#35C8F4', '#FF5B6E', '#F7C948', '#B388FF', '#4DD0A1', '#FF8A65'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = n => String(n).padStart(2, '0');
  const today = () => getLocalDateString();
  const D = s => { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const fmtD = s => { if (!/^\d{4}-\d{2}-\d{2}/.test(s || '')) return s || '–'; const d = D(String(s).slice(0, 10)); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
  const dow = s => DOW[D(s).getDay()];
  const P = v => (v == null || v === '') ? 'N/A' : (Math.round(v * 10) / 10) + '%';
  const N = v => (v === '' || v == null || isNaN(Number(v))) ? '–' : Number(v).toLocaleString('en-IN');
  const n0 = v => (v === '' || v == null || isNaN(Number(v))) ? 0 : Number(v);
  const pct = E.pct;
  /* v4.1: the subject list (order, colours, hidden / added subjects) comes from Settings > Subject list when zona-aktrack.js is loaded */
  const subjects = () => { try { const l = TRK.subjectList && TRK.subjectList(); if (l && l.length) return l; } catch (e) {} return Object.keys(SUBJECT_EMOJIS).sort(); };
  const subjColor = name => (TRK.subjectColor && TRK.subjectColor(name)) || SUBJ_PALETTE[Math.max(0, subjects().indexOf(name)) % SUBJ_PALETTE.length];
  const subjText = k => (SUBJECT_EMOJIS[k] ? SUBJECT_EMOJIS[k] + ' ' : '') + k;
  let lastUid = 0;
  const uid = () => { let n = Date.now(); if (n <= lastUid) n = lastUid + 1; lastUid = n; return n; };
  const toast = (m, t) => showToast(m, t || 'success');

  const stat = (k, v, s, c, ic) => '<div class="t-stat" style="--c:' + c + '"><div class="k"><i class="fas ' + ic + '" aria-hidden="true"></i>' + esc(k) + '</div><div class="v">' + v + '</div><div class="s">' + (s || '&nbsp;') + '</div></div>';
  const badge = (t, c) => '<span class="t-badge" style="--c:' + (c || C.purple) + '">' + esc(t) + '</span>';
  const opts = (list, sel, blank) => (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(o => { const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');
  const fld = (label, html, cls) => '<div class="' + (cls || '') + '"><label class="fl">' + label + '</label>' + html + '</div>';
  const inp = (id, v, type, extra) => '<input class="form-control" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(v == null ? '' : v) + '" ' + (extra || '') + '>';
  const val = id => { const e = $(id); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : ''; };
  const emptyBox = (msg, icon) => '<div class="t-empty"><i class="fas ' + (icon || 'fa-inbox') + '" aria-hidden="true"></i>' + esc(msg) + '</div>';
  const pager = (page, pages, act) => pages < 2 ? '' : '<div class="t-row t-mt" style="justify-content:center"><button class="btn btn-sm btn-outline" data-trk="' + act + '" data-p="' + (page - 1) + '"' + (page < 2 ? ' disabled' : '') + '><i class="fas fa-chevron-left" aria-hidden="true"></i> Previous</button><span class="t-sub">Page ' + page + ' of ' + pages + '</span><button class="btn btn-sm btn-outline" data-trk="' + act + '" data-p="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>Next <i class="fas fa-chevron-right" aria-hidden="true"></i></button></div>';
  Object.assign(TRK, { stat, badge, opts, fld, inp, val, emptyBox, pager, fmtD, dow, P, N, n0, MON, today, D, subjects, subjColor, pad });

  /* modal */
  function overlay() {
    let ov = $('trkOverlay');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'trkOverlay'; ov.className = 'trk trk-overlay';
      ov.innerHTML = '<div class="trk-modal" id="trkModal" role="dialog" aria-modal="true"></div>';
      ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
      document.body.appendChild(ov);
    }
    return ov;
  }
  function modal(title, body, wide) {
    const ov = overlay();
    $('trkModal').className = 'trk-modal' + (wide ? ' wide' : '');
    $('trkModal').innerHTML = '<div class="trk-modal-h"><h3>' + title + '</h3><button class="t-ib" data-trk="closeModal" aria-label="Close"><i class="fas fa-xmark" aria-hidden="true"></i></button></div>' + body;
    ov.classList.add('show');
  }
  function closeModal() { const ov = $('trkOverlay'); if (ov) ov.classList.remove('show'); }
  ACT.closeModal = closeModal;
  TRK.modal = modal; TRK.closeModal = closeModal;
  const confirmBox = (title, message, ok, danger) => Z.modal.confirm({ title: title, message: message, confirmLabel: ok || 'Confirm', danger: !!danger });
  TRK.confirmBox = confirmBox;

  /* one delegated listener each for clicks, changes and typing (data-trk / data-trk-ch / data-trk-in) */
  document.addEventListener('click', e => { const el = e.target.closest && e.target.closest('[data-trk]'); if (el && ACT[el.dataset.trk]) { if (el.tagName === 'A') e.preventDefault(); ACT[el.dataset.trk](el.dataset, el, e); } });
  document.addEventListener('change', e => { const el = e.target.closest && e.target.closest('[data-trk-ch]'); if (el && CH[el.dataset.trkCh]) CH[el.dataset.trkCh](el); });
  document.addEventListener('input', e => { const el = e.target.closest && e.target.closest('[data-trk-in]'); if (el && IN[el.dataset.trkIn]) IN[el.dataset.trkIn](el); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('trkOverlay') && $('trkOverlay').classList.contains('show')) closeModal(); });

  /* --------------------------------------------------- lifecycle + sync */
  /** Gives every old test / notebook entry its permanent ID. Additive; saves only if something changed. */
  TRK.sync = function () { try { if (E.normalize(state)) saveData(); } catch (e) { console.error('[tracker] normalise', e); } };
  TRK.leave = function () { Object.keys(S.charts).forEach(k => { try { S.charts[k].destroy(); } catch (e) {} delete S.charts[k]; }); };
  TRK.render = function (page) {
    if (!RENDER[page]) return;
    TRK.sync(); S.page = page;
    try { RENDER[page](); } catch (e) { console.error('[tracker] render ' + page, e); const el = $('page-' + page); if (el) el.innerHTML = '<div class="trk"><div class="glass-card">' + emptyBox('This page could not be drawn. Please reload the app.', 'fa-triangle-exclamation') + '</div></div>'; }
  };
  TRK.rerender = function () {
    const act = document.querySelector('.page.active'); if (!act) return;
    const id = act.id.replace(/^page-/, '');
    if (RENDER[id]) { TRK.leave(); TRK.render(id); }
    else if (id === 'dashboard' && TRK.renderDash) { TRK.leave(); TRK.renderDash(); }
    else if (id === 'rewards' && TRK.renderRewardsExtra) TRK.renderRewardsExtra();
  };
  const go = TRK.go = page => navToPage(page);
  ACT.nav = d => go(d.page);
  const persist = () => { saveData(); try { updateDatalists(); } catch (e) {} };

  function topicLists(subject, topic) {
    const set = new Set(), sub = new Set();
    Object.values(state.masterTopics || {}).forEach(t => { if (t && (!subject || t.subject === subject) && t.topic) set.add(String(t.topic).slice(0, 120)); });
    (state.errors || []).forEach(e => { if (!e) return; if (!subject || E.subjKey(e) === subject) { if (e.broad) set.add(e.broad); if (e.subT && (!topic || String(e.broad || '').toLowerCase() === topic.toLowerCase())) sub.add(e.subT); } });
    [].concat(state.topicLibrary || [], state.plannerTasks || []).forEach(t => { if (!t || !t.topic || (subject && t.subject !== subject)) return; set.add(String(t.topic).slice(0, 120)); if (t.subtopic && (!topic || String(t.topic).toLowerCase() === topic.toLowerCase())) sub.add(t.subtopic); });   // v4.1 topic library
    const fill = (id, s) => { let dl = $(id); if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); } dl.innerHTML = Array.from(s).sort().slice(0, 400).map(x => '<option value="' + esc(x) + '">').join(''); };
    fill('trkTopics', set); fill('trkSubtopics', sub);
  }

  /* XP: each reward is paid once per record, so re-saving or reopening can never pay twice */
  function award(rec, key, xp) {
    if (!rec || typeof Gami === 'undefined') return;
    if (!rec.xpA || typeof rec.xpA !== 'object') rec.xpA = {};
    if (rec.xpA[key]) return;
    rec.xpA[key] = 1;
    try { Gami.addXP(xp); Gami.refreshChrome(); } catch (e) {}
  }

  /* ====================================================================
     DETAILED TEST LOG  (central module) -> subject rows -> mistakes -> R1/R2/R3
     ==================================================================== */
  let TF = null;
  const Q_FIELDS = ['totalQ', 'attempted', 'correct', 'incorrect'];
  const DRAFT_KEY = 'zona-trk-draft';
  const draftStore = { get() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }, set(v) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch (e) {} }, del() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} } };
  function tfBlank() {
    const f = E.FORMATS['NEET PG'];
    return { mode: 'new', key: 0, tid: '', incomplete: false, incAuto: true, subjects: [], mistakes: [],
      test: { id: '', name: '', type: 'GT', format: 'NEET PG', provider: '', date: today(), startTime: '', endTime: '', durationMin: '', totalMarks: '', marksPerQuestion: f.mpq, negativeMarking: f.neg,
        subjectsIncluded: '', topicsCovered: '', remarks: '', totalQ: '', attempted: '', correct: '', incorrect: '', score: '', analysed: false } };
  }
  function clearDrafts() { draftStore.del(); const T = E.tracker(state); if (T.draft) { T.draft = null; } }
  TRK.newTest = function (prefill) { TF = tfBlank(); if (prefill) Object.assign(TF.test, prefill); draftStore.del(); };
  function tfLoad(t) {
    TF = tfBlank();
    const fm = E.FORMATS[t.format] || E.FORMATS.Other, pick = (v, d) => (v === undefined || v === null) ? d : v;
    Object.assign(TF, { mode: 'edit', key: t.id, tid: t.tid, incomplete: !!t.subjIncomplete, incAuto: false, mistakes: (state.errors || []).filter(e => e && e.testId === t.tid) });
    Object.assign(TF.test, { id: t.tid, name: t.name || '', type: E.TEST_TYPES[t.type] ? t.type : 'Custom', format: t.format || 'Other', provider: t.provider || '', date: t.date, startTime: t.startTime || '', endTime: t.endTime || '',
      durationMin: pick(t.durationMin, ''), totalMarks: pick(t.max, ''), marksPerQuestion: pick(t.mpq, fm.mpq), negativeMarking: pick(t.neg, fm.neg),
      subjectsIncluded: (t.coveredSubjects || []).join(', '), topicsCovered: t.topicsCovered || '', remarks: t.remarks || '', totalQ: pick(t.total, ''), attempted: pick(t.attempted, ''), correct: pick(t.correct, ''),
      incorrect: pick(t.wrong, ''), score: pick(t.score, ''), analysed: !!t.analysed });
    TF.subjects = (t.subjects || []).map(s => ({ subject: s.subject, totalQ: pick(s.totalQ, ''), attempted: pick(s.attempted, ''), correct: pick(s.correct, ''), incorrect: pick(s.incorrect, ''), marks: pick(s.marks, ''), remarks: s.remarks || '', incAuto: false }));
    // values the app filled in automatically go back to "auto" so they keep following the numbers
    const mpq = TF.test.marksPerQuestion, neg = TF.test.negativeMarking;
    if (mpq !== '') {
      if (Number(TF.test.score) === E.autoScore(TF.test.correct, TF.test.incorrect, mpq, neg)) TF.test.score = '';
      if (Number(TF.test.totalMarks) === E.round2(n0(TF.test.totalQ) * mpq)) TF.test.totalMarks = '';
      TF.subjects.forEach(s => { if (Number(s.marks) === E.autoScore(s.correct, s.incorrect, mpq, neg)) s.marks = ''; });
    }
    draftStore.del();
  }
  function tfDraft() { clearTimeout(S.draftT); S.draftT = setTimeout(() => { if (TF && TF.mode === 'new') draftStore.set(TF); }, 600); }
  function tfStats(o) { const t = n0(o.totalQ), a = n0(o.attempted), c = n0(o.correct), i = n0(o.incorrect), u = t - a; return { t, a, c, i, u, pa: pct(a, t), pc: pct(c, t), pi: pct(i, t), pu: pct(Math.max(u, 0), t), acc: pct(c, a) }; }
  const subSums = () => E.subjectSums(TF.subjects);
  const liveRows = () => TF.subjects.filter(s => Q_FIELDS.some(f => s[f] !== '' && s[f] != null));
  function tfErrors() {
    const e = [], t = TF.test;
    if (TF.mode === 'new' && t.id) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._\-]{1,39}$/.test(t.id)) e.push('Test ID may use letters, numbers, dot, dash and underscore (2-40 characters).');
      else if (E.idTaken(state, t.id)) e.push('Test ID "' + t.id + '" already exists. Test IDs must be unique.');
    }
    const sc = t.score === '' ? '' : Number(t.score), mx = t.totalMarks === '' ? '' : Number(t.totalMarks);
    return e.concat(E.validateTest({ date: t.date, name: t.name, type: t.type, total: t.totalQ, attempted: t.attempted, correct: t.correct, wrong: t.incorrect, score: sc, max: mx }, liveRows(), TF.incomplete));
  }
  function showErrs(list) { const el = $('tf-errs'); if (!el) return; el.innerHTML = list.length ? '<div class="t-alert t-mb" style="--c:' + C.coral + '"><i class="fas fa-circle-exclamation" aria-hidden="true"></i><div><b>Please fix before saving:</b><ul>' + list.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div></div>' : ''; }

  RENDER['test-log'] = function () {
    if (!TF) {
      const d = draftStore.get() || E.tracker(state).draft;
      if (d && d.test && d.mode === 'new') { TF = Object.assign(tfBlank(), d); TF.test = Object.assign(tfBlank().test, d.test); toast('Your unsaved test draft was restored.', 'info'); } else TF = tfBlank();
    }
    if (TF.mode === 'edit') { const live = (state.tests || []).find(x => x.id === TF.key); if (!live) TF = tfBlank(); else TF.mistakes = (state.errors || []).filter(e => e && e.testId === TF.tid); }
    const t = TF.test, ed = TF.mode === 'edit', types = Object.entries(E.TEST_TYPES);
    const ni = (f, label, extra) => fld(label, '<input class="form-control mono" inputmode="numeric" type="number" min="0" step="1" data-trk-in="tf" data-f="' + f + '" id="tf-' + f + '" value="' + esc(t[f]) + '" ' + (extra || '') + '>');
    $('page-test-log').innerHTML = '<div class="trk">' +
      '<div class="t-row t-between t-mb"><div class="t-row">' + badge(ed ? 'Editing ' + TF.tid : 'New test', ed ? C.blue : C.teal) + (ed ? '' : badge('Draft is kept on this device while you type', C.lilac)) + '</div>' +
      '<div class="t-row">' + (ed ? '<button class="btn btn-sm btn-outline" data-trk="openTest" data-id="' + esc(TF.tid) + '"><i class="fas fa-eye" aria-hidden="true"></i> View record</button>' : '') + '<button class="btn btn-sm btn-outline" data-trk="tfReset"><i class="fas fa-plus" aria-hidden="true"></i> Start a new test</button><button class="btn btn-sm btn-outline" data-trk="nav" data-page="test-history"><i class="fas fa-folder-open" aria-hidden="true"></i> Test History</button></div></div>' +
      '<div id="tf-errs"></div>' +
      '<div class="glass-card t-acc t-mb" style="--acc:' + C.purple + '"><div class="t-card-h"><h3><i class="fas fa-id-card" aria-hidden="true"></i>Test information</h3><span id="tf-idchip"></span></div><div class="t-fgrid">' +
      fld('Test category', '<select class="form-control" data-trk-in="tf" data-f="type">' + opts(types, t.type) + '</select>') +
      fld('Exam format', '<select class="form-control" data-trk-in="tf" data-f="format">' + opts(Object.keys(E.FORMATS), t.format) + '</select>') +
      fld('Test ID ' + (ed ? '(permanent)' : '(optional, blank = auto)'), '<input class="form-control mono" data-trk-in="tf" data-f="id" id="tf-id" maxlength="40" placeholder="e.g. ZO-GT-001" value="' + esc(ed ? TF.tid : t.id) + '"' + (ed ? ' readonly' : '') + '>') +
      fld('Test date', '<input class="form-control" type="date" data-trk-in="tf" data-f="date" value="' + esc(t.date) + '">') +
      fld('Test name', '<input class="form-control" data-trk-in="tf" data-f="name" maxlength="120" list="past-sources" autocomplete="off" placeholder="e.g. Grand Test 01" value="' + esc(t.name) + '">', 'w2') +
      fld('Test provider', '<input class="form-control" data-trk-in="tf" data-f="provider" maxlength="80" placeholder="e.g. Marrow, PrepLadder, DAMS" value="' + esc(t.provider) + '">') +
      fld('Start time', '<input class="form-control" type="time" data-trk-in="tf" data-f="startTime" value="' + esc(t.startTime) + '">') +
      fld('End time', '<input class="form-control" type="time" data-trk-in="tf" data-f="endTime" value="' + esc(t.endTime) + '">') +
      ni('durationMin', 'Duration (minutes)') +
      fld('Marks per question', '<input class="form-control mono" type="number" min="0" step="0.01" data-trk-in="tf" data-f="marksPerQuestion" id="tf-marksPerQuestion" value="' + esc(t.marksPerQuestion) + '">') +
      fld('Negative marking (per wrong)', '<input class="form-control mono" type="number" min="0" step="0.01" data-trk-in="tf" data-f="negativeMarking" id="tf-negativeMarking" value="' + esc(t.negativeMarking) + '">') +
      fld('Total marks', '<input class="form-control mono" type="number" min="0" step="0.01" data-trk-in="tf" data-f="totalMarks" id="tf-totalMarks" value="' + esc(t.totalMarks) + '">') +
      fld('Marks obtained', '<input class="form-control mono" type="number" step="0.01" data-trk-in="tf" data-f="score" id="tf-score" value="' + esc(t.score) + '">') +
      fld('Subjects included', '<input class="form-control" data-trk-in="tf" data-f="subjectsIncluded" id="tf-subjectsIncluded" maxlength="600" placeholder="Filled automatically from the subject-wise section" value="' + esc(t.subjectsIncluded) + '">', 'w2') +
      fld('Topics covered', '<input class="form-control" data-trk-in="tf" data-f="topicsCovered" maxlength="1000" value="' + esc(t.topicsCovered) + '">', 'w2') +
      fld('Personal remarks', '<textarea class="form-control" data-trk-in="tf" data-f="remarks" maxlength="3000">' + esc(t.remarks) + '</textarea>', 'wf') +
      '<div class="wf"><label class="t-chk"><input type="checkbox" data-trk-in="tf" data-f="analysed"' + (t.analysed ? ' checked' : '') + '> I have completed the analysis of this test <span class="t-sub">(+' + E.REWARDS.analysis + ' XP, once)</span></label></div></div></div>' +
      '<div class="glass-card t-acc t-mb" style="--acc:' + C.cyan + '"><div class="t-card-h"><h3><i class="fas fa-calculator" aria-hidden="true"></i>Question statistics</h3><span class="t-sub">Accuracy here belongs to this test only.</span></div><div class="t-fgrid t-mb">' +
      ni('totalQ', 'Total questions') + ni('attempted', 'Attempted') + ni('correct', 'Correct') + ni('incorrect', 'Incorrect') + fld('Unattempted (auto)', '<input class="form-control mono" id="tf-un" readonly>') + '</div>' +
      '<div class="t-grid t-g6" id="tf-tiles"></div></div>' +
      '<div class="glass-card t-acc t-mb" id="tf-subcard" style="--acc:' + C.lilac + '"></div>' +
      '<div class="glass-card t-acc t-mb" id="tf-mcard" style="--acc:' + C.coral + '"></div>' +
      '<div class="glass-card"><div class="t-row t-between"><span class="t-sub"><i class="fas fa-shield-halved" aria-hidden="true"></i> Saved on this device at once and synced to your encrypted cloud copy automatically (works offline).</span><div class="t-row">' +
      (ed ? '' : '<button class="btn btn-outline" data-trk="tfDraftSave"><i class="fas fa-floppy-disk" aria-hidden="true"></i> Save draft</button>') + '<button class="btn btn-primary" data-trk="tfSave"><i class="fas fa-check" aria-hidden="true"></i> ' + (ed ? 'Update test' : 'Save test') + '</button></div></div></div></div>';
    tfSubRender(); tfMistRender(); tfCalc(); tfPreview();
  };
  function tfSubRender() {
    const used = {}; TF.subjects.forEach(s => used[s.subject] = 1);
    const avail = subjects().filter(s => !used[s]);
    const cell = (i, f, v) => '<td><input class="form-control mono" type="number" min="0" step="1" inputmode="numeric" data-trk-in="ts" data-i="' + i + '" data-f="' + f + '" value="' + esc(v) + '" aria-label="' + f + '"></td>';
    $('tf-subcard').innerHTML = '<div class="t-card-h"><h3><i class="fas fa-layer-group" aria-hidden="true"></i>Subject-wise performance</h3><div class="t-row">' +
      '<button class="btn btn-sm btn-outline" data-trk="tfAddAll"><i class="fas fa-list-check" aria-hidden="true"></i> Add all ' + subjects().length + ' subjects</button>' +
      '<select class="form-control" id="tf-addsub" style="width:210px">' + opts(avail.map(s => [s, subjText(s)]), '', avail.length ? 'Choose a subject…' : 'All subjects added') + '</select><button class="btn btn-sm btn-primary" data-trk="tfAddSub"><i class="fas fa-plus" aria-hidden="true"></i> Add subject</button></div></div>' +
      (TF.subjects.length ? '<div class="t-tw"><table class="t-t"><thead><tr><th>Subject</th><th>Total</th><th>Attempted</th><th>Correct</th><th>Incorrect</th><th class="n">Unatt.</th><th class="n">Attempt %</th><th class="n">Accuracy</th><th class="n">Correct %</th><th class="n">Incorrect %</th><th class="n">Unatt. %</th><th>Marks</th><th>Remarks</th><th></th></tr></thead><tbody>' +
        TF.subjects.map((s, i) => '<tr><td style="white-space:nowrap"><b>' + esc(subjText(s.subject)) + '</b></td>' + cell(i, 'totalQ', s.totalQ) + cell(i, 'attempted', s.attempted) + cell(i, 'correct', s.correct) + cell(i, 'incorrect', s.incorrect) +
          ['un', 'pa', 'acc', 'pc', 'pi', 'pu'].map(k => '<td class="n" id="ts-' + i + '-' + k + '"></td>').join('') +
          '<td><input class="form-control mono" type="number" step="0.01" data-trk-in="ts" data-i="' + i + '" data-f="marks" id="ts-' + i + '-marks" value="' + esc(s.marks) + '" aria-label="marks"></td><td><input class="form-control txt" data-trk-in="ts" data-i="' + i + '" data-f="remarks" maxlength="300" value="' + esc(s.remarks || '') + '" aria-label="remarks"></td>' +
          '<td><button class="t-ib" data-trk="tfDelSub" data-i="' + i + '" title="Remove subject" aria-label="Remove ' + esc(s.subject) + '"><i class="fas fa-trash" aria-hidden="true"></i></button></td></tr>').join('') +
        '</tbody><tfoot><tr><td>Subject totals</td>' + Q_FIELDS.map(f => '<td class="n" id="ts-sum-' + f + '"></td>').join('') + '<td class="n" id="ts-sum-un"></td><td class="n" id="ts-sum-pa"></td><td class="n" id="ts-sum-acc"></td><td colspan="6"></td></tr></tfoot></table></div>' +
        '<div class="t-row t-between t-mt"><div id="ts-rec" class="t-grow"></div><div class="t-row"><label class="t-chk"><input type="checkbox" data-trk-in="tfInc"' + (TF.incomplete ? ' checked' : '') + '> Subject breakdown is incomplete</label><button class="btn btn-sm btn-outline" data-trk="tfFillOverall" title="Copy the subject totals into the overall question statistics"><i class="fas fa-arrow-up" aria-hidden="true"></i> Use subject totals as overall</button></div></div>'
        : emptyBox('No subject rows yet. A Grand Test can use every subject; an SWT or mock can use one or several. If the provider gives no breakdown, leave this empty.', 'fa-layer-group'));
  }
  function tfCalc() {
    if (!$('tf-tiles')) return;
    const s = tfStats(TF.test), set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    $('tf-un').value = TF.test.totalQ === '' ? '' : s.u;
    $('tf-tiles').innerHTML = stat('Attempt %', P(s.pa), s.a + ' / ' + s.t, C.cyan, 'fa-gauge-high') + stat('Test accuracy', s.a ? P(s.acc) : 'N/A', s.c + ' correct / ' + s.a + ' attempted', C.purple, 'fa-crosshairs') + stat('Correct %', P(s.pc), s.c + ' / ' + s.t, C.teal, 'fa-check') + stat('Incorrect %', P(s.pi), s.i + ' / ' + s.t, C.coral, 'fa-xmark') + stat('Unattempted %', P(s.pu), Math.max(s.u, 0) + ' / ' + s.t, C.lilac, 'fa-minus');
    const mpq = TF.test.marksPerQuestion, neg = TF.test.negativeMarking;
    if (mpq !== '' && $('tf-totalMarks')) { $('tf-totalMarks').placeholder = s.t ? 'Auto: ' + E.round2(s.t * mpq) : ''; $('tf-score').placeholder = s.a ? 'Auto: ' + E.autoScore(s.c, s.i, mpq, neg) : ''; }
    TF.subjects.forEach((r, i) => { const x = tfStats(r); set('ts-' + i + '-un', x.u); set('ts-' + i + '-pa', P(x.pa)); set('ts-' + i + '-acc', x.a ? P(x.acc) : 'N/A'); set('ts-' + i + '-pc', P(x.pc)); set('ts-' + i + '-pi', P(x.pi)); set('ts-' + i + '-pu', P(x.pu));
      const m = $('ts-' + i + '-marks'); if (m && mpq !== '') m.placeholder = x.a ? String(E.autoScore(x.c, x.i, mpq, neg)) : ''; });
    const inc = $('tf-subjectsIncluded');
    if (TF.subjects.length) {
      const sm = subSums(); Q_FIELDS.forEach(f => set('ts-sum-' + f, sm[f])); set('ts-sum-un', sm.totalQ - sm.attempted); set('ts-sum-pa', P(pct(sm.attempted, sm.totalQ))); set('ts-sum-acc', sm.attempted ? P(pct(sm.correct, sm.attempted)) : 'N/A');
      const lab = { totalQ: 'Total', attempted: 'Attempted', correct: 'Correct', incorrect: 'Incorrect' };
      if ($('ts-rec')) $('ts-rec').innerHTML = '<div class="t-row"><span class="t-sub">Reconciliation with overall:</span>' + Q_FIELDS.map(f => { const ok = sm[f] === n0(TF.test[f]); return badge(lab[f] + ' ' + sm[f] + (ok ? ' ✓' : ' ≠ ' + n0(TF.test[f])), ok ? C.teal : (TF.incomplete ? C.saffron : C.coral)); }).join('') + (TF.incomplete ? badge('Marked incomplete', C.saffron) : '') + '</div>';
      if (inc) { inc.value = TF.subjects.map(x => x.subject).join(', '); inc.readOnly = true; }
    } else if (inc) inc.readOnly = false;
    if ($('tf-errs') && $('tf-errs').innerHTML) showErrs(tfErrors());
  }
  function autoInc(o, f, inputEl) {
    if (f === 'incorrect') { o.incAuto = false; return; }
    if ((f === 'attempted' || f === 'correct') && o.incAuto !== false && o.attempted !== '' && o.correct !== '') { o.incorrect = Math.max(n0(o.attempted) - n0(o.correct), 0); if (inputEl) inputEl.value = o.incorrect; }
  }
  IN.tf = el => {
    const f = el.dataset.f, t = TF.test;
    t[f] = el.type === 'checkbox' ? el.checked : el.tagName === 'TEXTAREA' ? el.value : el.value.trim();
    if (f === 'format') { const d = E.FORMATS[t.format] || E.FORMATS.Other; t.marksPerQuestion = d.mpq; t.negativeMarking = d.neg; $('tf-marksPerQuestion').value = d.mpq; $('tf-negativeMarking').value = d.neg; if (t.totalQ === '') $('tf-totalQ').placeholder = 'e.g. ' + d.total; }
    if (f === 'incorrect') TF.incAuto = false;
    else if ((f === 'attempted' || f === 'correct') && TF.incAuto && t.attempted !== '' && t.correct !== '') { t.incorrect = Math.max(n0(t.attempted) - n0(t.correct), 0); $('tf-incorrect').value = t.incorrect; }
    if ((f === 'startTime' || f === 'endTime') && t.startTime && t.endTime) { const m = x => +x.slice(0, 2) * 60 + +x.slice(3); t.durationMin = (m(t.endTime) - m(t.startTime) + 1440) % 1440; $('tf-durationMin').value = t.durationMin; }
    if (f === 'date' || f === 'id') tfPreview();
    tfCalc(); tfDraft();
  };
  IN.ts = el => { const r = TF.subjects[+el.dataset.i], f = el.dataset.f; if (!r) return; r[f] = el.value.trim(); autoInc(r, f, el.closest('tr').querySelector('[data-f="incorrect"]')); tfCalc(); tfDraft(); };
  IN.tfInc = el => { TF.incomplete = el.checked; tfCalc(); tfDraft(); };
  const newSubRow = s => ({ subject: s, totalQ: '', attempted: '', correct: '', incorrect: '', marks: '', remarks: '', incAuto: true });
  ACT.tfAddAll = () => { const used = {}; TF.subjects.forEach(s => used[s.subject] = 1); subjects().forEach(s => { if (!used[s]) TF.subjects.push(newSubRow(s)); }); tfSubRender(); tfMistRender(); tfCalc(); tfDraft(); };
  ACT.tfAddSub = () => { const s = val('tf-addsub'); if (!s) return toast('Choose a subject to add.', 'warn'); TF.subjects.push(newSubRow(s)); tfSubRender(); tfMistRender(); tfCalc(); tfDraft(); };
  ACT.tfDelSub = d => { TF.subjects.splice(+d.i, 1); tfSubRender(); tfCalc(); tfDraft(); };
  ACT.tfFillOverall = () => { const sm = subSums(); Q_FIELDS.forEach(f => { TF.test[f] = sm[f]; $('tf-' + f).value = sm[f]; }); TF.incAuto = false; tfCalc(); tfDraft(); };
  ACT.tfReset = async () => {
    if (TF && TF.mode === 'new' && (TF.test.name || TF.test.totalQ !== '' || TF.mistakes.length) && !(await confirmBox('Discard this test?', 'The test you are entering has not been saved. Start a new one?', 'Discard', true))) return;
    TRK.newTest(); clearDrafts(); TRK.render('test-log'); window.scrollTo(0, 0);
  };
  function tfPreview() {
    const el = $('tf-idchip'); if (!el) return;
    if (TF.mode === 'edit') { el.innerHTML = badge('Test ID ' + TF.tid + ' · permanent', C.blue); return; }
    if (!E.isDate(TF.test.date)) { el.innerHTML = badge('Choose a test date to generate the ID', C.saffron); return; }
    const manual = TF.test.id;
    if (manual) { const ok = /^[A-Za-z0-9][A-Za-z0-9._\-]{1,39}$/.test(manual) && !E.idTaken(state, manual); el.innerHTML = badge(ok ? '✓ ' + manual + ' is available' : '✗ ' + manual + ' cannot be used', ok ? C.teal : C.coral); }
    else el.innerHTML = badge('Will be saved as ' + E.peekTestId(state, TF.test.date), C.teal) + ' <span class="t-sub">auto-generated from the test date</span>';
  }
  ACT.tfDraftSave = () => { const copy = JSON.parse(JSON.stringify(TF)); E.tracker(state).draft = copy; draftStore.set(copy); saveData(); toast('Draft saved. It will follow you to your other devices after the next sync.'); };
  ACT.tfSave = () => {
    const errs = tfErrors(); showErrs(errs);
    if (errs.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return toast('Nothing was saved. Fix the problems listed at the top.', 'error'); }
    const t = TF.test, ed = TF.mode === 'edit', st = tfStats(t), now = new Date().toISOString();
    const mpq = t.marksPerQuestion === '' ? '' : Number(t.marksPerQuestion), neg = t.negativeMarking === '' ? '' : Number(t.negativeMarking);
    const rows = liveRows().map(s => { const x = tfStats(s); return { subject: s.subject, totalQ: x.t, attempted: x.a, correct: x.c, incorrect: x.i, marks: s.marks !== '' ? Number(s.marks) : (mpq !== '' ? E.autoScore(x.c, x.i, mpq, neg) : ''), remarks: String(s.remarks || '').slice(0, 300) }; });
    let max = t.totalMarks !== '' ? Number(t.totalMarks) : (mpq !== '' ? E.round2(st.t * mpq) : st.t);
    let score = t.score !== '' ? Number(t.score) : (mpq !== '' ? E.autoScore(st.c, st.i, mpq, neg) : st.c);
    const covered = rows.length ? rows.map(r => r.subject) : (t.subjectsIncluded ? t.subjectsIncluded.split(',').map(x => x.trim()).filter(Boolean).slice(0, 40) : (t.type === 'GT' ? ['All Subjects'] : []));
    const fields = { format: t.format, type: t.type, date: t.date, name: t.name.trim().slice(0, 120), provider: t.provider.slice(0, 80), startTime: t.startTime, endTime: t.endTime, durationMin: t.durationMin === '' ? '' : n0(t.durationMin),
      mpq: mpq, neg: neg, total: st.t, attempted: st.a, correct: st.c, wrong: st.i, score: score, max: max, pct: max > 0 ? parseFloat((score / max * 100).toFixed(2)) : 0, acc: st.a > 0 ? (st.c / st.a * 100).toFixed(1) : 0,
      coveredSubjects: covered, topicsCovered: t.topicsCovered.slice(0, 1000), remarks: t.remarks.slice(0, 3000), analysed: !!t.analysed, subjects: rows, subjIncomplete: rows.length ? !!TF.incomplete : false, updatedAt: now };
    let rec;
    if (ed) {
      rec = (state.tests || []).find(x => x.id === TF.key);
      if (!rec) return toast('This test no longer exists. It may have been deleted on another device.', 'error');
      const changed = rec.name !== fields.name || rec.date !== fields.date || rec.type !== fields.type;
      Object.assign(rec, fields);
      if (changed) (state.errors || []).forEach(m => { if (m && m.testId === rec.tid) { m.source = rec.name; m.date = rec.date; m.testType = rec.type; } });
    } else {
      rec = Object.assign({ id: uid(), tid: '' }, fields, { createdAt: now });
      if (t.id) { rec.tid = t.id; E.tracker(state).usedIds[t.id.toUpperCase()] = 1; } else rec.tid = E.nextTestId(state, t.date);
      state.tests.push(rec);
      try { rec.xp = Gami.event('test', { type: rec.type, date: rec.date, id: rec.id }); } catch (e) {}
      if (state.planner && state.planner[rec.date] && Array.isArray(state.planner[rec.date].targets)) state.planner[rec.date].targets.push({ text: '[TEST LOGGED: ' + rec.name + ']', done: true });
      TF.mistakes.forEach(m => createMistake(rec, m));
      clearDrafts();
    }
    if (rec.analysed) award(rec, 'analysis', E.REWARDS.analysis);
    persist();
    tfLoad(rec);
    toast((ed ? 'Test updated' : 'Test saved') + ' · Test ID ' + rec.tid);
    TRK.render('test-log');
  };

  /* ------------------------------------------------------------ mistakes */
  const M_FIELDS = ['subject', 'topic', 'subtopic', 'questionNo', 'category', 'priority', 'reason', 'correctConcept', 'explanation', 'notes'];
  /** One shape for the form whether the mistake is a saved record or still waiting for its test to be saved. */
  const mv = m => m._tmp ? m : { subject: E.subjKey(m), topic: m.broad || '', subtopic: m.subT || '', questionNo: m.qno || '', category: m.category || 'Other', priority: m.priority || 'Medium', reason: m.reason || '', correctConcept: m.concept || '', explanation: m.explanation || '', notes: m.notes || '' };
  function applyMistake(rec, m) {
    Object.assign(rec, { subjectKey: m.subject, subject: subjText(m.subject), broad: (m.topic || 'General').slice(0, 160), subT: m.subtopic.slice(0, 240), qno: m.questionNo.slice(0, 20),
      category: E.MISTAKE_CATEGORIES.indexOf(m.category) > -1 ? m.category : 'Other', priority: E.PRIORITIES.indexOf(m.priority) > -1 ? m.priority : 'Medium',
      reason: m.reason.slice(0, 1500), concept: m.correctConcept.slice(0, 2000), explanation: m.explanation.slice(0, 3000), notes: m.notes.slice(0, 3000) });
    return rec;
  }
  function createMistake(test, m) {
    const rec = applyMistake({ id: uid(), mid: E.nextMistakeId(state, test.tid, test.date), testId: test.tid, date: test.date, source: test.name, testType: test.type,
      resolved: false, r1: 'Pending', r1Date: '', r2: 'Locked', r2Date: '', r3: 'Locked', r3Date: '', hist: [], createdAt: new Date().toISOString() }, m);
    state.errors.push(rec);
    try { Gami.event('error', { date: rec.date }); } catch (e) {}
    award(rec, 'mistake', E.REWARDS.mistake);
    return rec;
  }
  function mistakeForm(p, m, first) {
    m = m || {};
    let subs = subjects(); if (m.subject && subs.indexOf(m.subject) === -1) subs = subs.concat([m.subject]);
    if (first && first.length) subs = subs.filter(s => first.indexOf(s) > -1).concat(subs.filter(s => first.indexOf(s) === -1));
    const ta = (k, label, ph) => fld(label, '<textarea class="form-control" id="' + p + '-' + k + '" placeholder="' + ph + '" style="min-height:58px">' + esc(m[k] || '') + '</textarea>', 'w2');
    return '<div class="t-fgrid">' +
      fld('Subject', '<select class="form-control" id="' + p + '-subject" data-trk-ch="mfSubj" data-p="' + p + '">' + opts(subs.map(s => [s, subjText(s)]), m.subject, 'Select subject…') + '</select>') +
      fld('Topic', '<input class="form-control" id="' + p + '-topic" list="trkTopics" data-trk-ch="mfSubj" data-p="' + p + '" maxlength="120" autocomplete="off" value="' + esc(m.topic || '') + '">') +
      fld('Subtopic', '<input class="form-control" id="' + p + '-subtopic" list="trkSubtopics" maxlength="120" autocomplete="off" value="' + esc(m.subtopic || '') + '">') +
      fld('Question no. (optional)', inp(p + '-questionNo', m.questionNo, 'text', 'maxlength="20"')) +
      fld('Mistake category', '<select class="form-control" id="' + p + '-category">' + opts(E.MISTAKE_CATEGORIES, m.category || 'Conceptual error') + '</select>') +
      fld('Priority', '<select class="form-control" id="' + p + '-priority">' + opts(E.PRIORITIES, m.priority || 'Medium') + '</select>') +
      ta('reason', 'Reason for mistake', 'Why did I get it wrong?') + ta('correctConcept', 'Correct answer / concept', 'The right answer and the concept behind it') +
      ta('explanation', 'Explanation', 'Detailed explanation') + ta('notes', 'Personal learning notes', 'What I must remember next time') + '</div>';
  }
  const readMistake = p => { const o = {}; M_FIELDS.forEach(k => o[k] = (($(p + '-' + k) || {}).value || '').trim()); return o; };
  function mistakeProblem(m) { if (!m.subject) return 'Choose the subject of this mistake.'; if (!m.topic && !m.reason && !m.correctConcept && !m.notes) return 'Enter at least a topic, reason, correct concept or note.'; return ''; }
  CH.mfSubj = el => topicLists(val(el.dataset.p + '-subject'), val(el.dataset.p + '-topic'));
  function revPills(m) {
    if (m._tmp) return badge('Will be saved with the test · starts at R1 Pending', C.saffron);
    return '<div class="t-pills">' + [1, 2, 3].map(n => { const st = m['r' + n], d = m['r' + n + 'Date'];
      return '<button class="t-rpill ' + (st === 'Completed' ? 'done' : st === 'Pending' ? 'pending' : 'locked') + '" data-trk="rev" data-id="' + esc(m.mid) + '" title="R' + n + ': ' + esc(st) + '"><i class="fas ' + (st === 'Completed' ? 'fa-circle-check' : st === 'Pending' ? 'fa-hourglass-half' : 'fa-lock') + '" aria-hidden="true"></i>R' + n + (st === 'Completed' ? ' · ' + esc(fmtD(d).replace(/ \d{4}$/, '')) : st === 'Pending' ? ' pending' : '') + '</button>'; }).join('') + '</div>';
  }
  function mCard(m, o) {
    o = o || {}; const v = mv(m), key = m._tmp || m.mid; S.mIndex[key] = m;
    const line = (l, x) => x ? '<p><b>' + l + ':</b> ' + esc(x) + '</p>' : '';
    return '<div class="t-mcard" style="--c:' + subjColor(v.subject) + '"><div class="t-row t-between"><div class="t-row">' + badge(subjText(v.subject) || 'Subject', subjColor(v.subject)) + badge(v.category, C.coral) + badge(v.priority + ' priority', PRIO_C[v.priority]) + (v.questionNo ? badge('Q ' + v.questionNo, C.blue) : '') + '</div>' +
      '<div class="t-row">' + (o.showTest && m.testId && E.findTest(state, m.testId) ? '<button class="btn btn-sm btn-outline" data-trk="openTest" data-id="' + esc(m.testId) + '"><i class="fas fa-file-lines" aria-hidden="true"></i> ' + esc(m.testId) + '</button>' : '') +
      '<button class="t-ib" data-trk="mEdit" data-id="' + esc(key) + '" title="Edit mistake" aria-label="Edit mistake"><i class="fas fa-pen" aria-hidden="true"></i></button><button class="t-ib" data-trk="mDel" data-id="' + esc(key) + '" title="Delete mistake" aria-label="Delete mistake"><i class="fas fa-trash" aria-hidden="true"></i></button></div></div>' +
      '<h5>' + esc(v.topic || 'No topic') + (v.subtopic ? ' <span class="t-sub">› ' + esc(v.subtopic) + '</span>' : '') + '</h5>' +
      line('Reason', v.reason) + line('Correct answer / concept', v.correctConcept) + line('Explanation', v.explanation) + line('Learning notes', v.notes) +
      '<div class="t-row t-between" style="margin-top:10px"><span class="t-sub">' + (m._tmp ? 'Not saved yet' : esc(m.mid)) + (o.showTest ? ' · ' + esc(m.source || 'Notebook entry') + (m.date ? ' · ' + esc(fmtD(m.date)) : '') + (m.testType ? ' · ' + esc(m.testType) : '') : '') + '</span>' + revPills(m) + '</div></div>';
  }
  function mistakeGroups(list, o) {
    const g = {}; list.forEach(m => { const k = mv(m).subject; (g[k] || (g[k] = [])).push(m); });
    return Object.keys(g).sort().map(k => '<div class="t-sect" style="--acc:' + subjColor(k) + '">' + esc(subjText(k)) + ' · ' + g[k].length + ' mistake' + (g[k].length > 1 ? 's' : '') + '</div><div class="t-grid t-g2">' + g[k].map(m => mCard(m, o)).join('') + '</div>').join('');
  }
  TRK.mistakeGroups = mistakeGroups; TRK.mCard = mCard;
  function tfMistRender() {
    if (!$('tf-mcard')) return;
    const keep = $('mf-subject') ? readMistake('mf') : (S.mfLast || {}), first = TF.subjects.map(s => s.subject), by = {};
    TF.mistakes.forEach(m => { const n = mv(m).subject; by[n] = (by[n] || 0) + 1; });
    $('tf-mcard').innerHTML = '<div class="t-card-h"><h3><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>Mistake log &amp; revision tracker</h3><div class="t-row">' + badge(TF.mistakes.length + ' mistake' + (TF.mistakes.length === 1 ? '' : 's') + ' in this test', C.coral) + '</div></div>' +
      '<p class="t-sub t-mb">Every mistake added here is linked automatically to ' + (TF.mode === 'edit' ? 'Test ID <b>' + esc(TF.tid) + '</b>' : 'this test\'s ID') + ', its date and its type. It also appears in your Mistake Notebook. Add as many as you need for any subject.</p>' +
      mistakeForm('mf', keep, first) +
      '<div class="t-row t-mt" style="justify-content:flex-end"><button class="btn btn-outline" data-trk="mfClear"><i class="fas fa-eraser" aria-hidden="true"></i> Clear</button><button class="btn btn-primary" data-trk="tfAddMistake"><i class="fas fa-plus" aria-hidden="true"></i> ' + (TF.mistakes.length ? 'Save mistake &amp; add another' : 'Save mistake') + '</button></div>' +
      (TF.mistakes.length ? '<div class="t-row t-mt">' + Object.keys(by).map(k => badge(k + ' · ' + by[k], C.purple)).join('') + '</div>' + mistakeGroups(TF.mistakes) : emptyBox('No mistakes recorded for this test yet.', 'fa-face-smile'));
    topicLists(val('mf-subject'), val('mf-topic'));
  }
  const MF_CLEAR = ['topic', 'subtopic', 'questionNo', 'reason', 'correctConcept', 'explanation', 'notes'];
  ACT.mfClear = () => { S.mfLast = null; MF_CLEAR.forEach(k => { if ($('mf-' + k)) $('mf-' + k).value = ''; }); };
  ACT.tfAddMistake = () => {
    const m = readMistake('mf'), bad = mistakeProblem(m); if (bad) return toast(bad, 'warn');
    S.mfLast = { subject: m.subject, category: m.category, priority: m.priority };
    if (TF.mode !== 'edit') { m._tmp = 'tmp-' + uid(); TF.mistakes.push(m); toast('Mistake added. It will be saved together with the test.', 'info'); tfDraft(); }
    else { const test = (state.tests || []).find(x => x.id === TF.key); if (!test) return toast('Save the test first: a mistake must belong to a Test ID.', 'error'); const rec = createMistake(test, m); TF.mistakes.push(rec); persist(); toast('Mistake ' + rec.mid + ' saved.'); }
    MF_CLEAR.forEach(k => { if ($('mf-' + k)) $('mf-' + k).value = ''; });
    tfMistRender(); if ($('mf-topic')) $('mf-topic').focus();
  };
  /* edit / delete / revise: shared by the test entry, the test record and the global overview */
  function afterMistakeChange() { if (S.page === 'test-log' && isPageActive('test-log')) { TF.mistakes = TF.mode === 'edit' ? (state.errors || []).filter(e => e && e.testId === TF.tid) : TF.mistakes; tfMistRender(); } else TRK.rerender(); }
  ACT.mEdit = d => { const m = S.mIndex[d.id]; if (!m) return; S.editKey = d.id; const v = mv(m);
    modal('<i class="fas fa-pen" aria-hidden="true"></i> Edit mistake' + (m.mid ? ' · ' + esc(m.mid) : ''), mistakeForm('me', v) + '<div class="t-row t-mt" style="justify-content:flex-end"><button class="btn btn-outline" data-trk="closeModal">Cancel</button><button class="btn btn-primary" data-trk="mEditSave"><i class="fas fa-check" aria-hidden="true"></i> Save changes</button></div>', true);
    topicLists(v.subject, v.topic); };
  ACT.mEditSave = () => {
    const old = S.mIndex[S.editKey], m = readMistake('me'), bad = mistakeProblem(m); if (bad) return toast(bad, 'warn');
    if (old._tmp) Object.assign(old, m); else { applyMistake(old, m); old.updatedAt = new Date().toISOString(); persist(); toast('Mistake updated.'); }
    closeModal(); afterMistakeChange();
  };
  ACT.mDel = async d => {
    const m = S.mIndex[d.id]; if (!m) return;
    if (m._tmp) { TF.mistakes = TF.mistakes.filter(x => x !== m); return tfMistRender(); }
    if (!(await confirmBox('Delete mistake ' + m.mid + '?', 'The mistake and its revision history are removed from your notebook. Its ID is never reused.', 'Delete', true))) return;
    const i = state.errors.indexOf(m); if (i > -1) state.errors.splice(i, 1);
    persist(); toast('Mistake deleted.'); afterMistakeChange();
  };
  const STAGE_NAME = { 1: 'R1 – First Revision', 2: 'R2 – Second Revision', 3: 'R3 – Third Revision' };
  ACT.rev = d => {
    const m = S.mIndex[d.id]; if (!m || m._tmp) return; S.revKey = d.id;
    const next = [1, 2, 3].find(n => m['r' + n] === 'Pending'), last = [3, 2, 1].find(n => m['r' + n] === 'Completed'), hist = m.hist || [];
    modal('<i class="fas fa-rotate" aria-hidden="true"></i> Revision · ' + esc(m.broad || m.mid),
      '<p class="t-sub t-mb">' + esc(m.mid) + ' · ' + esc(E.subjKey(m)) + (m.testId ? ' · Test ' + esc(m.testId) : ' · Notebook entry') + '</p><div class="t-grid t-g3 t-mb">' + [1, 2, 3].map(n => { const st = m['r' + n];
        return '<div class="t-stat" style="--c:' + (st === 'Completed' ? C.teal : st === 'Pending' ? C.saffron : C.blue) + '"><div class="k">' + STAGE_NAME[n] + '</div><div class="v" style="font-size:18px">' + esc(st) + '</div><div class="s">' + (st === 'Completed' ? esc(fmtD(m['r' + n + 'Date'])) : st === 'Locked' ? 'Opens after R' + (n - 1) : 'Not done yet') + '</div></div>'; }).join('') + '</div>' +
      (next ? '<div class="glass-card t-mb"><div class="t-card-h"><h3>' + STAGE_NAME[next] + '</h3><span class="t-sub">+' + E.REWARDS['r' + next] + ' XP, once</span></div><div class="t-fgrid">' + fld('Completion date', inp('rv-date', today(), 'date', 'max="' + today() + '"')) + fld('Revision notes', '<textarea class="form-control" id="rv-notes" maxlength="2000" placeholder="What did I recall? What is still weak?"></textarea>', 'w2') + '</div><div class="t-row t-mt" style="justify-content:flex-end"><button class="btn t-t" data-trk="revDo" data-stage="' + next + '" data-action="complete"><i class="fas fa-circle-check" aria-hidden="true"></i> Mark R' + next + ' completed</button></div></div>'
        : '<div class="t-alert t-mb" style="--c:' + C.teal + '"><i class="fas fa-trophy" aria-hidden="true"></i><div>This mistake is fully revised (R1, R2 and R3 completed).</div></div>') +
      (last ? '<div class="t-row t-mb"><input class="form-control t-grow" id="rv-reopen" maxlength="500" placeholder="Reason for reopening R' + last + ' (optional)"><button class="btn btn-outline" data-trk="revDo" data-stage="' + last + '" data-action="reopen"><i class="fas fa-rotate-left" aria-hidden="true"></i> Reopen R' + last + '</button></div>' : '') +
      '<div class="t-sect">Revision history</div>' + (hist.length ? '<ul class="t-hist">' + hist.map(h => '<li style="--c:' + (h.action === 'Completed' ? C.teal : C.saffron) + '"><b>' + esc(h.stage) + ' ' + esc(h.action) + '</b> · ' + esc(fmtD(h.date)) + (h.notes ? '<div class="t-sub" style="white-space:pre-wrap">' + esc(h.notes) + '</div>' : '') + '</li>').join('') + '</ul>' : '<p class="t-sub">No revisions recorded yet. Earlier notes are never overwritten.</p>'), true);
  };
  ACT.revDo = d => {
    const m = S.mIndex[S.revKey], re = d.action === 'reopen'; if (!m) return;
    try { E.revise(m, +d.stage, d.action, re ? '' : val('rv-date'), re ? val('rv-reopen') : val('rv-notes'), today()); } catch (e) { return toast(e.message, 'error'); }
    if (!re) award(m, 'r' + d.stage, E.REWARDS['r' + d.stage]);
    persist(); toast('R' + d.stage + (re ? ' reopened.' : ' completed.') + ' History updated.');
    closeModal(); afterMistakeChange();
  };

  /* ====================================================================
     TEST RECORD  (complete original record of one test)
     ==================================================================== */
  ACT.openTest = d => { S.tvId = d.id; navToPage('test-view'); };
  RENDER['test-view'] = function () {
    const el = $('page-test-view'), t = E.findTest(state, S.tvId);
    if (!t) { el.innerHTML = '<div class="trk"><div class="glass-card">' + emptyBox('Test not found. It may have been deleted.', 'fa-folder-open') + '<div style="text-align:center"><button class="btn btn-outline" data-trk="nav" data-page="test-history">Back to Test History</button></div></div></div>'; return; }
    const st = E.stats(t), p = E.pctBlock(st), ms = (state.errors || []).filter(m => m && m.testId === t.tid), M = E.mistakeSummary(ms);
    const kv = (k, v) => v === '' || v == null ? '' : '<div><small>' + k + '</small><b style="font-size:13.5px">' + esc(v) + '</b></div>';
    S.mIndex = {};
    el.innerHTML = '<div class="trk"><div class="t-row t-between t-mb"><button class="btn btn-outline" data-trk="nav" data-page="test-history"><i class="fas fa-arrow-left" aria-hidden="true"></i> Test History</button><div class="t-row">' +
      '<button class="btn btn-primary" data-trk="editTest" data-id="' + esc(t.tid) + '"><i class="fas fa-pen" aria-hidden="true"></i> Edit / update mistakes</button><button class="btn btn-outline" data-trk="exportMenu" data-kind="test" data-id="' + esc(t.tid) + '"><i class="fas fa-download" aria-hidden="true"></i> Export</button><button class="btn t-d" data-trk="delTest" data-id="' + esc(t.tid) + '"><i class="fas fa-trash" aria-hidden="true"></i> Delete</button></div></div>' +
      '<div class="t-hero t-mb" style="--c:' + (TYPE_C[t.type] || C.blue) + '"><div class="t-row">' + badge(E.typeLabel(t.type), TYPE_C[t.type]) + badge(t.format || 'Other', C.cyan) + (t.analysed ? badge('Analysed', C.teal) : '') + '</div><h2 style="font-size:24px;margin:8px 0 0">' + esc(t.name || 'Untitled test') + '</h2><p class="t-sub">Test ID <b>' + esc(t.tid) + '</b> · ' + esc(fmtD(t.date)) + (t.provider ? ' · ' + esc(t.provider) : '') + '</p></div>' +
      '<div class="t-grid t-g6 t-mb">' + stat('Total questions', N(st.totalQ), '', C.blue, 'fa-list-ol') + stat('Attempted', N(st.attempted), P(p.attempt) + ' attempt', C.cyan, 'fa-pen') + stat('Correct', N(st.correct), P(p.correct) + ' of total', C.teal, 'fa-check') + stat('Incorrect', N(st.incorrect), P(p.incorrect) + ' of total', C.coral, 'fa-xmark') + stat('Unattempted', N(st.unattempted), P(p.unattempted) + ' of total', C.lilac, 'fa-minus') + stat('Test accuracy', P(p.accuracy), 'this test only', C.purple, 'fa-crosshairs') + '</div>' +
      '<div class="t-grid t-g2 t-mb"><div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-circle-info" aria-hidden="true"></i>Details</h3></div><div class="t-kv">' + kv('Start', t.startTime) + kv('End', t.endTime) + kv('Duration', t.durationMin === '' || t.durationMin == null ? '' : t.durationMin + ' min') + kv('Marks / Q', t.mpq) + kv('Negative', t.neg) + kv('Marks', t.score == null || t.score === '' ? '' : t.score + (t.max == null || t.max === '' ? '' : ' / ' + t.max)) + kv('Subject data', (t.subjects || []).length ? (t.subjIncomplete ? 'incomplete' : 'complete') : 'none') + kv('Mistakes', M.total) + '</div>' +
      ((t.coveredSubjects || []).length ? '<p class="t-sub t-mt"><b>Subjects:</b> ' + esc(t.coveredSubjects.join(', ')) + '</p>' : '') + (t.topicsCovered ? '<p class="t-sub"><b>Topics:</b> ' + esc(t.topicsCovered) + '</p>' : '') + (t.remarks ? '<p class="t-sub" style="white-space:pre-wrap"><b>Remarks:</b> ' + esc(t.remarks) + '</p>' : '') + '</div>' +
      '<div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-chart-pie" aria-hidden="true"></i>Correct vs incorrect</h3></div><div class="t-chart"><canvas id="tv-dough"></canvas></div></div></div>' +
      '<div class="glass-card t-mb"><div class="t-card-h"><h3><i class="fas fa-layer-group" aria-hidden="true"></i>Subject-wise performance</h3>' + (t.subjIncomplete ? badge('Breakdown marked incomplete', C.saffron) : '') + '</div>' +
      ((t.subjects || []).length ? '<div class="t-tw"><table class="t-t"><thead><tr><th>Subject</th><th class="n">Total</th><th class="n">Attempted</th><th class="n">Correct</th><th class="n">Incorrect</th><th class="n">Unatt.</th><th class="n">Attempt %</th><th class="n">Accuracy</th><th class="n">Correct %</th><th class="n">Incorrect %</th><th class="n">Unatt. %</th><th class="n">Marks</th><th>Remarks</th></tr></thead><tbody>' +
        t.subjects.map(s => { const x = E.stats(s), q = E.pctBlock(x); return '<tr><td><b>' + esc(subjText(s.subject)) + '</b></td><td class="n">' + x.totalQ + '</td><td class="n">' + x.attempted + '</td><td class="n okc">' + x.correct + '</td><td class="n badc">' + x.incorrect + '</td><td class="n">' + x.unattempted + '</td><td class="n">' + P(q.attempt) + '</td><td class="n"><b>' + P(q.accuracy) + '</b></td><td class="n">' + P(q.correct) + '</td><td class="n">' + P(q.incorrect) + '</td><td class="n">' + P(q.unattempted) + '</td><td class="n">' + N(s.marks) + '</td><td>' + esc(s.remarks || '') + '</td></tr>'; }).join('') + '</tbody></table></div>'
        : emptyBox('No subject-wise breakdown was recorded for this test. Use "Edit / update mistakes" to add one.', 'fa-layer-group')) + '</div>' +
      '<div class="glass-card t-acc" style="--acc:' + C.coral + '"><div class="t-card-h"><h3><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>Mistakes of this test only</h3><div class="t-row">' + badge(M.total + ' total', C.coral) + badge('R1 ' + M.r1Done, C.teal) + badge('R2 ' + M.r2Done, C.blue) + badge('R3 ' + M.r3Done, C.purple) + '<button class="btn btn-sm btn-outline" data-trk="exportMenu" data-kind="mistakes" data-id="' + esc(t.tid) + '"><i class="fas fa-download" aria-hidden="true"></i> Export</button></div></div>' +
      (ms.length ? mistakeGroups(ms) : emptyBox('No mistakes recorded for this test. Use "Edit / update mistakes" to add them inside its log entry.', 'fa-face-smile')) + '</div></div>';
    if (TRK.chart) TRK.chart('tv-dough', 'doughnut', ['Correct', 'Incorrect', 'Unattempted'], [{ data: [st.correct, st.incorrect, st.unattempted], backgroundColor: [C.teal, C.coral, C.blue], borderWidth: 0 }]);
  };
  ACT.editTest = d => { const t = E.findTest(state, d.id); if (!t) return toast('Test not found.', 'error'); tfLoad(t); go('test-log'); };
  ACT.delTest = async d => {
    const t = E.findTest(state, d.id); if (!t) return;
    const n = (state.errors || []).filter(m => m && m.testId === t.tid).length;
    if (!(await confirmBox('Delete test ' + t.tid + '?', 'The test' + (n ? ' and its ' + n + ' linked mistake' + (n > 1 ? 's' : '') : '') + ' will be removed. The Test ID is never reused. Tip: export the test first if you may want it later.', 'Delete test', true))) return;
    try { Gami.revoke(t.xp); } catch (e) {}
    state.tests = state.tests.filter(x => x !== t);
    state.errors = (state.errors || []).filter(m => !(m && m.testId === t.tid));
    if (TF && TF.key === t.id) TF = null;
    persist(); toast('Test deleted.'); go('test-history');
  };
  ACT.newTest = () => { TRK.newTest(); go('test-log'); };

  /* ====================================================================
     TEST HISTORY  (cards, search, filters)
     ==================================================================== */
  RENDER['test-history'] = function () {
    const h = S.hist;
    $('page-test-history').innerHTML = '<div class="trk"><div class="glass-card t-mb"><div class="t-fgrid">' + fld('Search by Test ID, name or provider', '<input class="form-control" id="h-q" data-trk-in="histSet" data-k="q" placeholder="e.g. ZO-20261115-001" value="' + esc(h.q) + '">', 'w2') +
      fld('Test category', '<select class="form-control" data-trk-in="histSet" data-k="type">' + opts(Object.entries(E.TEST_TYPES), h.type, 'All categories') + '</select>') +
      fld('Exam format', '<select class="form-control" data-trk-in="histSet" data-k="format">' + opts(Object.keys(E.FORMATS), h.format, 'All formats') + '</select>') +
      fld('From', '<input type="date" class="form-control" data-trk-in="histSet" data-k="from" value="' + esc(h.from) + '">') + fld('To', '<input type="date" class="form-control" data-trk-in="histSet" data-k="to" value="' + esc(h.to) + '">') +
      '<div class="wf t-row" style="justify-content:flex-end"><button class="btn btn-outline" data-trk="exportMenu" data-kind="tests"><i class="fas fa-download" aria-hidden="true"></i> Export history</button><button class="btn btn-primary" data-trk="newTest"><i class="fas fa-plus" aria-hidden="true"></i> Log a test</button></div></div></div><div id="histList"></div></div>';
    histList();
  };
  IN.histSet = el => { S.hist[el.dataset.k] = el.value.trim(); S.hist.page = 1; histList(); };
  ACT.histPage = d => { S.hist.page = +d.p; histList(); window.scrollTo(0, 0); };
  function histList() {
    const h = S.hist, q = h.q.toLowerCase(), mc = E.mistakeCounts(state);
    const list = (state.tests || []).filter(t => t && (!q || ((t.tid || '') + ' ' + (t.name || '') + ' ' + (t.provider || '')).toLowerCase().indexOf(q) > -1) && (!h.type || t.type === h.type) && (!h.format || t.format === h.format) && (!h.from || t.date >= h.from) && (!h.to || t.date <= h.to))
      .sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id);
    const size = 12, pages = Math.max(1, Math.ceil(list.length / size)); h.page = Math.min(h.page, pages);
    $('histList').innerHTML = (list.length ? '<p class="t-sub t-mb">' + list.length + ' test' + (list.length > 1 ? 's' : '') + '</p><div class="t-grid t-g3">' + list.slice((h.page - 1) * size, h.page * size).map(t => {
      const st = E.stats(t), p = E.pctBlock(st), M = mc[t.tid] || { total: 0, r1: 0, r2: 0, r3: 0 }, rp = M.total ? Math.round((M.r1 + M.r2 + M.r3) / (M.total * 3) * 100) : 0;
      return '<div class="glass-card t-tcard t-acc" style="--acc:' + (TYPE_C[t.type] || C.blue) + '" data-trk="openTest" data-id="' + esc(t.tid) + '"><div class="t-row t-between"><div class="t-row">' + badge(t.type || 'Test', TYPE_C[t.type]) + badge(t.format || 'Other', C.cyan) + (t.analysed ? badge('Analysed', C.teal) : '') + '</div><span class="t-sub">' + esc(fmtD(t.date)) + '</span></div>' +
        '<h3 style="font-family:var(--font-head);font-size:17px;margin:8px 0 0;color:var(--text-main)">' + esc(t.name || 'Untitled test') + '</h3><p class="t-sub t-mb"><b>' + esc(t.tid) + '</b>' + (t.provider ? ' · ' + esc(t.provider) : '') + '</p>' +
        '<div class="t-row t-mb" style="flex-wrap:nowrap"><div class="t-ring" style="--p:' + (p.accuracy || 0) + ';--c:' + C.purple + '"><b>' + (p.accuracy == null ? 'N/A' : Math.round(p.accuracy) + '%') + '</b></div><div><b style="color:var(--text-main)">Accuracy ' + P(p.accuracy) + '</b><div class="t-sub">Attempt ' + P(p.attempt) + (t.score != null && t.score !== '' ? ' · Marks ' + esc(t.score) + ' / ' + esc(t.max) : '') + '</div></div></div>' +
        '<div class="t-kv"><div><small>Total</small><b>' + st.totalQ + '</b></div><div><small>Attempted</small><b>' + st.attempted + '</b></div><div><small>Correct</small><b class="okc">' + st.correct + '</b></div><div><small>Incorrect</small><b class="badc">' + st.incorrect + '</b></div><div><small>Unatt.</small><b>' + st.unattempted + '</b></div><div><small>Mistakes</small><b>' + M.total + '</b></div></div>' +
        '<div style="margin-top:12px"><div class="t-row t-between t-sub"><span>Revision progress · R1 ' + M.r1 + ' · R2 ' + M.r2 + ' · R3 ' + M.r3 + '</span><b>' + rp + '%</b></div><div class="t-pbar" style="margin-top:5px"><i style="width:' + rp + '%"></i></div></div>' +
        '<div class="t-row t-mt"><button class="btn btn-sm btn-outline" data-trk="editTest" data-id="' + esc(t.tid) + '"><i class="fas fa-pen" aria-hidden="true"></i> Edit</button><button class="btn btn-sm btn-outline" data-trk="exportMenu" data-kind="test" data-id="' + esc(t.tid) + '"><i class="fas fa-download" aria-hidden="true"></i> Export</button></div></div>'; }).join('') + '</div>'
      : '<div class="glass-card">' + emptyBox((state.tests || []).length ? 'No tests match your search.' : 'No tests logged yet.', 'fa-folder-open') + '</div>') + pager(h.page, pages, 'histPage');
  }
  /* a card click opens the record; a button inside the card runs only its own action (closest() picks the button first) */

  /* ====================================================================
     MISTAKE LOG & REVISION  (global overview of the same records)
     ==================================================================== */
  RENDER['mistake-revision'] = function () {
    const el = $('page-mistake-revision'), f = S.mf, all = (state.errors || []).filter(Boolean), o = E.mistakeSummary(all), rows = E.filterMistakes(state, f), sm = E.mistakeSummary(rows);
    const size = 20, pages = Math.max(1, Math.ceil(rows.length / size)); f.page = Math.max(1, Math.min(pages, f.page || 1));
    const mp = n => o.total ? P(pct(n, o.total)) : '';
    S.mIndex = {};
    el.innerHTML = '<div class="trk"><div class="t-alert t-mb" style="--c:' + C.blue + '"><i class="fas fa-circle-info" aria-hidden="true"></i><div>This is the global view of every mistake, including the ones in your Mistake Notebook. New mistakes are best created inside their own <b>Detailed Test Log</b>, so each one stays linked to its Test ID and subject. <button class="btn btn-sm btn-outline" data-trk="nav" data-page="test-history" style="margin-left:6px">Open a test</button> <button class="btn btn-sm btn-outline" data-trk="newTest">Log a new test</button> <button class="btn btn-sm btn-outline" data-trk="nav" data-page="error-log">Quick notebook entry</button></div></div>' +
      '<div class="t-grid t-g4 t-mb">' + stat('Total mistakes', N(o.total), 'across all tests', C.coral, 'fa-triangle-exclamation') + stat('R1 pending', N(o.r1Pending), mp(o.r1Pending), C.saffron, 'fa-hourglass-start') + stat('R1 completed', N(o.r1Done), mp(o.r1Done), C.teal, 'fa-1') + stat('R2 pending', N(o.r2Pending), mp(o.r2Pending), C.saffron, 'fa-hourglass-half') +
      stat('R2 completed', N(o.r2Done), mp(o.r2Done), C.blue, 'fa-2') + stat('R3 pending', N(o.r3Pending), mp(o.r3Pending), C.saffron, 'fa-hourglass-end') + stat('R3 completed', N(o.r3Done), mp(o.r3Done), C.purple, 'fa-3') + stat('Fully revised', N(o.fullyRevised), mp(o.fullyRevised), C.teal, 'fa-trophy') + '</div>' +
      '<div class="glass-card t-mb"><div class="t-fgrid">' + fld('Search', '<input class="form-control" data-trk-ch="mfSet" data-k="q" placeholder="Topic, concept, notes…" value="' + esc(f.q) + '">', 'w2') +
      fld('Subject', '<select class="form-control" data-trk-ch="mfSet" data-k="subject">' + opts(subjects().map(s => [s, subjText(s)]), f.subject, 'All subjects') + '</select>') +
      fld('Topic', '<input class="form-control" data-trk-ch="mfSet" data-k="topic" value="' + esc(f.topic) + '">') + fld('Test ID', '<input class="form-control" data-trk-ch="mfSet" data-k="testId" value="' + esc(f.testId) + '">') +
      fld('Test type', '<select class="form-control" data-trk-ch="mfSet" data-k="type">' + opts(Object.entries(E.TEST_TYPES), f.type, 'All types') + '</select>') +
      fld('Category', '<select class="form-control" data-trk-ch="mfSet" data-k="category">' + opts(E.MISTAKE_CATEGORIES, f.category, 'Any category') + '</select>') +
      fld('Priority', '<select class="form-control" data-trk-ch="mfSet" data-k="priority">' + opts(E.PRIORITIES, f.priority, 'Any priority') + '</select>') +
      fld('Revision status', '<select class="form-control" data-trk-ch="mfSet" data-k="rev">' + opts([['r1p', 'R1 pending'], ['r2p', 'R2 pending'], ['r3p', 'R3 pending'], ['full', 'Fully revised']], f.rev, 'Any status') + '</select>') +
      fld('Date from', '<input type="date" class="form-control" data-trk-ch="mfSet" data-k="from" value="' + esc(f.from) + '">') + fld('Date to', '<input type="date" class="form-control" data-trk-ch="mfSet" data-k="to" value="' + esc(f.to) + '">') +
      '<div class="wf t-row" style="justify-content:flex-end"><button class="btn btn-outline" data-trk="mfReset"><i class="fas fa-filter-circle-xmark" aria-hidden="true"></i> Reset</button><button class="btn btn-outline" data-trk="exportMenu" data-kind="mistakes"><i class="fas fa-download" aria-hidden="true"></i> Mistakes</button><button class="btn btn-outline" data-trk="exportMenu" data-kind="revisions"><i class="fas fa-download" aria-hidden="true"></i> Revisions</button></div></div></div>' +
      '<p class="t-sub t-mb">' + rows.length + ' mistake' + (rows.length === 1 ? '' : 's') + ' match · R1 pending ' + sm.r1Pending + ' · R2 pending ' + sm.r2Pending + ' · R3 pending ' + sm.r3Pending + ' · fully revised ' + sm.fullyRevised + '</p>' +
      (rows.length ? '<div class="t-grid t-g2">' + rows.slice((f.page - 1) * size, f.page * size).map(m => mCard(m, { showTest: true })).join('') + '</div>' : '<div class="glass-card">' + emptyBox(o.total ? 'No mistakes match these filters.' : 'No mistakes recorded yet. Add them while logging a test.', 'fa-face-smile') + '</div>') + pager(f.page, pages, 'mfPage') + '</div>';
  };
  CH.mfSet = el => { S.mf[el.dataset.k] = el.value.trim(); S.mf.page = 1; TRK.render('mistake-revision'); };
  ACT.mfReset = () => { Object.keys(S.mf).forEach(k => S.mf[k] = ''); S.mf.page = 1; TRK.render('mistake-revision'); };
  ACT.mfPage = d => { S.mf.page = +d.p; TRK.render('mistake-revision'); window.scrollTo(0, 0); };
})();
