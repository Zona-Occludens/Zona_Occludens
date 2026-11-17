/* =====================================================================
   Zona Occludens: AKTrack v1.1 interface layer  (v4.1)
   ---------------------------------------------------------------------
   Loaded AFTER zona-tracker.js / zona-tracker-analytics.js and BEFORE zona-boot.js.
   Adds, without removing anything that already exists:
     - AKTrack look: colour-tiled sidebar, AKTrack dark + light palette, mobile bottom bar
       (Settings → Appearance can switch back to the classic Zona look at any time)
     - Dashboard heroes: INICET + NEET PG countdowns, study streak, today's goal ring, XP, coins
     - Daily Planner (task based, AKTrack style): day strip, week, month calendar, searchable list,
       task modal (subject / topic / subtopic / target / hours / MCQs / revision / GT / tag / status),
       reschedule with history, missed tasks, planner period. The classic planner is kept.
     - Settings: Account & examination goals, Subject list editor, Topic library
   Data (all inside the same synced state):
     state.akSettings   exam dates, planner period, daily goals, paper sizes
     state.akSubjects   [{ name, base, short, color, order, active }]
     state.plannerTasks [{ id, date, subject, topic, subtopic, studyTarget, hours, mcqTarget, mcqDone,
                           revisionTarget, gtTarget, priority, status, remarks, rescheduledFrom, xpA }]
     state.topicLibrary [{ id, subject, topic, subtopic, src: 'manual' | 'auto' }]
   ===================================================================== */
(function () {
  'use strict';
  const Z = window.Zona, E = window.ZonaTrackerEngine, TRK = window.ZonaTracker;
  if (!Z || !E || !TRK) { console.error('[aktrack] tracker modules missing'); return; }
  const $ = id => document.getElementById(id);
  const { stat, badge, opts, fld, inp, val, emptyBox, fmtD, dow, N, MON, today, D, pad, pager } = TRK;
  const C = TRK.C, ACT = TRK.ACT, CH = TRK.CH, IN = TRK.IN, RENDER = TRK.RENDER;
  const AK = window.ZonaAK = { version: '4.1.0' };
  const isObj = E.isObj, addDays = E.addDays, dayDiff = E.dayDiff;
  const toast = (m, t) => showToast(m, t || 'success');
  const S = AK.S = { pl: { view: 'day', date: '', q: '', status: '', priority: '', missed: false, page: 1 }, topicSub: '', topicQ: '' };

  /* =================================================================== SETTINGS */
  const profile = () => (state && state.userProfile) || {};
  AK.cfg = function () { return E.akSettings(state, profile()); };
  AK.examTotal = function (exam) { const a = AK.cfg(); return /^INICET/i.test(exam) ? a.inicetTotalQ : /^NEET/i.test(exam) ? a.neetpgTotalQ : null; };
  TRK.examTotal = AK.examTotal;
  const inPeriod = d => { const a = AK.cfg(); return E.isDate(d) && d >= a.plannerStart && d <= a.plannerEnd; };
  const clampDate = d => { const a = AK.cfg(); return d < a.plannerStart ? a.plannerStart : d > a.plannerEnd ? a.plannerEnd : d; };

  /* =================================================================== SUBJECT LIST */
  const DEF_ORDER = ['Anatomy', 'Physiology', 'Biochemistry', 'Pathology', 'Pharmacology', 'Microbiology', 'Forensic Medicine', 'Community Medicine', 'General Medicine', 'General Surgery',
    'OBG', 'Pediatrics', 'Ophthalmology', 'ENT', 'Orthopedics', 'Dermatology', 'Psychiatry', 'Anesthesia', 'Radiology', 'Integrated Approach'];
  const SHORT = { Anatomy: 'ANAT', Physiology: 'PHYS', Biochemistry: 'BIOC', Pathology: 'PATH', Pharmacology: 'PHAR', Microbiology: 'MICR', 'Forensic Medicine': 'FMT', 'Community Medicine': 'PSM',
    'General Medicine': 'MED', 'General Surgery': 'SURG', OBG: 'OBG', Pediatrics: 'PED', Ophthalmology: 'OPH', ENT: 'ENT', Orthopedics: 'ORTH', Dermatology: 'DERM', Psychiatry: 'PSY', Anesthesia: 'ANES', Radiology: 'RAD', 'Integrated Approach': 'INTG' };
  const PALETTE = ['#FF9F43', '#7856FF', '#6495ED', '#20C9A6', '#35C8F4', '#FF5B6E', '#F7C948', '#B388FF', '#4DD0A1', '#FF8A65'];
  function defaultSubjects() {
    const keys = Object.keys(SUBJECT_EMOJIS), order = DEF_ORDER.filter(k => keys.indexOf(k) > -1).concat(keys.filter(k => DEF_ORDER.indexOf(k) === -1).sort());
    return order.map((n, i) => ({ name: n, base: n, short: SHORT[n] || n.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase(), color: PALETTE[i % PALETTE.length], order: i + 1, active: true }));
  }
  /** Saved list, plus any built-in subject that is missing from it (so a new app subject never disappears). */
  AK.subjectsAll = function () {
    const saved = Array.isArray(state.akSubjects) && state.akSubjects.length ? state.akSubjects.filter(isObj) : null;
    if (!saved) return defaultSubjects();
    const have = {}; saved.forEach(s => { have[(s.base || s.name)] = 1; have[s.name] = 1; });
    const extra = defaultSubjects().filter(d => !have[d.name]).map((d, i) => Object.assign(d, { order: saved.length + i + 1 }));
    return saved.concat(extra).slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  };
  AK.subjectsActive = () => AK.subjectsAll().filter(s => s.active !== false);
  AK.subject = name => AK.subjectsAll().find(s => s.name === name || s.base === name) || null;
  TRK.subjectList = () => AK.subjectsActive().map(s => s.name);
  TRK.subjectColor = name => { const s = AK.subject(name); return s ? s.color : null; };
  const sColor = name => TRK.subjectColor(name) || C.cyan;

  /* =================================================================== TOPIC LIBRARY + AUTOCOMPLETE */
  const lc = s => String(s || '').toLowerCase().trim();
  /** Every topic known for a subject: syllabus (Topic Library / custom topics), your library, mistakes, planner tasks. */
  AK.topicIndex = function (subject) {
    const sb = AK.subject(subject), names = new Set([subject, sb && sb.base, sb && sb.name].filter(Boolean));
    const map = new Map(), add = (topic, sub, src) => {
      topic = String(topic || '').trim().slice(0, 120); if (!topic) return;
      const k = lc(topic); let e = map.get(k);
      if (!e) { e = { topic: topic, subs: new Set(), src: new Set(), ids: [] }; map.set(k, e); }
      e.src.add(src); if (sub) e.subs.add(String(sub).trim().slice(0, 120));
      return e;
    };
    Object.values(state.masterTopics || {}).forEach(t => { if (t && names.has(t.subject)) add(t.topic, '', t.isCustom ? 'custom' : 'syllabus'); });
    (state.topicLibrary || []).forEach(t => { if (t && names.has(t.subject)) { const e = add(t.topic, t.subtopic, t.src === 'auto' ? 'auto' : 'manual'); if (e) e.ids.push({ id: t.id, sub: t.subtopic || '' }); } });
    (state.errors || []).forEach(m => { if (m && names.has(E.subjKey(m))) add(m.broad, m.subT, 'mistake'); });
    (state.plannerTasks || []).forEach(p => { if (p && names.has(p.subject)) add(p.topic, p.subtopic, 'planner'); });
    return Array.from(map.values()).sort((a, b) => a.topic.localeCompare(b.topic));
  };
  function fillList(id, items) {
    let dl = $(id); if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
    dl.innerHTML = items.slice(0, 1500).map(x => '<option value="' + esc(x) + '">').join('');
  }
  AK.fillLists = function (subject, topic) {
    fillList('akSubjects', AK.subjectsActive().map(s => s.name));
    const idx = subject ? AK.topicIndex(subject) : [];
    fillList('akTopics', idx.map(e => e.topic));
    const t = idx.find(e => lc(e.topic) === lc(topic));
    fillList('akSubtopics', t ? Array.from(t.subs).sort() : Array.from(new Set([].concat.apply([], idx.map(e => Array.from(e.subs))))).sort());
  };
  /** Topics typed in a planner task are remembered automatically. */
  function learnTopic(subject, topic, subtopic) {
    if (!subject || !topic) return;
    if (!Array.isArray(state.topicLibrary)) state.topicLibrary = [];
    const k = lc(subject) + '|' + lc(topic) + '|' + lc(subtopic);
    if (state.topicLibrary.some(t => t && (lc(t.subject) + '|' + lc(t.topic) + '|' + lc(t.subtopic)) === k)) return;
    const known = AK.topicIndex(subject).find(e => lc(e.topic) === lc(topic));
    if (known && (!subtopic || known.subs.has(subtopic))) return;          // already in the syllabus / mistakes
    state.topicLibrary.push({ id: 'TP-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), subject: subject, topic: topic, subtopic: subtopic || '', src: 'auto' });
  }

  /* =================================================================== CLASSIC PLANNER PERIOD */
  /** Classic planner follows the planner period from Settings, widened so a day that already holds data is never hidden. */
  AK.applyPeriod = function () {
    try { if (typeof window.applyPlannerPeriod === 'function') window.applyPlannerPeriod(); } catch (e) { console.warn('[aktrack] period', e); }
  };

  /* =================================================================== COUNTDOWNS */
  function cdHtml(label, date, c, c2) {
    if (!date) return '<div class="t-hero ak-hero" style="--c:' + c + ';--c2:' + c2 + '"><h4><i class="fas fa-hourglass-half" aria-hidden="true"></i>' + esc(label) + '</h4><p class="t-sub" style="margin-top:14px">Exam date not set.</p><button class="btn btn-sm btn-outline t-mt" data-trk="akGoSettings">Set date in Settings</button></div>';
    return '<div class="t-hero ak-hero" style="--c:' + c + ';--c2:' + c2 + '"><h4><i class="fas fa-hourglass-half" aria-hidden="true"></i>' + esc(label) + ' · ' + esc(fmtD(date)) + '</h4><div class="ak-cd" data-akcd="' + esc(date) + '"><div><b>–</b><small>Days</small></div><div><b>–</b><small>Hours</small></div><div><b>–</b><small>Min</small></div><div><b>–</b><small>Sec</small></div></div></div>';
  }
  function tick() {
    document.querySelectorAll('[data-akcd]').forEach(el => {
      const ms = D(el.dataset.akcd) - new Date(), b = el.querySelectorAll('b'); if (b.length < 4) return;
      if (ms <= 0) { b[0].textContent = ms > -86400000 ? 'Today' : 'Done'; b[1].textContent = b[2].textContent = b[3].textContent = '0'; return; }
      const s = Math.floor(ms / 1000);
      b[0].textContent = Math.floor(s / 86400); b[1].textContent = pad(Math.floor(s % 86400 / 3600)); b[2].textContent = pad(Math.floor(s % 3600 / 60)); b[3].textContent = pad(s % 60);
    });
  }
  setInterval(tick, 1000);
  ACT.akGoSettings = () => { TRK.closeModal(); navToPage('settings'); setTimeout(() => { const el = $('akGoals'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120); };

  /* =================================================================== DASHBOARD HEROES */
  const targetsOf = e => ((e && e.targets) || []).map(t => (typeof t === 'string' ? { text: t, done: false } : t));
  /** Tasks + classic planner targets for one day. */
  AK.dayProgress = function (d) {
    const t = E.taskStats(state, d, d, ''), cl = targetsOf(state.planner && state.planner[d]);
    const total = t.total + cl.length, done = t.done + cl.filter(x => x && x.done).length;
    return { total: total, done: done, pct: total ? Math.round(done / total * 100) : 0, tasks: t.total, tasksDone: t.done };
  };
  TRK.taskDay = d => { const t = E.taskStats(state, d, d, ''); return { total: t.total, done: t.done }; };
  function mcqToday(d) {
    let n = 0;
    (state.mcqPractice || []).forEach(m => { if (m && m.date === d) n += Number(m.attempted) || 0; });
    (state.plannerTasks || []).forEach(p => { if (p && p.date === d && p.status !== 'Postponed') n += Number(p.mcqDone) || 0; });
    (state.tests || []).forEach(t => { if (t && t.date === d && t.type === 'Daily') n += Number(t.attempted) || 0; });
    return n;
  }
  AK.renderDashTop = function () {
    const host = $('akDashTop'); if (!host) return;
    const a = AK.cfg(), t = today(), st = E.streaks(state, t), dp = AK.dayProgress(t), g = (state.gamification || {}), mq = mcqToday(t);
    let li = { name: 'Aspirant', pct: 0, toNext: 0, next: null };
    try { li = Gami.levelInfo(g.xp || 0); } catch (e) {}
    const repair = (() => { try { const r = Gami.SHOP.find(x => x.id === 'repair'); return r ? r.cost : 5; } catch (e) { return 5; } })();
    const zs = (state.streak && state.streak.count) || 0;
    host.innerHTML = '<div class="t-grid t-g3 t-mb">' + cdHtml('INICET countdown', a.inicetDate, C.saffron, C.coral) + cdHtml('NEET PG countdown', a.neetpgDate, C.purple, C.blue) +
      '<div class="t-hero ak-hero" style="--c:' + C.coral + ';--c2:' + C.saffron + '"><h4><i class="fas fa-fire" aria-hidden="true"></i>Current study streak</h4><div class="t-row" style="margin-top:10px;align-items:baseline"><b class="ak-big">' + st.study.current + '</b><span class="t-sub">day' + (st.study.current === 1 ? '' : 's') + ' · longest ' + st.study.longest + '</span></div><p class="t-sub">MCQ ' + st.mcq.current + ' · Revision ' + st.revision.current + ' · Test ' + st.test.current + ' · Daily streak ' + zs + '</p></div></div>' +
      '<div class="t-grid t-g3 t-mb"><div class="t-hero ak-hero" style="--c:' + C.teal + ';--c2:' + C.cyan + '"><h4><i class="fas fa-bullseye" aria-hidden="true"></i>Today\'s goal completion</h4><div class="t-row" style="margin-top:10px;flex-wrap:nowrap"><div class="ak-ring" style="--p:' + dp.pct + ';--c:' + C.teal + '"><b>' + dp.pct + '%</b></div><div style="min-width:0"><b class="ak-mid">' + dp.done + ' / ' + dp.total + ' tasks</b><p class="t-sub">Daily goal ' + esc(a.dailyGoalHours) + ' h · MCQs ' + N(mq) + ' / ' + N(a.dailyMcqTarget) + '</p><div class="t-pbar" style="--c:' + C.saffron + ';--c2:' + C.coral + ';margin:6px 0"><i style="width:' + Math.min(100, a.dailyMcqTarget ? mq / a.dailyMcqTarget * 100 : 0) + '%"></i></div><button class="btn btn-sm btn-outline" data-trk="nav" data-page="ak-planner">Open planner</button></div></div></div>' +
      '<div class="t-hero ak-hero" style="--c:' + C.purple + ';--c2:' + C.cyan + '"><h4><i class="fas fa-bolt" aria-hidden="true"></i>Total XP</h4><b class="ak-huge">' + N(g.xp || 0) + '</b><p class="t-sub">' + esc(li.name) + (li.next ? ' · ' + N(li.toNext) + ' XP to ' + esc(li.next.name) : ' · top rank') + '</p><div class="ak-xpbar"><i style="width:' + Math.round(li.pct || 0) + '%"></i></div></div>' +
      '<div class="t-hero ak-hero" style="--c:' + C.gold + ';--c2:' + C.saffron + '"><h4><i class="fas fa-coins" aria-hidden="true"></i>Total coins</h4><b class="ak-huge">' + N(g.coins || 0) + '</b><p class="t-sub">Streak repair costs ' + repair + ' coins</p><button class="btn btn-sm btn-outline" data-trk="nav" data-page="rewards">Rewards &amp; streaks</button></div></div>';
    tick();
  };
  const _renderDash = TRK.renderDash;
  TRK.renderDash = function () { try { AK.renderDashTop(); } catch (e) { console.error('[aktrack] dashboard', e); } return _renderDash.apply(this, arguments); };

  /* upcoming tests page: AKTrack countdown heroes on top */
  AK.renderUpTop = function () {
    const host = $('akUpTop'); if (!host) return;
    const a = AK.cfg(), t = today(), fut = (state.upcomingTests || []).filter(u => u && (u.status || 'Scheduled') === 'Scheduled' && u.date >= t).length;
    host.innerHTML = '<div class="t-grid t-g3 t-mb">' + cdHtml('INICET countdown', a.inicetDate, C.saffron, C.coral) + cdHtml('NEET PG countdown', a.neetpgDate, C.purple, C.blue) +
      '<div class="t-hero ak-hero" style="--c:' + C.gold + '"><h4><i class="fas fa-clock" aria-hidden="true"></i>Scheduled</h4><b class="ak-huge">' + fut + '</b><p class="t-sub">upcoming test' + (fut === 1 ? '' : 's') + '</p></div></div>';
    tick();
  };
  const _rut = window.renderUpcomingTests;
  if (typeof _rut === 'function') window.renderUpcomingTests = function () { const r = _rut.apply(this, arguments); try { AK.renderUpTop(); } catch (e) {} return r; };
  /* ticker: exam countdowns first */
  const _tk = window.updateTicker;
  if (typeof _tk === 'function') window.updateTicker = function () {
    const r = _tk.apply(this, arguments);
    try {
      const tk = $('upcomingTestsTicker'), a = AK.cfg(), t = today(); if (!tk) return r;
      const items = [['INICET', a.inicetDate], ['NEET PG', a.neetpgDate]].filter(x => x[1] && x[1] >= t)
        .map(x => '<span class="ticker-item">🎯 ' + x[0] + ' in <b style="color:var(--orange)">' + dayDiff(t, x[1]) + ' days</b> (' + esc(fmtD(x[1])) + ')</span>');
      if (items.length) tk.insertAdjacentHTML('afterbegin', items.join('<span class="ticker-item" style="opacity:.25;margin:0 10px">|</span>') + '<span class="ticker-item" style="opacity:.25;margin:0 10px">|</span>');
    } catch (e) {}
    return r;
  };

  /* =================================================================== DAILY PLANNER (tasks) */
  const PL_C = { 'High Yield': C.saffron, 'Needs Revision': C.blue, 'Must Revise': C.coral, 'Weak Topic': C.purple, 'Completed': C.teal };
  const ST_C = { 'Not Started': C.blue, 'In Progress': C.saffron, 'Completed': C.teal, 'Postponed': C.lilac };
  const tasks = () => (Array.isArray(state.plannerTasks) ? state.plannerTasks : (state.plannerTasks = []));
  const task = id => tasks().find(p => p && p.id === id);
  const isMissed = p => E.isMissedTask(p, today());
  const newId = () => 'PL-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const rng = (a, b) => E.taskStats(state, a, b, '');
  const pEl = () => $('page-ak-planner');
  /** Commits a pending 'change' before the markup is replaced (avoids a nested re-render while the focused field is removed). */
  function blurIn(root) { const a = document.activeElement; if (a && a !== document.body && root.contains(a)) { try { a.blur(); } catch (e) {} } }

  RENDER['ak-planner'] = function () {
    const el = pEl(); if (!el) return;
    blurIn(el);
    const a = AK.cfg(), pl = S.pl; if (!pl.date || !inPeriod(pl.date)) pl.date = clampDate(today());
    const days = dayDiff(a.plannerStart, a.plannerEnd) + 1, all = rng(a.plannerStart, a.plannerEnd), missed = tasks().filter(isMissed).length;
    AK.fillLists('', '');
    el.innerHTML = '<div class="trk"><div class="t-grid t-g4 t-mb">' + stat('Planner days', days, esc(fmtD(a.plannerStart)) + ' → ' + esc(fmtD(a.plannerEnd)), C.cyan, 'fa-calendar-days') + stat('Tasks planned', N(all.total), 'across the whole period', C.blue, 'fa-list-check') +
      stat('Completed', N(all.done), all.pct + '% of planned tasks', C.teal, 'fa-circle-check') + stat('Missed tasks', N(missed), missed ? 'reschedule them below' : 'nothing overdue', C.coral, 'fa-calendar-xmark') + '</div>' +
      '<div class="glass-card t-mb"><div class="t-row t-between"><div class="t-row">' + [['day', 'Daily cards', 'fa-calendar-day'], ['week', 'Weekly overview', 'fa-calendar-week'], ['month', 'Monthly calendar', 'fa-calendar'], ['list', 'All tasks & search', 'fa-magnifying-glass']]
        .map(v => '<button class="btn btn-sm btn-outline' + (pl.view === v[0] ? ' t-on' : '') + '" data-trk="plView" data-v="' + v[0] + '"><i class="fas ' + v[2] + '" aria-hidden="true"></i> ' + v[1] + '</button>').join('') +
      '</div><div class="t-row"><button class="btn btn-sm btn-outline" data-trk="plPeriod"><i class="fas fa-sliders" aria-hidden="true"></i> Change planner period</button><button class="btn btn-sm btn-outline" data-trk="plExport"><i class="fas fa-download" aria-hidden="true"></i> Export</button><button class="btn btn-sm btn-outline" data-trk="nav" data-page="planner"><i class="fas fa-calendar-check" aria-hidden="true"></i> Classic planner</button><button class="btn btn-sm btn-primary" data-trk="plAdd" data-date="' + pl.date + '"><i class="fas fa-plus" aria-hidden="true"></i> Add task</button></div></div></div><div id="pl-body"></div></div>';
    $('pl-body').innerHTML = ({ day: plDay, week: plWeek, month: plMonth, list: plList })[pl.view] ? ({ day: plDay, week: plWeek, month: plMonth, list: plList })[pl.view]() : plDay();
  };
  const rerender = () => { if (TRK.S.page === 'ak-planner' || (pEl() && pEl().classList.contains('active'))) RENDER['ak-planner'](); };
  AK.rerender = rerender;

  ACT.plPeriod = () => {
    const a = AK.cfg();
    TRK.modal('<i class="fas fa-sliders" aria-hidden="true"></i> Planner period', '<p class="t-sub t-mb">Every date between these two days appears in the planner. Currently ' + (dayDiff(a.plannerStart, a.plannerEnd) + 1) + ' days.</p><div class="t-fgrid">' + fld('Start date', inp('pp-start', a.plannerStart, 'date', 'data-trk-in="ppCount"')) + fld('End date', inp('pp-end', a.plannerEnd, 'date', 'data-trk-in="ppCount"')) + '</div><p class="t-sub t-mt" id="pp-count"></p>' +
      '<p class="t-sub t-mt">Tasks saved outside the new period are kept and reappear if you widen it again. The classic planner follows the same period (days that already hold data stay visible).</p><div class="t-row t-mt" style="justify-content:flex-end"><button class="btn btn-outline" data-trk="closeModal">Cancel</button><button class="btn btn-primary" data-trk="plPeriodSave"><i class="fas fa-check" aria-hidden="true"></i> Save period</button></div>');
    IN.ppCount();
  };
  IN.ppCount = () => { const a = val('pp-start'), b = val('pp-end'), o = $('pp-count'); if (!o) return; o.innerHTML = (E.isDate(a) && E.isDate(b) && a <= b) ? 'New period: <b>' + (dayDiff(a, b) + 1) + ' days</b> (' + esc(fmtD(a)) + ' → ' + esc(fmtD(b)) + ')' + (dayDiff(a, b) > E.AK_LIMITS.periodDays ? ' <span class="badc">at most ' + E.AK_LIMITS.periodDays + ' days</span>' : '') : '<span class="badc">The start date must be on or before the end date.</span>'; };
  ACT.plPeriodSave = () => {
    const cur = AK.cfg(), r = E.validateSettings(Object.assign({}, cur, { plannerStart: val('pp-start'), plannerEnd: val('pp-end') }));
    if (!r.ok) return toast(r.errors.join(' '), 'error');
    saveSettings(r.settings); TRK.closeModal(); S.pl.date = '';
    toast('Planner period updated: ' + (dayDiff(r.settings.plannerStart, r.settings.plannerEnd) + 1) + ' days.'); rerender();
  };
  ACT.plView = d => { S.pl.view = d.v; S.pl.page = 1; RENDER['ak-planner'](); };
  ACT.plGo = d => { if (inPeriod(d.date)) { S.pl.date = d.date; if (d.v) S.pl.view = d.v; RENDER['ak-planner'](); } };
  CH.plDate = el => { if (el.value && inPeriod(el.value)) { S.pl.date = el.value; RENDER['ak-planner'](); } else toast('That date is outside the planner period.', 'warn'); };

  function plNav(prev, next, label, extra) {
    const a = AK.cfg();
    return '<div class="glass-card t-mb"><div class="t-row t-between"><div class="t-row"><button class="t-ib" data-trk="plGo" data-date="' + prev + '" aria-label="Previous"' + (inPeriod(prev) ? '' : ' disabled') + '><i class="fas fa-chevron-left" aria-hidden="true"></i></button><input type="date" class="form-control" style="width:165px" min="' + a.plannerStart + '" max="' + a.plannerEnd + '" value="' + S.pl.date + '" data-trk-ch="plDate" aria-label="Go to date"><button class="t-ib" data-trk="plGo" data-date="' + next + '" aria-label="Next"' + (inPeriod(next) ? '' : ' disabled') + '><i class="fas fa-chevron-right" aria-hidden="true"></i></button>' +
      (inPeriod(today()) ? '<button class="btn btn-sm btn-outline" data-trk="plGo" data-date="' + today() + '">Today</button>' : '') + '</div><h3 class="ak-h3">' + label + '</h3></div>' + (extra || '') + '</div>';
  }
  const progress = (r, label) => '<div style="margin-top:14px"><div class="t-row t-between t-sub"><span>' + label + ' · ' + r.done + ' of ' + r.total + ' tasks</span><b>' + r.pct + '%</b></div><div class="t-pbar" style="margin-top:5px"><i style="width:' + r.pct + '%"></i></div></div>';
  function taskCard(p) {
    const line = (ic, l, v) => (v === '' || v == null) ? '' : '<span class="t-sub"><i class="fas ' + ic + '" aria-hidden="true"></i> ' + l + ': <b>' + esc(v) + '</b></span>';
    const id = esc(p.id);
    return '<div class="ak-task' + (p.status === 'Completed' ? ' done' : '') + '" style="--c:' + (ST_C[p.status] || C.blue) + '"><div class="t-row t-between"><div class="t-row">' + (p.subject ? badge(p.subject, sColor(p.subject)) : '') + (p.priority ? badge(p.priority, PL_C[p.priority]) : '') + (isMissed(p) ? badge('Missed', C.coral) : '') + (p.rescheduledFrom ? badge('Moved from ' + fmtD(p.rescheduledFrom), C.lilac) : '') + '</div>' +
      '<select class="form-control" style="width:150px;padding:6px 8px" data-trk-ch="plStatus" data-id="' + id + '" aria-label="Status">' + opts(E.TASK_STATUS, p.status) + '</select></div>' +
      '<h5>' + esc(p.topic || p.studyTarget || p.subject || 'Task') + (p.subtopic ? ' <span class="t-sub">› ' + esc(p.subtopic) + '</span>' : '') + '</h5>' + (p.topic && p.studyTarget ? '<p class="t-sub">' + esc(p.studyTarget) + '</p>' : '') +
      '<div class="t-row" style="margin-top:8px;gap:14px">' + line('fa-clock', 'Hours', p.hours) + line('fa-bullseye', 'MCQs', p.mcqTarget === '' || p.mcqTarget === undefined ? '' : (p.mcqDone === '' || p.mcqDone === undefined ? 0 : p.mcqDone) + ' / ' + p.mcqTarget) + line('fa-rotate', 'Revision', p.revisionTarget) + line('fa-file-lines', 'Grand Test', p.gtTarget) + '</div>' +
      (p.remarks ? '<p class="t-sub" style="margin-top:6px;white-space:pre-wrap">' + esc(p.remarks) + '</p>' : '') +
      '<div class="t-row" style="margin-top:10px">' + (p.status !== 'Completed' && p.status !== 'Postponed' ? '<button class="btn btn-sm t-t" data-trk="plDone" data-id="' + id + '"><i class="fas fa-check" aria-hidden="true"></i> Mark completed</button>' : '') +
      '<button class="btn btn-sm btn-outline" data-trk="plEdit" data-id="' + id + '"><i class="fas fa-pen" aria-hidden="true"></i> Edit</button>' + (p.status !== 'Postponed' ? '<button class="btn btn-sm btn-outline" data-trk="plMove" data-id="' + id + '"><i class="fas fa-calendar-plus" aria-hidden="true"></i> Reschedule</button>' : '') +
      '<button class="btn btn-sm t-d" data-trk="plDel" data-id="' + id + '" aria-label="Delete task"><i class="fas fa-trash" aria-hidden="true"></i></button></div></div>';
  }
  function classicBox(d) {
    const e = state.planner && state.planner[d], tg = targetsOf(e);
    if (!tg.length && !(e && (e.subject || e.notes))) return '';
    return '<div class="glass-card t-mt"><div class="t-card-h"><h3><i class="fas fa-calendar-check" aria-hidden="true"></i>Classic planner for this day</h3><button class="btn btn-sm btn-outline" data-trk="nav" data-page="planner">Open classic planner</button></div>' +
      (e && e.subject ? '<p class="t-sub">Subject: <b>' + esc(e.subject) + '</b></p>' : '') +
      (tg.length ? tg.map(t => '<div class="t-sub" style="padding:3px 0"><i class="fas ' + (t.done ? 'fa-square-check okc' : 'fa-square') + '" aria-hidden="true"></i> ' + esc(t.text || '') + '</div>').join('') : '') +
      (e && e.notes ? '<p class="t-sub t-mt" style="white-space:pre-wrap">' + esc(e.notes) + '</p>' : '') + '</div>';
  }
  function plDay() {
    const d = S.pl.date, a = AK.cfg(), list = tasks().filter(p => p && p.date === d), r = rng(d, d);
    let strip = '';
    for (let i = -7; i <= 7; i++) {
      const x = addDays(d, i); if (!inPeriod(x)) continue; const q = AK.dayProgress(x);
      strip += '<button class="' + (i === 0 ? 'on' : '') + (x === today() ? ' today' : '') + '" data-trk="plGo" data-date="' + x + '" title="' + esc(fmtD(x)) + '"><small>' + dow(x) + '</small><b>' + D(x).getDate() + '</b><small>' + MON[D(x).getMonth()] + '</small><span class="pd" style="' + (q.total ? 'background:' + (q.done === q.total ? C.teal : q.done ? C.saffron : C.blue) : '') + '"></span></button>';
    }
    return plNav(addDays(d, -1), addDays(d, 1), dow(d) + ', ' + esc(fmtD(d)) + ' · Day ' + (dayDiff(a.plannerStart, d) + 1) + ' of ' + (dayDiff(a.plannerStart, a.plannerEnd) + 1), '<div class="ak-strip t-mt">' + strip + '</div>' + progress(r, 'Daily completion')) +
      (list.length ? '<div class="t-grid t-g2">' + list.map(taskCard).join('') + '</div>' : '<div class="glass-card">' + emptyBox('No tasks planned for ' + fmtD(d) + '.', 'fa-calendar-plus') + '<div style="text-align:center"><button class="btn btn-primary" data-trk="plAdd" data-date="' + d + '"><i class="fas fa-plus" aria-hidden="true"></i> Add a task for this day</button></div></div>') + classicBox(d);
  }
  function plWeek() {
    const d = S.pl.date, ws = addDays(d, -((D(d).getDay() + 6) % 7)), we = addDays(ws, 6), r = rng(ws, we); let h = '';
    for (let i = 0; i < 7; i++) {
      const x = addDays(ws, i), ok = inPeriod(x), t = tasks().filter(p => p && p.date === x), q = rng(x, x);
      h += '<div class="glass-card' + (x === today() ? ' t-acc' : '') + '" style="' + (ok ? 'cursor:pointer' : 'opacity:.35') + '"' + (ok ? ' data-trk="plGo" data-v="day" data-date="' + x + '"' : '') + '><div class="t-row t-between"><b class="ak-mid" style="font-size:15px">' + dow(x) + ' ' + D(x).getDate() + ' ' + MON[D(x).getMonth()] + '</b>' + (ok ? '<div class="t-ring" style="--p:' + q.pct + '"><b>' + q.pct + '%</b></div>' : badge('Outside planner', C.lilac)) + '</div>' +
        (t.length ? t.slice(0, 5).map(p => '<div class="t-sub" style="margin-top:6px"><i class="fas fa-circle" style="font-size:7px;color:' + (ST_C[p.status] || C.blue) + '" aria-hidden="true"></i> ' + esc(p.subject ? p.subject + ': ' : '') + esc(p.topic || p.studyTarget || 'Task') + '</div>').join('') + (t.length > 5 ? '<div class="t-sub">+' + (t.length - 5) + ' more</div>' : '') : '<p class="t-sub" style="margin-top:6px">' + (ok ? 'No tasks' : '') + '</p>') + '</div>';
    }
    return plNav(addDays(d, -7), addDays(d, 7), 'Week of ' + esc(fmtD(ws)) + ' – ' + esc(fmtD(we)), progress(r, 'Weekly completion')) + '<div class="t-grid t-g4">' + h + '</div>';
  }
  function plMonth() {
    const d = S.pl.date, y = D(d).getFullYear(), m = D(d).getMonth(), first = getLocalDateString(new Date(y, m, 1)), last = getLocalDateString(new Date(y, m + 1, 0)), r = rng(first, last);
    const prev = clampDate(getLocalDateString(new Date(y, m, 0))), next = clampDate(getLocalDateString(new Date(y, m + 1, 1)));
    let h = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => '<div class="dow">' + x + '</div>').join('');
    for (let i = 0; i < (D(first).getDay() + 6) % 7; i++) h += '<div></div>';
    for (let x = first; x <= last; x = addDays(x, 1)) {
      const ok = inPeriod(x), q = AK.dayProgress(x), col = q.total ? (q.done === q.total ? C.teal : x < today() ? C.coral : q.done ? C.saffron : C.blue) : '';
      h += '<div class="d' + (ok ? '' : ' out') + (x === today() ? ' today' : '') + (x === d ? ' sel' : '') + '"' + (ok ? ' data-trk="plGo" data-v="day" data-date="' + x + '"' : '') + ' title="' + esc(fmtD(x)) + '"><b>' + D(x).getDate() + '</b>' + (q.total ? '<small>' + q.done + '/' + q.total + ' done</small><div class="t-pbar" style="height:5px;--c:' + col + ';--c2:' + col + '"><i style="width:' + Math.max(8, q.done / q.total * 100) + '%"></i></div>' : '') + '</div>';
    }
    return '<div class="glass-card t-mb"><div class="t-row t-between"><div class="t-row"><button class="t-ib" data-trk="plGo" data-date="' + prev + '" aria-label="Previous month"' + (prev < first ? '' : ' disabled') + '><i class="fas fa-chevron-left" aria-hidden="true"></i></button><button class="t-ib" data-trk="plGo" data-date="' + next + '" aria-label="Next month"' + (next > last ? '' : ' disabled') + '><i class="fas fa-chevron-right" aria-hidden="true"></i></button>' +
      (inPeriod(today()) ? '<button class="btn btn-sm btn-outline" data-trk="plGo" data-date="' + today() + '">Today</button>' : '') + '</div><h3 class="ak-h3">' + MON[m] + ' ' + y + '</h3></div>' + progress(r, 'Monthly completion') + '</div><div class="glass-card"><div class="ak-cal">' + h + '</div><p class="t-sub t-mt">Bars include classic planner targets. ' + badge('All done', C.teal) + ' ' + badge('Partly done', C.saffron) + ' ' + badge('Planned', C.blue) + ' ' + badge('Missed', C.coral) + '</p></div>';
  }
  function plList() {
    const f = S.pl, q = f.q.toLowerCase();
    const list = tasks().filter(p => p && (!q || [p.subject, p.topic, p.subtopic, p.studyTarget, p.revisionTarget, p.gtTarget, p.remarks].join(' ').toLowerCase().indexOf(q) > -1) && (!f.status || p.status === f.status) && (!f.priority || p.priority === f.priority) && (!f.missed || isMissed(p)))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const size = 30, pages = Math.max(1, Math.ceil(list.length / size)); f.page = Math.min(Math.max(1, f.page), pages);
    return '<div class="glass-card t-mb"><div class="t-fgrid">' + fld('Search tasks', '<input class="form-control" data-trk-ch="plSet" data-k="q" placeholder="Subject, topic, target…" value="' + esc(f.q) + '">', 'w2') + fld('Status', '<select class="form-control" data-trk-ch="plSet" data-k="status">' + opts(E.TASK_STATUS, f.status, 'Any status') + '</select>') + fld('Priority tag', '<select class="form-control" data-trk-ch="plSet" data-k="priority">' + opts(E.TASK_TAGS, f.priority, 'Any tag') + '</select>') +
      '<div style="align-self:end"><label class="t-chk"><input type="checkbox" data-trk-ch="plSet" data-k="missed"' + (f.missed ? ' checked' : '') + '> Missed tasks only</label></div></div></div>' +
      (list.length ? '<div class="t-tw"><table class="t-t"><thead><tr><th>Date</th><th>Subject</th><th>Topic / target</th><th>Tag</th><th>Status</th><th class="n">Hours</th><th class="n">MCQs</th><th></th></tr></thead><tbody>' +
        list.slice((f.page - 1) * size, f.page * size).map(p => '<tr><td style="white-space:nowrap"><b>' + dow(p.date) + ', ' + esc(fmtD(p.date)) + '</b></td><td>' + esc(p.subject || '') + '</td><td>' + esc(p.topic || p.studyTarget || p.revisionTarget || p.gtTarget || '') + (p.subtopic ? ' <span class="t-sub">› ' + esc(p.subtopic) + '</span>' : '') + '</td><td>' + (p.priority ? badge(p.priority, PL_C[p.priority]) : '') + '</td><td>' + badge(p.status, ST_C[p.status]) + (isMissed(p) ? ' ' + badge('Missed', C.coral) : '') + '</td><td class="n">' + N(p.hours) + '</td><td class="n">' + (p.mcqTarget === '' || p.mcqTarget === undefined ? '–' : (p.mcqDone || 0) + ' / ' + p.mcqTarget) + '</td>' +
          '<td style="white-space:nowrap">' + (inPeriod(p.date) ? '<button class="btn btn-sm btn-outline" data-trk="plGo" data-v="day" data-date="' + p.date + '">Open day</button> ' : '') + (isMissed(p) ? '<button class="btn btn-sm btn-outline" data-trk="plMove" data-id="' + esc(p.id) + '">Reschedule</button> ' : '') + '<button class="btn btn-sm btn-outline" data-trk="plEdit" data-id="' + esc(p.id) + '" aria-label="Edit task"><i class="fas fa-pen" aria-hidden="true"></i></button></td></tr>').join('') +
        '</tbody></table></div>' + pager(f.page, pages, 'plPage') : '<div class="glass-card">' + emptyBox(tasks().length ? 'No tasks match.' : 'No tasks yet. Add your first task.', 'fa-list-check') + '</div>');
  }
  CH.plSet = el => { S.pl[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); S.pl.page = 1; RENDER['ak-planner'](); };
  ACT.plPage = d => { S.pl.page = +d.p; RENDER['ak-planner'](); };

  function taskModal(p, date) {
    p = p || { date: date, status: 'Not Started' };
    const a = AK.cfg();
    TRK.modal('<i class="fas fa-calendar-check" aria-hidden="true"></i> ' + (p.id ? 'Edit task' : 'Add task'), '<div class="t-fgrid">' + fld('Date', inp('pt-date', p.date, 'date', 'min="' + a.plannerStart + '" max="' + a.plannerEnd + '"')) +
      fld('Subject', '<input class="form-control" id="pt-subject" list="akSubjects" data-trk-in="ptSubj" maxlength="60" autocomplete="off" value="' + esc(p.subject || '') + '">') +
      fld('Topic', '<input class="form-control" id="pt-topic" list="akTopics" data-trk-in="ptSubj" maxlength="120" autocomplete="off" placeholder="Pick from the list or type your own" value="' + esc(p.topic || '') + '">') +
      fld('Subtopic', '<input class="form-control" id="pt-subtopic" list="akSubtopics" maxlength="120" autocomplete="off" value="' + esc(p.subtopic || '') + '">') +
      fld('Study target', inp('pt-studyTarget', p.studyTarget, 'text', 'maxlength="300" placeholder="e.g. Finish videos + notes"'), 'w2') + fld('Expected study hours', inp('pt-hours', p.hours, 'number', 'min="0" max="24" step="0.5"')) + fld('MCQ target', inp('pt-mcqTarget', p.mcqTarget, 'number', 'min="0" step="1"')) + fld('MCQs done', inp('pt-mcqDone', p.mcqDone, 'number', 'min="0" step="1"')) +
      fld('Revision target', inp('pt-revisionTarget', p.revisionTarget, 'text', 'maxlength="300"'), 'w2') + fld('Grand Test target', inp('pt-gtTarget', p.gtTarget, 'text', 'maxlength="200" placeholder="Where applicable"'), 'w2') +
      fld('Priority tag', '<select class="form-control" id="pt-priority">' + opts(E.TASK_TAGS, p.priority, 'None') + '</select>') + fld('Status', '<select class="form-control" id="pt-status">' + opts(E.TASK_STATUS, p.status) + '</select>') +
      fld('Remarks', '<textarea class="form-control" id="pt-remarks" maxlength="1000">' + esc(p.remarks || '') + '</textarea>', 'wf') +
      '</div><div class="t-row t-mt" style="justify-content:flex-end"><button class="btn btn-outline" data-trk="closeModal">Cancel</button><button class="btn btn-primary" data-trk="plSave" data-id="' + esc(p.id || '') + '"><i class="fas fa-check" aria-hidden="true"></i> Save task</button></div>', true);
    IN.ptSubj();
  }
  IN.ptSubj = () => AK.fillLists(val('pt-subject'), val('pt-topic'));
  ACT.plAdd = d => taskModal(null, inPeriod(d.date) ? d.date : (S.pl.date || clampDate(today())));
  ACT.plEdit = d => { const p = task(d.id); if (p) taskModal(p); };

  /** Completion effects: XP once per task, a bonus once per fully completed day. */
  function effects(p) {
    if (!p || p.status !== 'Completed') return;
    if (!isObj(p.xpA)) p.xpA = {};
    try {
      if (!p.xpA.done) { p.xpA.done = 1; Gami.event('target', {}); }
      const day = tasks().filter(x => x && x.date === p.date && x.status !== 'Postponed'), T = E.tracker(state);
      if (!isObj(T.goalDays)) T.goalDays = {};
      if (day.length && day.every(x => x.status === 'Completed') && !T.goalDays[p.date]) { T.goalDays[p.date] = 1; Gami.event('day', {}); toast('Daily goal completed for ' + fmtD(p.date) + '! 🎉'); }
      Gami.refreshChrome();
    } catch (e) { console.warn('[aktrack] xp', e); }
  }
  ACT.plSave = d => {
    const o = {}; ['date', 'subject', 'topic', 'subtopic', 'studyTarget', 'hours', 'mcqTarget', 'mcqDone', 'revisionTarget', 'gtTarget', 'priority', 'status', 'remarks'].forEach(k => o[k] = val('pt-' + k));
    const old = d.id ? task(d.id) : null;
    if (old) { o.id = old.id; o.rescheduledFrom = old.rescheduledFrom; o.xpA = old.xpA; o.created = old.created; }
    const r = E.normTask(o, AK.cfg());
    if (!r.ok) return toast(r.errors.join(' '), 'error');
    const t = r.task; t.updated = new Date().toISOString();
    learnTopic(t.subject, t.topic, t.subtopic);            // before the task itself joins the topic index
    if (old) Object.assign(old, t); else { t.id = newId(); t.created = t.updated; tasks().push(t); }
    effects(old || t); saveData(); TRK.closeModal(); S.pl.date = t.date; toast('Task saved.'); rerender(); refreshAll();
  };
  function patch(id, ch, msg) { const p = task(id); if (!p) return; Object.assign(p, ch, { updated: new Date().toISOString() }); effects(p); saveData(); toast(msg); rerender(); refreshAll(); }
  CH.plStatus = el => patch(el.dataset.id, { status: E.TASK_STATUS.indexOf(el.value) > -1 ? el.value : 'Not Started' }, 'Status updated.');
  ACT.plDone = d => patch(d.id, { status: 'Completed' }, 'Task completed. Well done!');
  ACT.plMove = d => {
    const p = task(d.id); if (!p) return; const a = AK.cfg(), base = today() > p.date ? today() : p.date, nd = addDays(base, 1) <= a.plannerEnd ? addDays(base, 1) : a.plannerEnd;
    TRK.modal('<i class="fas fa-calendar-plus" aria-hidden="true"></i> Reschedule task', '<p class="t-sub t-mb">The task stays on ' + esc(fmtD(p.date)) + ' as "Postponed" and a copy is created on the new date, so your history is preserved.</p>' + fld('New date', inp('pm-date', nd, 'date', 'min="' + a.plannerStart + '" max="' + a.plannerEnd + '"')) +
      '<div class="t-row t-mt" style="justify-content:flex-end"><button class="btn btn-outline" data-trk="closeModal">Cancel</button><button class="btn btn-primary" data-trk="plMoveGo" data-id="' + esc(p.id) + '">Reschedule</button></div>');
  };
  ACT.plMoveGo = d => {
    const p = task(d.id), nd = val('pm-date'); if (!p) return;
    if (!inPeriod(nd)) return toast('Choose a date inside the planner period.', 'error');
    if (nd === p.date) return toast('Choose a different date.', 'error');
    const copy = Object.assign({}, p, { id: newId(), date: nd, status: 'Not Started', rescheduledFrom: p.date, created: new Date().toISOString(), updated: new Date().toISOString() }); delete copy.xpA;
    p.status = 'Postponed'; p.updated = copy.updated; tasks().push(copy);
    saveData(); TRK.closeModal(); toast('Task rescheduled to ' + fmtD(nd) + '.'); rerender(); refreshAll();
  };
  ACT.plDel = async d => {
    if (!(await TRK.confirmBox('Delete this planner task?', 'The task is removed from your planner. XP already earned stays.', 'Delete', true))) return;
    state.plannerTasks = tasks().filter(p => p && p.id !== d.id); saveData(); toast('Task deleted.'); rerender(); refreshAll();
  };
  ACT.plExport = () => {
    const a = AK.cfg();
    TRK.modal('<i class="fas fa-download" aria-hidden="true"></i> Export · Daily planner', '<div class="t-fgrid t-mb">' + fld('From', inp('ex-from', a.plannerStart, 'date')) + fld('To', inp('ex-to', a.plannerEnd, 'date')) + '</div>' +
      '<div class="t-grid t-g3">' + [['pdf', 'PDF', 'fa-file-pdf', C.coral], ['xlsx', 'Excel', 'fa-file-excel', C.teal], ['csv', 'CSV', 'fa-file-csv', C.blue]].map(f => '<button class="btn btn-outline ak-exp" style="--acc:' + f[3] + '" data-trk="plExportGo" data-fmt="' + f[0] + '"><i class="fas ' + f[2] + '" style="font-size:26px;color:' + f[3] + '" aria-hidden="true"></i>' + f[1] + '</button>').join('') + '</div>');
  };
  ACT.plExportGo = async (d, btn) => {
    if (!TRK.WRITE || !TRK.WRITE[d.fmt]) return;
    btn.disabled = true;
    try { const rep = E.report(state, 'planner', { filter: { from: val('ex-from'), to: val('ex-to') } }); await TRK.WRITE[d.fmt](rep); TRK.closeModal(); toast(rep.title + ' exported as ' + d.fmt.toUpperCase() + '.'); }
    catch (e) { toast((e && e.message) || 'Export failed.', 'error'); } finally { btn.disabled = false; }
  };

  /* =================================================================== SETTINGS PAGE */
  function saveSettings(o) {
    state.akSettings = Object.assign({}, AK.cfg(), o);
    const p = state.userProfile && typeof state.userProfile === 'object' ? state.userProfile : null;
    if (p) {
      if (o.userName) p.name = o.userName;
      if (o.dailyGoalHours !== undefined && Number(o.dailyGoalHours) > 0) p.goal = Math.max(1, Math.min(16, Number(o.dailyGoalHours)));
    }
    AK.applyPeriod();
    try { if (typeof setupPlanner === 'function') setupPlanner(); } catch (e) {}
    saveData();
    try { setUserGreeting(); Gami.refreshChrome(); } catch (e) {}
    try { updateTicker(); } catch (e) {}
    Z.bus.emit('profile');
  }
  AK.saveSettings = saveSettings;
  const subRow = (x, i) => '<tr data-base="' + esc(x.base || '') + '"><td><input class="form-control mono" style="max-width:76px" type="number" min="0" max="999" data-sf="order" value="' + esc(x.order == null ? i + 1 : x.order) + '" aria-label="Order"></td>' +
    '<td><input class="form-control" style="min-width:150px" data-sf="name" maxlength="60" value="' + esc(x.name) + '" aria-label="Subject name"></td>' +
    '<td><input class="form-control" style="min-width:80px;max-width:110px;text-transform:uppercase" data-sf="short" maxlength="8" value="' + esc(x.short || '') + '" aria-label="Short name"></td>' +
    '<td><input type="color" data-sf="color" value="' + esc(x.color || '#7856FF') + '" aria-label="Colour" class="ak-color"></td>' +
    '<td><label class="t-chk"><input type="checkbox" data-sf="active"' + (x.active !== false ? ' checked' : '') + '> Active</label></td></tr>';
  function topicBody() {
    const sub = S.topicSub, idx = AK.topicIndex(sub), q = lc(S.topicQ);
    const list = q ? idx.filter(e => lc(e.topic).indexOf(q) > -1 || Array.from(e.subs).some(s => lc(s).indexOf(q) > -1)) : idx;
    const SRC = { syllabus: ['Syllabus', C.blue], custom: ['Custom topic', C.purple], manual: ['Added here', C.teal], auto: ['Auto (planner)', C.saffron], mistake: ['From mistakes', C.coral], planner: ['Planner task', C.gold] };
    if (!list.length) return '<p class="t-sub t-mt">' + (idx.length ? 'No topics match your search.' : 'No topics for this subject yet. Add one above.') + '</p>';
    return '<p class="t-sub t-mt"><b>' + list.length + '</b> topic' + (list.length === 1 ? '' : 's') + ' in the autocomplete for ' + esc(sub) + (q ? ' (filtered)' : '') + '. ' + Object.keys(SRC).map(k => badge(SRC[k][0], SRC[k][1])).join(' ') + '</p>' +
      '<div class="ak-topics">' + list.slice(0, 600).map(e => {
        const src = Array.from(e.src), main = SRC[src[0]] || SRC.manual;
        const subs = Array.from(e.subs);
        return '<div class="ak-topic" style="--c:' + main[1] + '"><div class="t-row t-between" style="flex-wrap:nowrap"><b>' + esc(e.topic) + '</b><span class="t-row" style="gap:4px;flex-wrap:nowrap">' + src.map(s => '<i class="ak-dot" title="' + esc((SRC[s] || SRC.manual)[0]) + '" style="background:' + (SRC[s] || SRC.manual)[1] + '"></i>').join('') +
          (e.ids.length ? e.ids.filter(x => !x.sub).map(x => '<button class="ak-x" data-trk="topicDel" data-id="' + esc(x.id) + '" title="Remove from your library" aria-label="Remove ' + esc(e.topic) + '">&times;</button>').join('') : '') + '</span></div>' +
          (subs.length ? '<div class="ak-subs">' + subs.slice(0, 40).map(s => { const own = e.ids.find(x => x.sub === s); return '<span>' + esc(s) + (own ? ' <button class="ak-x" data-trk="topicDel" data-id="' + esc(own.id) + '" title="Remove" aria-label="Remove ' + esc(s) + '">&times;</button>' : '') + '</span>'; }).join('') + '</div>' : '') + '</div>';
      }).join('') + '</div>' + (list.length > 600 ? '<p class="t-sub">Showing the first 600. Use the search box to narrow down.</p>' : '');
  }
  AK.renderSettings = function () {
    const host = $('akSettingsHost'); if (!host) return;
    blurIn(host);
    const a = AK.cfg(), p = profile(), subs = AK.subjectsAll(), act = AK.subjectsActive();
    if (!S.topicSub || !subs.some(s => s.name === S.topicSub)) S.topicSub = (act[0] || subs[0] || {}).name || '';
    const dark = Z.theme.get() !== 'light', skin = AK.skin.on();
    host.innerHTML = '<div class="trk"><div class="t-grid t-g2 t-mb"><div class="glass-card t-acc" id="akGoals"><div class="t-card-h"><h3><i class="fas fa-user" aria-hidden="true"></i>Account &amp; examination goals</h3></div><div class="t-fgrid">' +
      fld('Your name', inp('st-userName', a.userName || p.name || '', 'text', 'maxlength="60"')) + fld('Target exam (profile)', '<input class="form-control" readonly value="' + esc(p.exam || 'NEET PG') + '">') +
      fld('INICET examination date', inp('st-inicetDate', a.inicetDate, 'date')) + fld('NEET PG examination date', inp('st-neetpgDate', a.neetpgDate, 'date')) +
      fld('Planner start date', inp('st-plannerStart', a.plannerStart, 'date')) + fld('Planner end date', inp('st-plannerEnd', a.plannerEnd, 'date')) +
      fld('Daily study goal (hours)', inp('st-dailyGoalHours', a.dailyGoalHours, 'number', 'min="0" max="24" step="0.5"')) + fld('Daily MCQ target', inp('st-dailyMcqTarget', a.dailyMcqTarget, 'number', 'min="0" max="2000" step="10"')) +
      fld('INICET total questions', inp('st-inicetTotalQ', a.inicetTotalQ, 'number', 'min="1" max="1000"')) + fld('NEET PG total questions', inp('st-neetpgTotalQ', a.neetpgTotalQ, 'number', 'min="1" max="1000"')) +
      '</div><div class="t-row t-mt t-between"><span class="t-sub">Time zone: ' + esc(String(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata').replace('Asia/Calcutta', 'Asia/Kolkata')) + ' · App v' + esc(AK.version) + '</span><button class="btn btn-primary" data-trk="stSave"><i class="fas fa-floppy-disk" aria-hidden="true"></i> Save settings</button></div></div>' +
      '<div class="glass-card t-acc" style="--acc:' + C.teal + '"><div class="t-card-h"><h3><i class="fas fa-shield-halved" aria-hidden="true"></i>Privacy &amp; access</h3></div><p class="t-sub">Your planner, tests, mistakes and settings are saved in one encrypted record for your account and synced to your own Zona Occludens Google Sheet backend. Every value is validated again on the server.</p>' +
      '<ul class="t-sub" style="margin:10px 0 0 18px;line-height:1.9"><li>Exam dates drive the dashboard countdowns and the ticker.</li><li>The planner period controls the Daily Planner and the classic planner.</li><li>Paper sizes are used by the Weightage Predictor.</li></ul>' +
      '<div class="t-sect">Appearance</div><div class="t-row"><button class="btn btn-outline" data-trk="akTheme"><i class="fas fa-circle-half-stroke" aria-hidden="true"></i> Switch to ' + (dark ? 'light' : 'dark') + ' mode</button>' +
      '<button class="btn btn-outline' + (skin ? ' t-on' : '') + '" data-trk="akSkin"><i class="fas fa-palette" aria-hidden="true"></i> AKTrack interface: ' + (skin ? 'On' : 'Off') + '</button></div><p class="t-sub t-mt">All five themes are still available further down under Appearance.</p></div></div>' +
      '<div class="glass-card t-acc t-mb" style="--acc:' + C.lilac + '"><div class="t-card-h"><h3><i class="fas fa-layer-group" aria-hidden="true"></i>Subject list (' + subs.length + ')</h3><div class="t-row"><button class="btn btn-sm btn-outline" data-trk="subAdd"><i class="fas fa-plus" aria-hidden="true"></i> Add subject</button><button class="btn btn-sm btn-primary" data-trk="subSave"><i class="fas fa-floppy-disk" aria-hidden="true"></i> Save subjects</button></div></div>' +
      '<p class="t-sub t-mb">Renaming or hiding a subject never changes old tests or mistakes: they keep the subject name they were saved with. Subjects cannot be deleted, only hidden. Active subjects (in this order) feed the Detailed Test Log, the Mistake Log filters and the Daily Planner.</p>' +
      '<div class="t-tw"><table class="t-t" id="sub-table"><thead><tr><th>Order</th><th>Subject name</th><th>Short name</th><th>Colour</th><th>Active</th></tr></thead><tbody>' + subs.map(subRow).join('') + '</tbody></table></div></div>' +
      '<div class="glass-card t-acc" style="--acc:' + C.cyan + '"><div class="t-card-h"><h3><i class="fas fa-book-open" aria-hidden="true"></i>Topic library</h3><span class="t-sub">Feeds the topic autocomplete. Every syllabus topic is preloaded; topics you type in mistakes and planner tasks are added automatically.</span></div>' +
      '<div class="t-fgrid">' + fld('Subject', '<select class="form-control" id="tp-subject" data-trk-ch="topicSub">' + opts(subs.map(x => [x.name, x.name + (x.active === false ? ' (hidden)' : '')]), S.topicSub) + '</select>') +
      fld('Topic', '<input class="form-control" id="tp-topic" list="akTopics" maxlength="120" autocomplete="off" placeholder="Choose from all topics or type a new one" data-trk-in="tpTopic">') +
      fld('Subtopic (optional)', '<input class="form-control" id="tp-subtopic" list="akSubtopics" maxlength="120" autocomplete="off">') +
      '<div style="align-self:end"><button class="btn btn-primary" data-trk="topicAdd"><i class="fas fa-plus" aria-hidden="true"></i> Add topic</button></div>' +
      fld('Search this subject', '<input class="form-control" id="tp-q" placeholder="Filter topics…" value="' + esc(S.topicQ) + '" data-trk-in="tpSearch">', 'wf') + '</div><div id="tp-body">' + topicBody() + '</div></div></div>';
    AK.fillLists(S.topicSub, '');
  };
  const _setRender = Z.settings.render;
  Z.settings.render = function () { const r = _setRender.apply(this, arguments); try { AK.renderSettings(); } catch (e) { console.error('[aktrack] settings', e); } return r; };

  ACT.stSave = () => {
    const o = {}; ['userName', 'inicetDate', 'neetpgDate', 'plannerStart', 'plannerEnd', 'dailyGoalHours', 'dailyMcqTarget', 'inicetTotalQ', 'neetpgTotalQ'].forEach(k => o[k] = val('st-' + k));
    const r = E.validateSettings(o);
    if (!r.ok) return toast(r.errors.join(' '), 'error');
    saveSettings(r.settings); S.pl.date = ''; toast('Settings saved.');
    AK.renderSettings(); refreshAll();
  };
  ACT.akTheme = () => { const to = Z.theme.get() === 'light' ? 'dark' : 'light'; try { UI.applyTheme(to, true); } catch (e) { Z.theme.set(to, true); } setTimeout(() => AK.renderSettings(), 60); };
  ACT.akSkin = () => { AK.skin.set(!AK.skin.on()); AK.renderSettings(); toast('AKTrack interface ' + (AK.skin.on() ? 'on' : 'off') + '.', 'info'); };
  ACT.subAdd = () => { const tb = document.querySelector('#sub-table tbody'); if (!tb) return; tb.insertAdjacentHTML('beforeend', subRow({ name: '', short: '', color: PALETTE[tb.children.length % PALETTE.length], order: tb.children.length + 1, active: true }, tb.children.length)); const last = tb.lastElementChild.querySelector('[data-sf="name"]'); if (last) last.focus(); };
  ACT.subSave = () => {
    const rows = Array.from(document.querySelectorAll('#sub-table tbody tr')), seen = {}, out = [], errs = [];
    rows.forEach((tr, i) => {
      const g = f => tr.querySelector('[data-sf="' + f + '"]');
      const name = g('name').value.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60), base = tr.dataset.base || '';
      if (!name) { if (base) errs.push('Row ' + (i + 1) + ': a built-in subject needs a name (hide it instead).'); return; }
      if (seen[name.toLowerCase()]) { errs.push('"' + name + '" appears twice.'); return; }
      seen[name.toLowerCase()] = 1;
      const short = g('short').value.replace(/[^A-Za-z0-9&/ -]/g, '').trim().toUpperCase().slice(0, 8);
      out.push({ name: name, base: base || name, short: short || name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase(), color: /^#[0-9a-f]{6}$/i.test(g('color').value) ? g('color').value : '#7856FF', order: (ov => ov === '' || !isFinite(Number(ov)) ? i + 1 : Math.max(0, Math.min(999, Math.round(Number(ov)))))(g('order').value.trim()), active: g('active').checked });
    });
    if (errs.length) return toast(errs.join(' '), 'error');
    if (!out.some(s => s.active)) return toast('Keep at least one subject active.', 'error');
    if (out.length > E.AK_LIMITS.subjects) return toast('At most ' + E.AK_LIMITS.subjects + ' subjects.', 'error');
    state.akSubjects = out.sort((a, b) => a.order - b.order); saveData(); toast('Subject list saved.'); AK.renderSettings();
  };
  CH.topicSub = el => { S.topicSub = el.value; S.topicQ = ''; AK.renderSettings(); };
  IN.tpTopic = () => AK.fillLists(S.topicSub, val('tp-topic'));
  IN.tpSearch = el => { S.topicQ = el.value; const b = $('tp-body'); if (b) b.innerHTML = topicBody(); };
  ACT.topicAdd = () => {
    const subject = S.topicSub, topic = val('tp-topic').replace(/[<>]/g, '').slice(0, 120), subtopic = val('tp-subtopic').replace(/[<>]/g, '').slice(0, 120);
    if (!subject) return toast('Choose a subject.', 'warn');
    if (!topic) return toast('Enter a topic name.', 'warn');
    if (!Array.isArray(state.topicLibrary)) state.topicLibrary = [];
    const k = lc(subject) + '|' + lc(topic) + '|' + lc(subtopic);
    if (state.topicLibrary.some(t => t && (lc(t.subject) + '|' + lc(t.topic) + '|' + lc(t.subtopic)) === k)) return toast('That topic is already in your library.', 'info');
    if (state.topicLibrary.length >= E.AK_LIMITS.topics) return toast('The topic library is full.', 'error');
    state.topicLibrary.push({ id: 'TP-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), subject: subject, topic: topic, subtopic: subtopic, src: 'manual' });
    saveData(); toast('Topic added.'); AK.renderSettings(); const t = $('tp-topic'); if (t) t.focus();
  };
  ACT.topicDel = d => { state.topicLibrary = (state.topicLibrary || []).filter(t => t && t.id !== d.id); saveData(); const b = $('tp-body'); if (b) b.innerHTML = topicBody(); else AK.renderSettings(); };

  /* =================================================================== AKTRACK SKIN + NAV COLOURS + MOBILE BAR */
  AK.skin = {
    on() { return document.documentElement.classList.contains('ak-skin'); },
    set(v) { document.documentElement.classList.toggle('ak-skin', !!v); try { localStorage.setItem('zona-skin', v ? 'aktrack' : 'classic'); } catch (e) {} try { state.settings.skin = v ? 'aktrack' : 'classic'; saveData(); } catch (e) {} try { window.ZonaTracker.rerender(); } catch (e) {} }
  };
  const NAV_C = { dashboard: C.saffron, 'ak-planner': C.cyan, planner: C.blue, 'mcq-practice': C.teal, 'revision-schedule': C.saffron, mednotes: C.teal, guidelines: C.blue, 'subject-progress': C.teal, 'master-tracker': C.lilac,
    'revision-tracker': C.purple, 'add-topic': C.saffron, syllabus: C.cyan, 'upcoming-tests': C.gold, 'test-entry': C.purple, 'test-log': C.saffron, 'test-records': C.blue, 'test-history': C.blue, 'error-log': C.coral,
    'mistake-revision': C.coral, 'upsc-cms-pyts': C.gold, rewards: C.saffron, badges: C.gold, stw: C.cyan, 'test-trends': C.teal, 'subject-analytics': C.lilac, 'test-weightage': C.cyan, reports: C.teal, settings: C.blue };
  function paintNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach((n, i) => { n.style.setProperty('--c', NAV_C[n.dataset.page] || PALETTE[i % PALETTE.length]); });
  }
  const BNAV = [['dashboard', 'fa-chart-pie', 'Home'], ['ak-planner', 'fa-calendar-day', 'Planner'], ['test-log', 'fa-file-pen', 'Log test'], ['mistake-revision', 'fa-rotate', 'Mistakes'], ['settings', 'fa-gear', 'Settings']];
  function bottomBar() {
    if ($('akBnav')) return;
    const nav = document.createElement('nav'); nav.id = 'akBnav'; nav.className = 'ak-bnav'; nav.setAttribute('aria-label', 'Quick navigation');
    nav.innerHTML = BNAV.map(b => '<button type="button" data-page="' + b[0] + '" style="--c:' + (NAV_C[b[0]] || C.saffron) + '"><i class="fas ' + b[1] + '" aria-hidden="true"></i><span>' + b[2] + '</span></button>').join('');
    nav.addEventListener('click', e => { const b = e.target.closest('button[data-page]'); if (b) navToPage(b.dataset.page); });
    document.body.appendChild(nav);
  }
  function markBnav(page) { document.querySelectorAll('#akBnav button').forEach(b => b.classList.toggle('active', b.dataset.page === page)); }
  const _nav = window._navToImpl;
  window._navToImpl = function (pageId) {
    const r = _nav.apply(this, arguments);
    markBnav(pageId);
    if (pageId === 'upcoming-tests') { try { AK.renderUpTop(); } catch (e) {} }
    return r;
  };
  function refreshAll() {
    try { if (isPageActive('dashboard')) AK.renderDashTop(); } catch (e) {}
    try { if (isPageActive('planner') && window.renderPlanner && renderPlanner.now) renderPlanner.now(); } catch (e) {}
  }
  AK.refreshAll = refreshAll;

  /* =================================================================== BOOT */
  Z.bus.on('ready', function () {
    try {
      if (state.settings && state.settings.skin && !localStorage.getItem('zona-skin')) AK.skin.set(state.settings.skin !== 'classic');
    } catch (e) {}
    paintNav(); bottomBar();
    const act = document.querySelector('.page.active'); if (act) markBnav(act.id.replace(/^page-/, ''));
    try { AK.renderUpTop(); updateTicker(); } catch (e) {}
  });
  Z.bus.on('state', () => { try { if (isPageActive('dashboard')) AK.renderDashTop(); } catch (e) {} });
})();
