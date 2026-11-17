/* =====================================================================
   Zona Occludens: Test & Mistake Tracker  (v4, part 2 of 2)
   ---------------------------------------------------------------------
   Dashboard analytics block (10 charts + heatmaps), Test Trends, Subject Analytics,
   test-based Weightage Predictor, PDF / Excel / CSV exports, activity streaks,
   richer Upcoming Tests, and the optional "verify with server" tools.
   Needs zona-tracker-engine.js + zona-tracker.js. Loaded before zona-boot.js.
   ===================================================================== */
(function () {
  'use strict';
  const Z = window.Zona, E = window.ZonaTrackerEngine, TRK = window.ZonaTracker;
  const S = TRK.S, RENDER = TRK.RENDER, ACT = TRK.ACT, CH = TRK.CH, C = TRK.C, TYPE_C = TRK.TYPE_C;
  const { stat, badge, opts, fld, inp, val, emptyBox, fmtD, dow, P, N, MON, today, D, subjects, pad } = TRK;
  const $ = id => document.getElementById(id);
  const pct = E.pct, addDays = E.addDays, dayDiff = E.dayDiff;
  const toast = (m, t) => showToast(m, t || 'success');
  let lastUid = 0;
  const uid = () => { let n = Date.now(); if (n <= lastUid) n = lastUid + 1; lastUid = n; return n; };
  async function busy(btn, fn) {
    if (btn && btn.disabled) return;
    const html = btn && btn.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Working…'; }
    try { return await fn(); } catch (e) { toast((e && e.message) || String(e), 'error'); }
    finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = html; } }
  }

  /* ------------------------------------------------------------- charts (all from saved data) */
  function chart(id, type, labels, datasets, o) {
    const el = $(id); if (!el || !window.Chart) return;
    if (S.charts[id]) { try { S.charts[id].destroy(); } catch (e) {} }
    o = o || {};
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const tc = (getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '').trim() || (light ? '#4D4675' : '#C2BCE3');
    const gc = light ? 'rgba(40,20,120,.10)' : 'rgba(255,255,255,.08)', font = { family: "'Plus Jakarta Sans', sans-serif" };
    const tick = extra => Object.assign({ color: tc, font: font }, extra || {});
    const scales = (type === 'doughnut') ? {} : type === 'radar'
      ? { r: { min: 0, max: 100, ticks: { backdropColor: 'transparent', stepSize: 25, color: tc }, pointLabels: { font: { size: 10 }, color: tc }, grid: { color: gc }, angleLines: { color: gc } } }
      : { x: { grid: { display: false }, stacked: !!o.stacked, ticks: tick({ maxRotation: 50, autoSkip: true }) }, y: { beginAtZero: true, max: o.max, stacked: !!o.stacked, grid: { color: gc }, ticks: tick({ callback: v => v + (o.unit || '') }) } };
    if (o.y2) scales.y2 = { position: 'right', beginAtZero: true, grid: { display: false }, ticks: tick({ precision: 0 }) };
    S.charts[id] = new Chart(el, { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales,
      plugins: { legend: { display: datasets.length > 1 || type === 'doughnut', position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, color: tc, font: font } }, tooltip: { callbacks: o.tip || {} } }, cutout: type === 'doughnut' ? '64%' : undefined } });
  }
  TRK.chart = chart;
  const line = (label, data, c, fill) => ({ label, data, borderColor: c, backgroundColor: c + '33', tension: .35, fill: !!fill, pointRadius: 3, pointBackgroundColor: c, borderWidth: 2.5, spanGaps: true });
  const bar = (label, data, c) => ({ label, data, backgroundColor: c, borderRadius: 6, maxBarThickness: 34 });
  const sLabel = s => s.date.slice(8) + ' ' + MON[+s.date.slice(5, 7) - 1] + ' · ' + (s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name);
  const sTip = a => ({ title: it => { const s = a.series[it[0].dataIndex]; return s.id + ' — ' + s.name; } });
  const short = n => { const w = String(n).split(/\s+/); return w.length > 1 ? w.map(x => x[0]).join('').toUpperCase().slice(0, 4) : String(n).slice(0, 5).toUpperCase(); };
  const DRAW = {
    acc: (id, a) => chart(id, 'line', a.series.map(sLabel), [line('Cumulative accuracy (weighted)', a.series.map(s => s.cumAccuracy), C.saffron, true), line('This test', a.series.map(s => s.accuracy), C.purple)], { max: 100, unit: '%', tip: sTip(a) }),
    ind: (id, a) => chart(id, 'bar', a.series.map(sLabel), [Object.assign(bar('Test accuracy', a.series.map(s => s.accuracy), null), { backgroundColor: a.series.map(s => TYPE_C[s.type] || C.blue) })], { max: 100, unit: '%', tip: sTip(a) }),
    att: (id, a) => chart(id, 'line', a.series.map(sLabel), [line('Attempt %', a.series.map(s => s.attemptPct), C.cyan, true)], { max: 100, unit: '%', tip: sTip(a) }),
    radar: (id, a) => { const s = a.bySubject.filter(x => x.attempted > 0); chart(id, 'radar', s.map(x => short(x.name)), [Object.assign(line('Accuracy %', s.map(x => x.pct.accuracy), C.purple, true), { pointRadius: 2 }), Object.assign(line('Attempt %', s.map(x => x.pct.attempt), C.teal), { pointRadius: 2 })]); },
    dough: (id, a) => chart(id, 'doughnut', ['Correct', 'Incorrect', 'Unattempted'], [{ data: [a.totals.correct, a.totals.incorrect, a.totals.unattempted], backgroundColor: [C.teal, C.coral, C.blue], borderWidth: 0 }]),
    type: (id, a) => { const t = a.byType.filter(x => x.tests > 0); chart(id, 'bar', t.map(x => x.key + ' (' + x.tests + ')'), [bar('Accuracy %', t.map(x => x.pct.accuracy), C.saffron), bar('Attempt %', t.map(x => x.pct.attempt), C.purple)], { max: 100, unit: '%' }); },
    week: (id, a) => chart(id, 'bar', a.weekly.map(w => 'Wk ' + fmtD(w.key).replace(/ \d{4}$/, '')), [bar('Accuracy %', a.weekly.map(w => w.pct.accuracy), C.teal), Object.assign(line('Questions attempted', a.weekly.map(w => w.attempted), C.saffron), { type: 'line', yAxisID: 'y2' })], { max: 100, unit: '%', y2: true }),
    month: (id, a) => chart(id, 'bar', a.monthly.map(m => MON[+m.key.slice(5) - 1] + ' ' + m.key.slice(0, 4)), [bar('Accuracy %', a.monthly.map(m => m.pct.accuracy), C.blue), Object.assign(line('Tests', a.monthly.map(m => m.tests), C.coral), { type: 'line', yAxisID: 'y2' })], { max: 100, unit: '%', y2: true }),
    rev: (id, a) => { const m = a.mistakes; chart(id, 'bar', ['R1', 'R2', 'R3'], [bar('Completed', [m.r1Done, m.r2Done, m.r3Done], C.teal), bar('Pending', [m.r1Pending, m.r2Pending, m.r3Pending], C.saffron), bar('Not yet unlocked', [0, m.total - m.r2Done - m.r2Pending, m.total - m.r3Done - m.r3Pending], C.blue + '66')], { stacked: true }); },
    red: (id, a) => chart(id, 'line', a.series.map(sLabel), [line('Incorrect % of questions', a.series.map(s => s.incorrectPct), C.coral, true), Object.assign(line('Mistakes logged', a.series.map(s => s.mistakes), C.gold), { yAxisID: 'y2' })], { unit: '%', y2: true, tip: sTip(a) })
  };
  const chartCard = (id, title, icon, tall) => '<div class="glass-card"><div class="t-card-h"><h3><i class="fas ' + icon + '" aria-hidden="true"></i>' + title + '</h3></div><div class="t-chart' + (tall ? ' tall' : '') + '"><canvas id="' + id + '"></canvas></div></div>';
  function drawAll(p, a, keys) { if (!a.totals.tests) return; (keys || Object.keys(DRAW)).forEach(k => { try { DRAW[k](p + '-' + k, a); } catch (e) { console.warn('[tracker] chart', k, e); } }); }
  const catShort = c => c.split(/[ -]/).map(w => w[0].toUpperCase()).join('');
  function heatTable(a) {
    const rows = a.bySubject.filter(s => s.mistakes > 0); if (!rows.length) return emptyBox('No mistakes recorded for this selection yet.', 'fa-fire');
    let max = 1; rows.forEach(s => a.categories.forEach(c => { max = Math.max(max, (a.heat[s.subject] || {})[c] || 0); }));
    return '<div class="t-tw"><table class="t-t t-hm"><thead><tr><th>Subject</th>' + a.categories.map(c => '<th title="' + esc(c) + '">' + esc(catShort(c)) + '</th>').join('') + '<th>Total</th></tr></thead><tbody>' +
      rows.map(s => '<tr><td style="text-align:left;white-space:nowrap">' + esc(s.name) + '</td>' + a.categories.map(c => { const n = (a.heat[s.subject] || {})[c] || 0; return '<td title="' + esc(s.name + ' · ' + c + ': ' + n) + '" style="background:rgba(255,91,110,' + (n ? (.15 + .7 * n / max).toFixed(2) : 0) + ')">' + (n || '') + '</td>'; }).join('') + '<td><b>' + s.mistakes + '</b></td></tr>').join('') +
      '</tbody></table></div><p class="t-sub" style="margin-top:8px">' + a.categories.map(c => '<b>' + esc(catShort(c)) + '</b> ' + esc(c)).join(' · ') + '</p>';
  }

  /* ------------------------------------------------------------- shared filter bar */
  function filterBar() {
    const f = S.filt, T = [['ALL', 'All tests'], ['GT', 'GT only'], ['SWT', 'SWT only'], ['Mock', 'Mock only'], ['Daily', 'Daily Practice'], ['Custom', 'Custom']];
    return '<div class="glass-card t-mb"><div class="t-row t-between"><div class="t-row">' + T.map(t => '<button class="btn btn-sm btn-outline' + (f.type === t[0] ? ' t-on' : '') + '" data-trk="setType" data-type="' + t[0] + '">' + t[1] + '</button>').join('') +
      '</div><div class="t-row"><select class="form-control" style="width:150px" data-trk-ch="setFormat" aria-label="Exam format">' + opts(Object.keys(E.FORMATS), f.format === 'ALL' ? '' : f.format, 'All formats') + '</select><span class="t-sub">Date range</span><input type="date" class="form-control" style="width:150px" value="' + esc(f.from) + '" data-trk-ch="setRange" data-k="from" aria-label="From date"><input type="date" class="form-control" style="width:150px" value="' + esc(f.to) + '" data-trk-ch="setRange" data-k="to" aria-label="To date">' +
      (f.from || f.to || f.format !== 'ALL' || f.type !== 'ALL' ? '<button class="btn btn-sm btn-outline" data-trk="clearFilt"><i class="fas fa-xmark" aria-hidden="true"></i> Clear</button>' : '') + '</div></div></div>';
  }
  ACT.setType = d => { S.filt.type = d.type; TRK.rerender(); };
  ACT.clearFilt = () => { S.filt = { type: 'ALL', format: 'ALL', from: '', to: '' }; TRK.rerender(); };
  CH.setRange = el => { S.filt[el.dataset.k] = el.value; TRK.rerender(); };
  CH.setFormat = el => { S.filt.format = el.value || 'ALL'; TRK.rerender(); };
  const AN = () => E.analytics(state, S.filt);

  function perfCards(a) {
    const T = a.totals, M = a.mistakes, mp = n => M.total ? P(pct(n, M.total)) + ' of mistakes' : 'no mistakes yet';
    return '<div class="t-grid t-g6 t-mb">' +
      stat('Total tests', N(T.tests), a.byType.filter(b => b.tests).map(b => b.key + ' ' + b.tests).join(' · ') || 'none logged', C.saffron, 'fa-file-lines') +
      stat('Total questions', N(T.totalQ), T.totalQ ? '100% of pool' : '', C.blue, 'fa-list-ol') +
      stat('Total attempted', N(T.attempted), P(T.pct.attempt) + ' of questions', C.cyan, 'fa-pen') +
      stat('Total correct', N(T.correct), P(T.pct.correct) + ' of questions', C.teal, 'fa-check') +
      stat('Total incorrect', N(T.incorrect), P(T.pct.incorrect) + ' of questions', C.coral, 'fa-xmark') +
      stat('Total unattempted', N(T.unattempted), P(T.pct.unattempted) + ' of questions', C.lilac, 'fa-minus') +
      stat('Overall cumulative accuracy', P(T.pct.accuracy), N(T.correct) + ' correct / ' + N(T.attempted) + ' attempted', C.purple, 'fa-crosshairs') +
      stat('Overall attempt %', P(T.pct.attempt), N(T.attempted) + ' / ' + N(T.totalQ) + ' questions', C.cyan, 'fa-gauge-high') +
      stat('Average test score', P(T.avgScorePct), 'mean of marks % per test', C.gold, 'fa-star') +
      stat('Total mistakes', N(M.total), M.total ? P(pct(M.fullyRevised, M.total)) + ' fully revised' : 'none recorded', C.coral, 'fa-triangle-exclamation') +
      stat('R1 completed', N(M.r1Done), mp(M.r1Done), C.teal, 'fa-1') + stat('R2 completed', N(M.r2Done), mp(M.r2Done), C.blue, 'fa-2') + stat('R3 completed', N(M.r3Done), mp(M.r3Done), C.purple, 'fa-3') +
      stat('Pending revisions', N(M.pending), mp(M.pending), C.saffron, 'fa-hourglass-half') + '</div>';
  }

  /* ------------------------------------------------------------- DASHBOARD block (appended under the existing dashboard) */
  const targetsOf = e => ((e && e.targets) || []).map(t => (typeof t === 'string' ? { text: t, done: false } : t));
  function plannerDay(d) { const t = targetsOf(state.planner && state.planner[d]), k = TRK.taskDay ? TRK.taskDay(d) : { total: 0, done: 0 }; return { total: t.length + k.total, done: t.filter(x => x.done).length + k.done }; }   // v4.1: + planner tasks
  function calendarHeat() {
    const t = today(), first = D(t); first.setDate(1); first.setMonth(first.getMonth() - 2);
    let d = getLocalDateString(first), end = addDays(d, 370), h = '';
    if (typeof APP_PLANNER_START !== 'undefined' && d < APP_PLANNER_START) { d = APP_PLANNER_START; end = addDays(d, 370); }
    if (typeof APP_PLANNER_END !== 'undefined' && end > APP_PLANNER_END) end = APP_PLANNER_END;
    const from = d;
    for (let i = 0; i < D(d).getDay(); i++) h += '<i style="visibility:hidden"></i>';
    while (d <= end) { const p = plannerDay(d), r = p.total ? p.done / p.total : -1;
      h += '<i title="' + esc(fmtD(d)) + (p.total ? ': ' + p.done + '/' + p.total + ' tasks / targets done' : ': nothing planned') + '" style="' + (r < 0 ? '' : r >= 1 ? 'background:' + C.teal : r > 0 ? 'background:rgba(255,159,67,' + (.35 + .55 * r).toFixed(2) + ')' : (d < t ? 'background:rgba(255,91,110,.55)' : 'background:rgba(100,149,237,.45)')) + (d === t ? ';outline:2px solid ' + C.saffron : '') + '"></i>'; d = addDays(d, 1); }
    return '<div class="t-heat">' + h + '</div><p class="t-sub" style="margin-top:8px">' + badge('All done', C.teal) + ' ' + badge('Partly done', C.saffron) + ' ' + badge('Planned', C.blue) + ' ' + badge('Missed', C.coral) + ' &nbsp;Each square is one planner day (' + esc(fmtD(from)) + ' → ' + esc(fmtD(end)) + ').</p>';
  }
  const upStatus = u => u.status || 'Scheduled';
  function upcomingList(n) {
    const t = today(), up = (state.upcomingTests || []).filter(u => u && upStatus(u) === 'Scheduled' && u.date >= t).sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1).slice(0, n);
    return up.length ? up.map(u => '<div class="t-row t-between" style="padding:9px 0;border-bottom:1px solid var(--t-b2)"><div><b style="color:var(--text-main)">' + esc(u.name) + '</b><div class="t-sub">' + esc(u.type) + ' · ' + esc(fmtD(u.date)) + (u.time ? ' · ' + esc(u.time) : '') + '</div></div>' + badge(u.date === t ? 'Today' : dayDiff(t, u.date) + ' days', C.gold) + '</div>').join('') : emptyBox('Nothing scheduled.', 'fa-clock');
  }
  TRK.renderDash = function () {
    const host = $('trkDashHost'); if (!host) return;
    TRK.sync();
    const a = AN(), st = E.streaks(state, today());
    let h = '<hr class="t-divider"><h2 class="t-title"><i class="fas fa-chart-simple" aria-hidden="true"></i> Test performance analytics</h2><p class="t-sub t-mb">Built from every test you log, quick or detailed. Cumulative accuracy is weighted: total correct ÷ total attempted.</p>' + filterBar() + perfCards(a);
    if (!a.totals.tests) h += '<div class="glass-card t-mb">' + emptyBox('No tests match this selection yet. Log your first test to see analytics.', 'fa-chart-line') + '<div style="text-align:center"><button class="btn btn-primary" data-trk="newTest"><i class="fas fa-plus" aria-hidden="true"></i> Log a test</button></div></div>';
    else h += '<div class="t-grid t-g2 t-mb">' + chartCard('d-acc', 'Overall accuracy progression', 'fa-chart-line') + chartCard('d-ind', 'Individual test accuracy', 'fa-chart-column') + chartCard('d-att', 'Attempt percentage', 'fa-chart-area') + chartCard('d-dough', 'Correct vs incorrect', 'fa-chart-pie') +
      chartCard('d-radar', 'Subject-wise performance radar', 'fa-spider', 1) + chartCard('d-type', 'GT vs SWT vs Mock comparison', 'fa-scale-balanced', 1) + chartCard('d-week', 'Weekly performance', 'fa-calendar-week') + chartCard('d-month', 'Monthly performance', 'fa-calendar') +
      chartCard('d-rev', 'R1 / R2 / R3 revision progress', 'fa-rotate') + chartCard('d-red', 'Mistake reduction over time', 'fa-arrow-trend-down') + '</div>';
    h += '<div class="glass-card t-mb"><div class="t-card-h"><h3><i class="fas fa-fire" aria-hidden="true"></i>Subject-wise mistake heatmap</h3><button class="btn btn-sm btn-outline" data-trk="nav" data-page="mistake-revision">Mistake Log &amp; Revision</button></div>' + heatTable(a) + '</div>' +
      '<div class="t-grid t-g2"><div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-calendar-days" aria-hidden="true"></i>Planner calendar heatmap</h3><button class="btn btn-sm btn-outline" data-trk="nav" data-page="ak-planner">Open planner</button></div>' + calendarHeat() + '</div>' +
      '<div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-clock" aria-hidden="true"></i>Upcoming tests</h3><button class="btn btn-sm btn-outline" data-trk="nav" data-page="upcoming-tests">Manage</button></div>' + upcomingList(4) +
      '<div class="t-sect">Activity streaks</div><div class="t-kv"><div><small>Tests</small><b>' + st.test.current + ' d</b></div><div><small>MCQ</small><b>' + st.mcq.current + ' d</b></div><div><small>Revision</small><b>' + st.revision.current + ' d</b></div><div><small>Longest test run</small><b>' + st.test.longest + ' d</b></div></div></div></div>';
    host.innerHTML = h;
    drawAll('d', a);
  };

  /* ------------------------------------------------------------- TEST TRENDS */
  RENDER['test-trends'] = function () {
    const el = $('page-test-trends'), a = AN(), T = a.totals;
    if (!T.tests) { el.innerHTML = '<div class="trk">' + filterBar() + '<div class="glass-card">' + emptyBox('No tests match this selection.', 'fa-chart-line') + '<div style="text-align:center"><button class="btn btn-primary" data-trk="newTest"><i class="fas fa-plus" aria-hidden="true"></i> Log a test</button></div></div></div>'; return; }
    el.innerHTML = '<div class="trk">' + filterBar() + '<div class="t-grid t-g4 t-mb">' + stat('Tests', N(T.tests), 'in this selection', C.saffron, 'fa-file-lines') + stat('Cumulative accuracy', P(T.pct.accuracy), N(T.correct) + ' / ' + N(T.attempted) + ' (weighted)', C.purple, 'fa-crosshairs') + stat('Attempt %', P(T.pct.attempt), N(T.attempted) + ' / ' + N(T.totalQ), C.cyan, 'fa-gauge-high') + stat('Average test score', P(T.avgScorePct), 'mean marks %', C.gold, 'fa-star') + '</div>' +
      '<div class="t-grid t-g2 t-mb">' + chartCard('t-acc', 'Overall accuracy progression', 'fa-chart-line', 1) + chartCard('t-ind', 'Individual test accuracy', 'fa-chart-column', 1) + chartCard('t-att', 'Attempt percentage', 'fa-chart-area') + chartCard('t-type', 'GT vs SWT vs Mock comparison', 'fa-scale-balanced') + chartCard('t-week', 'Weekly performance', 'fa-calendar-week') + chartCard('t-month', 'Monthly performance', 'fa-calendar') + chartCard('t-red', 'Mistake reduction over time', 'fa-arrow-trend-down') + chartCard('t-dough', 'Correct vs incorrect', 'fa-chart-pie') + '</div>' +
      '<div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-table" aria-hidden="true"></i>Test-by-test</h3><div class="t-row"><span class="t-sub">Each row is that test\'s own accuracy. The last column is the running weighted total.</span><button class="btn btn-sm btn-outline" data-trk="exportMenu" data-kind="overall"><i class="fas fa-download" aria-hidden="true"></i> Export</button></div></div><div class="t-tw"><table class="t-t"><thead><tr><th>Test ID</th><th>Name</th><th>Date</th><th>Type</th><th>Format</th><th class="n">Attempted</th><th class="n">Correct</th><th class="n">Test accuracy</th><th class="n">Attempt %</th><th class="n">Marks</th><th class="n">Cumulative accuracy</th><th class="n">Mistakes</th></tr></thead><tbody>' +
      a.series.slice().reverse().map(s => '<tr class="t-click" data-trk="openTest" data-id="' + esc(s.id) + '"><td><b>' + esc(s.id) + '</b></td><td>' + esc(s.name) + '</td><td>' + esc(fmtD(s.date)) + '</td><td>' + badge(s.type || 'Test', TYPE_C[s.type]) + '</td><td>' + esc(s.format || '') + '</td><td class="n">' + s.attempted + ' / ' + s.totalQ + '</td><td class="n">' + s.correct + '</td><td class="n"><b>' + P(s.accuracy) + '</b></td><td class="n">' + P(s.attemptPct) + '</td><td class="n">' + (s.score == null || s.score === '' ? '–' : esc(s.score) + ' / ' + esc(s.max)) + '</td><td class="n">' + P(s.cumAccuracy) + '</td><td class="n">' + s.mistakes + '</td></tr>').join('') + '</tbody></table></div></div></div>';
    drawAll('t', a, ['acc', 'ind', 'att', 'type', 'week', 'month', 'red', 'dough']);
  };

  /* ------------------------------------------------------------- SUBJECT ANALYTICS */
  RENDER['subject-analytics'] = function () {
    const el = $('page-subject-analytics'), a = AN(), rows = a.bySubject;
    if (!rows.length) { el.innerHTML = '<div class="trk">' + filterBar() + '<div class="glass-card">' + emptyBox('No subject-wise data for this selection. Add subject rows when you log a test in the Detailed Test Log.', 'fa-layer-group') + '<div style="text-align:center"><button class="btn btn-primary" data-trk="newTest"><i class="fas fa-plus" aria-hidden="true"></i> Log a test</button></div></div></div>'; return; }
    const withQ = rows.filter(r => r.attempted > 0), best = withQ.slice().sort((x, y) => y.pct.accuracy - x.pct.accuracy)[0], worst = withQ.slice().sort((x, y) => x.pct.accuracy - y.pct.accuracy)[0];
    el.innerHTML = '<div class="trk">' + filterBar() + '<div class="t-grid t-g4 t-mb">' + stat('Subjects with data', rows.length, 'of ' + subjects().length + ' subjects', C.lilac, 'fa-layer-group') + stat('Strongest', best ? esc(best.name) : '–', best ? P(best.pct.accuracy) + ' accuracy' : '', C.teal, 'fa-arrow-up') + stat('Weakest', worst ? esc(worst.name) : '–', worst ? P(worst.pct.accuracy) + ' accuracy' : '', C.coral, 'fa-arrow-down') + stat('Mistakes logged', N(a.mistakes.total), N(a.mistakes.pending) + ' pending revision', C.saffron, 'fa-triangle-exclamation') + '</div>' +
      '<div class="t-grid t-g2 t-mb">' + chartCard('s-radar', 'Subject-wise performance radar', 'fa-spider', 1) + chartCard('s-bar', 'Accuracy by subject', 'fa-chart-column', 1) + '</div>' +
      '<div class="glass-card t-mb"><div class="t-card-h"><h3><i class="fas fa-table" aria-hidden="true"></i>All subjects</h3><button class="btn btn-sm btn-outline" data-trk="exportMenu" data-kind="subjects"><i class="fas fa-download" aria-hidden="true"></i> Export</button></div><div class="t-tw"><table class="t-t"><thead><tr><th>Subject</th><th class="n">Tests</th><th class="n">Total</th><th class="n">Attempted</th><th class="n">Correct</th><th class="n">Incorrect</th><th class="n">Unatt.</th><th class="n">Attempt %</th><th class="n">Accuracy</th><th class="n">Mistakes</th><th class="n">Fully revised</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td><b>' + esc(r.name) + '</b></td><td class="n">' + r.tests + '</td><td class="n">' + r.totalQ + '</td><td class="n">' + r.attempted + '</td><td class="n okc">' + r.correct + '</td><td class="n badc">' + r.incorrect + '</td><td class="n">' + r.unattempted + '</td><td class="n">' + P(r.pct.attempt) + '</td><td class="n"><b>' + P(r.pct.accuracy) + '</b></td><td class="n">' + r.mistakes + '</td><td class="n">' + r.revised + '</td></tr>').join('') + '</tbody></table></div></div>' +
      '<div class="t-grid t-g2"><div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-fire" aria-hidden="true"></i>Subject-wise mistake heatmap</h3></div>' + heatTable(a) + '</div><div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-ranking-star" aria-hidden="true"></i>Frequently missed topics</h3></div>' +
      (a.topTopics.length ? '<div class="t-tw"><table class="t-t"><thead><tr><th>Topic</th><th>Subject</th><th class="n">Mistakes</th></tr></thead><tbody>' + a.topTopics.map(t => '<tr><td><b>' + esc(t.topic) + '</b></td><td>' + esc(t.subject) + '</td><td class="n">' + t.count + '</td></tr>').join('') + '</tbody></table></div>' : emptyBox('No topics recorded in mistakes yet.', 'fa-ranking-star')) + '</div></div></div>';
    if (withQ.length) { DRAW.radar('s-radar', a); chart('s-bar', 'bar', withQ.map(x => short(x.name)), [bar('Accuracy %', withQ.map(x => x.pct.accuracy), C.purple), bar('Attempt %', withQ.map(x => x.pct.attempt), C.teal)], { max: 100, unit: '%' }); }
  };

  /* ------------------------------------------------------------- WEIGHTAGE PREDICTOR (from your own tests) */
  RENDER['test-weightage'] = function () {
    const el = $('page-test-weightage'), exams = Object.keys(EXAM_WEIGHTAGES);
    if (exams.indexOf(S.wx) === -1) S.wx = exams[0];
    const bp0 = EXAM_WEIGHTAGES[S.wx], tq = TRK.examTotal ? TRK.examTotal(S.wx) : null;            // v4.1: paper size from Settings
    const bp = tq ? Object.assign({}, bp0, { max: tq }) : bp0, w = E.weightage(state, S.wx, bp, Object.keys(bp.subjects)), rows = w.rows;
    const tabs = '<div class="glass-card t-mb"><div class="t-row t-between"><div class="t-row">' + exams.map(x => '<button class="btn btn-outline' + (S.wx === x ? ' t-on' : '') + '" data-trk="wxSet" data-x="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div><span class="t-sub">No official subject-wise weightage is published. The blueprint is the app\'s editable estimate; you can type your own figures, and estimates come only from your own logged tests.</span></div></div>';
    const anyManual = rows.some(r => r.manual !== ''), manualSum = rows.reduce((s, r) => s + (r.manual === '' ? 0 : r.manual), 0);
    const wt = r => r.manual !== '' ? r.manual : (r.estimated != null && w.basisTests > 0 ? r.estimated : (r.blueprint === '' ? null : r.blueprint));
    const ranked = rows.filter(r => wt(r) != null && wt(r) > 0).sort((x, y) => wt(y) - wt(x)), hy = {}; ranked.slice(0, 6).forEach(r => hy[r.subject] = 1);
    let exp = 0, expBase = 0; rows.forEach(r => { if (wt(r) != null && r.accuracy != null) { exp += wt(r) * r.accuracy / 100; expBase += wt(r); } });
    const weak = rows.filter(r => r.attempted >= 10 && r.accuracy != null).sort((x, y) => x.accuracy - y.accuracy).slice(0, 5);
    el.innerHTML = '<div class="trk">' + tabs + '<div class="t-grid t-g4 t-mb">' + stat(esc(w.exam) + ' questions', N(w.examTotal), 'paper size used for estimates', C.cyan, 'fa-list-ol') + stat('Your manual weightage', anyManual ? N(manualSum) + ' Q' : 'None', anyManual ? (manualSum === w.examTotal ? 'matches the paper size' : 'paper size is ' + w.examTotal) : 'type it into the table below', C.saffron, 'fa-keyboard') +
      stat('Estimate basis', w.basisTests + ' test' + (w.basisTests === 1 ? '' : 's'), 'your ' + esc(w.format) + ' GTs / mocks with a complete subject breakdown', C.purple, 'fa-flask') + stat('Projected correct', expBase ? N(Math.round(exp)) + ' / ' + N(Math.round(expBase)) : '–', expBase ? 'weightage × your test accuracy (estimate)' : 'needs subject-wise test data', C.teal, 'fa-bullseye') + '</div>' +
      '<div class="glass-card t-mb"><div class="t-card-h"><h3><i class="fas fa-scale-balanced" aria-hidden="true"></i>Subject-wise expected question distribution · ' + esc(w.exam) + '</h3><div class="t-row">' + badge('Blueprint estimate', C.blue) + badge('Typed by you', C.saffron) + badge('Estimated from your tests', C.purple) + '<button class="btn btn-sm btn-primary" data-trk="wxSave"><i class="fas fa-floppy-disk" aria-hidden="true"></i> Save my weightage</button></div></div>' +
      '<div class="t-tw"><table class="t-t"><thead><tr><th>Subject</th><th class="n">Blueprint</th><th>My weightage (questions)</th><th class="n">Estimated questions</th><th class="n">Test accuracy</th><th class="n">Projected correct</th><th class="n">Mistakes</th><th>Flags</th></tr></thead><tbody>' +
      rows.map(r => { const x = wt(r); return '<tr><td><b>' + esc(r.subject) + '</b></td><td class="n">' + (r.blueprint === '' ? '–' : r.blueprint) + '</td><td><input class="form-control mono" style="max-width:120px" type="number" min="0" step="0.5" data-wx="' + esc(r.subject) + '" value="' + esc(r.manual) + '" placeholder="not entered" aria-label="My weightage for ' + esc(r.subject) + '"></td><td class="n">' + (r.estimated == null ? '<span class="t-sub">no data</span>' : r.estimated) + '</td><td class="n"><b>' + P(r.accuracy) + '</b></td><td class="n">' + (x != null && r.accuracy != null ? Math.round(x * r.accuracy) / 100 : '–') + '</td><td class="n">' + r.mistakes + '</td><td>' + (hy[r.subject] ? badge('High yield', C.saffron) + ' ' : '') + (weak.some(k => k.subject === r.subject) ? badge('Weak area', C.coral) : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="t-sub t-mt">Projected correct uses your own figure when present, otherwise the estimate from your tests, otherwise the blueprint. High yield = the six largest subjects by that figure. ' + (w.basisTests ? '' : 'No estimate yet: log ' + esc(w.format) + ' Grand / Mock tests with a complete subject breakdown.') + ' The Dashboard predictor (based on your Subject Progress sliders) is unchanged.</p></div>' +
      '<div class="t-grid t-g2">' + (ranked.length ? chartCard('w-bar', 'Weightage vs your accuracy', 'fa-chart-column', 1) : '<div class="glass-card">' + emptyBox('Log tests with subject breakdowns to see this chart.', 'fa-chart-column') + '</div>') +
      '<div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-heart-crack" aria-hidden="true"></i>Weak areas</h3></div>' + (weak.length ? weak.map(r => '<div style="padding:8px 0"><div class="t-row t-between"><b style="color:var(--text-main)">' + esc(r.subject) + '</b><span>' + P(r.accuracy) + '</span></div><div class="t-pbar" style="--c:' + C.coral + ';--c2:' + C.saffron + ';margin-top:5px"><i style="width:' + r.accuracy + '%"></i></div></div>').join('') : emptyBox('Needs at least 10 attempted questions in a subject.', 'fa-heart-crack')) +
      '<div class="t-sect">Frequently missed topics</div>' + (w.topTopics.length ? w.topTopics.slice(0, 10).map(t => '<div class="t-row t-between" style="padding:5px 0"><span><b style="color:var(--text-main)">' + esc(t.topic) + '</b> <span class="t-sub">' + esc(t.subject) + '</span></span>' + badge(t.count + ' mistake' + (t.count > 1 ? 's' : ''), C.coral) + '</div>').join('') : '<p class="t-sub">No mistake topics recorded yet.</p>') + '</div></div></div>';
    if (ranked.length) chart('w-bar', 'bar', ranked.map(r => short(r.subject)), [bar('Blueprint (Q)', ranked.map(r => r.blueprint === '' ? null : r.blueprint), C.blue), bar('My weightage (Q)', ranked.map(r => r.manual === '' ? null : r.manual), C.saffron), bar('Estimated from my tests (Q)', ranked.map(r => r.estimated), C.purple), Object.assign(line('My accuracy %', ranked.map(r => r.accuracy), C.teal), { type: 'line', yAxisID: 'y2' })], { y2: true });
  };
  ACT.wxSet = d => { S.wx = d.x; TRK.leave(); TRK.render('test-weightage'); };
  ACT.wxSave = () => {
    const out = {}; let bad = false;
    document.querySelectorAll('#page-test-weightage [data-wx]').forEach(i => { const v = i.value.trim(); if (v === '') return; const n = Number(v); if (!isFinite(n) || n < 0 || n > 1000) bad = true; else out[i.dataset.wx] = n; });
    if (bad) return toast('Weightage must be a number between 0 and 1000.', 'error');
    E.tracker(state).weights[S.wx] = out; saveData(); toast('Your weightage for ' + S.wx + ' was saved.'); TRK.leave(); TRK.render('test-weightage');
  };

  /* ------------------------------------------------------------- activity streaks + XP rules (shown under Quests & Rewards) */
  const STREAK_META = { study: ['Combined activity streak', 'fa-fire', C.coral, 'Any test, MCQ session or completed revision'], mcq: ['MCQ streak', 'fa-bullseye', C.teal, 'Daily MCQ practice (MCQ Practice page or a Daily test)'], revision: ['Revision streak', 'fa-rotate', C.purple, 'At least one R1 / R2 / R3 completed'], test: ['Test completion streak', 'fa-file-lines', C.saffron, 'A GT, SWT, mock or custom test logged'] };
  TRK.renderRewardsExtra = function () {
    const host = $('trkRewardsHost'); if (!host) return;
    const st = E.streaks(state, today()), t = today(), R = E.REWARDS;
    const card = k => { const s = st[k], m = STREAK_META[k], set = new Set(s.dates); let dots = ''; for (let i = 29; i >= 0; i--) { const d = addDays(t, -i); dots += '<i title="' + esc(fmtD(d)) + '" style="' + (set.has(d) ? 'background:' + m[2] + ';border-color:' + m[2] : '') + '"></i>'; }
      return '<div class="glass-card t-acc" style="--acc:' + m[2] + '"><div class="t-card-h"><h3><i class="fas ' + m[1] + '" aria-hidden="true"></i>' + m[0] + '</h3></div><div class="t-row" style="align-items:baseline"><b style="font-family:var(--font-head);font-size:42px;line-height:1;color:var(--text-main)">' + s.current + '</b><span class="t-sub">current · longest <b>' + s.longest + '</b> · ' + s.total + ' active days</span></div><p class="t-sub">' + m[3] + '</p><div class="t-heat row1" style="margin-top:10px">' + dots + '</div><p class="t-sub">Last 30 days' + (s.last ? ' · last active ' + esc(fmtD(s.last)) : '') + '</p></div>'; };
    host.innerHTML = '<hr class="t-divider"><h2 class="t-title"><i class="fas fa-fire" aria-hidden="true"></i> Activity streaks</h2><p class="t-sub t-mb">Worked out from your saved tests, MCQ sessions and revisions, so they can never be counted twice. Your main daily streak, freezes and repair cards above are unchanged.</p>' +
      '<div class="t-grid t-g2 t-mb">' + Object.keys(STREAK_META).map(card).join('') + '</div>' +
      '<div class="glass-card"><div class="t-card-h"><h3><i class="fas fa-bolt" aria-hidden="true"></i>Test &amp; revision XP</h3></div><div class="t-tw"><table class="t-t"><thead><tr><th>Event</th><th class="n">XP</th></tr></thead><tbody>' +
      [['Test logged (Grand Test)', '200'], ['Test logged (other types)', '100'], ['Test analysis completed', R.analysis], ['Mistake recorded', R.mistake], ['R1 completed', R.r1], ['R2 completed', R.r2], ['R3 completed', R.r3]].map(r => '<tr><td>' + r[0] + '</td><td class="n okc"><b>+' + r[1] + '</b></td></tr>').join('') +
      '</tbody></table></div><p class="t-sub t-mt">Each reward is paid once per item, so re-saving a test or reopening a revision can never pay twice. XP boosts from the shop still apply.</p></div>';
  };

  /* ------------------------------------------------------------- UPCOMING TESTS (adds time, provider, subjects, priority, status, "Log this test") */
  const UP_TYPE_C = { GT: C.saffron, Mock: C.purple, SWT: C.blue, Daily: C.teal, Custom: C.cyan }, PRIO_C = { High: C.coral, Medium: C.saffron, Low: C.blue };
  window.addUpcomingTest = function () {
    const date = val('up-date'), name = val('up-name').slice(0, 120), type = val('up-type') || 'GT';
    if (!name) return showToast('Test name required!', 'error');
    if (!ISO_DATE_RE.test(date)) return showToast('Pick a valid date.', 'error');
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(val('up-time')) ? val('up-time') : '';
    state.upcomingTests.push({ id: uid(), date, name, type, time, provider: val('up-provider').slice(0, 80), subjects: val('up-subjects').slice(0, 400), priority: E.PRIORITIES.indexOf(val('up-priority')) > -1 ? val('up-priority') : 'Medium', status: 'Scheduled' });
    saveData();
    ['up-name', 'up-time', 'up-provider', 'up-subjects'].forEach(id => { if ($(id)) $(id).value = ''; });
    updateTicker(); renderUpcomingTests(); showToast('Upcoming Test Scheduled! 📅');
  };
  window.renderUpcomingTests = function () {
    const tb = document.querySelector('#upcomingRecordsTable tbody'); if (!tb) return;
    const t = today(), sorted = [...(state.upcomingTests || [])].filter(Boolean).sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1);
    setHTML(tb, sorted.map(u => { const stt = upStatus(u), dd = dayDiff(t, u.date), c = stt === 'Scheduled' ? (dd < 0 ? C.coral : C.gold) : stt === 'Completed' ? C.teal : C.lilac, id = Number(u.id) || 0;
      return '<tr class="trk"><td>' + esc(u.date) + (u.time ? '<br><span class="t-sub">' + esc(u.time) + '</span>' : '') + '</td>' +
        '<td style="font-weight:700; white-space:normal; min-width:160px;">' + esc(u.name) + ((u.provider || u.subjects) ? '<br><span class="t-sub">' + esc([u.provider, u.subjects].filter(Boolean).join(' · ')) + '</span>' : '') + '</td>' +
        '<td>' + badge(u.type || 'Test', UP_TYPE_C[u.type]) + '</td><td>' + badge(u.priority || 'Medium', PRIO_C[u.priority || 'Medium']) + '</td>' +
        '<td>' + badge(stt === 'Scheduled' ? (dd === 0 ? 'Today' : dd > 0 ? 'In ' + dd + ' day' + (dd > 1 ? 's' : '') : 'Date passed') : stt, c) + '</td>' +
        '<td><div class="t-row" style="flex-wrap:nowrap"><button class="btn btn-sm btn-primary" data-trk="upLog" data-id="' + id + '" title="Open the Detailed Test Log with this test filled in"><i class="fas fa-pen-to-square" aria-hidden="true"></i> Log</button>' +
        (stt === 'Scheduled' ? '<button class="btn btn-sm t-t" data-trk="upStatus" data-id="' + id + '" data-s="Completed" title="Mark as done" aria-label="Mark as done"><i class="fas fa-check" aria-hidden="true"></i></button><button class="btn btn-sm btn-outline" data-trk="upStatus" data-id="' + id + '" data-s="Cancelled" title="Cancel" aria-label="Cancel"><i class="fas fa-ban" aria-hidden="true"></i></button>'
          : '<button class="btn btn-sm btn-outline" data-trk="upStatus" data-id="' + id + '" data-s="Scheduled" title="Schedule again" aria-label="Schedule again"><i class="fas fa-rotate-left" aria-hidden="true"></i></button>') +
        '<button class="btn-outline btn-sm" style="color:var(--red); border-color:rgba(239,68,68,0.3);" onclick="deleteUpcomingTest(' + id + ')" aria-label="Delete scheduled test"><i class="fas fa-trash" aria-hidden="true"></i></button></div></td></tr>'; }).join('')
      || '<tr><td colspan="6">' + emptyState('clock', 'No upcoming tests', 'Schedule a mock or GT and it will scroll across the ticker.', true) + '</td></tr>');
  };
  const upc = id => (state.upcomingTests || []).find(u => u && Number(u.id) === Number(id));
  ACT.upStatus = d => { const u = upc(d.id); if (!u) return; u.status = E.UPCOMING_STATUS.indexOf(d.s) > -1 ? d.s : 'Scheduled'; saveData(); updateTicker(); renderUpcomingTests(); toast('Marked as ' + u.status.toLowerCase() + '.'); };
  ACT.upLog = d => { const u = upc(d.id); if (!u) return; const exam = (state.userProfile && state.userProfile.exam) || '', fmt = Object.keys(E.FORMATS).find(k => exam.toUpperCase().indexOf(k.toUpperCase()) > -1) || 'NEET PG', f = E.FORMATS[fmt];
    TRK.newTest({ name: u.name, type: E.TEST_TYPES[u.type] ? u.type : 'Custom', date: u.date, provider: u.provider || '', startTime: u.time || '', format: fmt, marksPerQuestion: f.mpq, negativeMarking: f.neg, subjectsIncluded: u.subjects || '' }); TRK.go('test-log'); };
  /* ticker: only tests that are still scheduled, with a day count */
  const _ticker = window.updateTicker;
  window.updateTicker = function () {
    const ticker = $('upcomingTestsTicker'); if (!ticker) return;
    const t = today(), sorted = (state.upcomingTests || []).filter(u => u && upStatus(u) === 'Scheduled' && u.date >= t).sort((a, b) => a.date < b.date ? -1 : 1);
    if (!sorted.length) { try { const keep = state.upcomingTests; state.upcomingTests = []; _ticker(); state.upcomingTests = keep; } catch (e) {} return; }
    ticker.innerHTML = sorted.map(u => { const color = u.type === 'Mock' ? 'var(--pink)' : u.type === 'SWT' ? 'var(--purple)' : 'var(--orange)', dd = dayDiff(t, u.date);
      return '<span class="ticker-item">🚨 <span style="color:' + color + '; border:1px solid ' + color + '; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-right:4px;">' + esc(u.type) + '</span> ' + esc(u.name) + ' (' + esc(u.date) + (u.time ? ' ' + esc(u.time) : '') + ' · ' + (dd === 0 ? 'today' : dd + ' d') + ')</span>'; })
      .join('<span class="ticker-item" style="color:rgba(255,255,255,0.2); margin-left:10px; margin-right:10px;">|</span>');
  };

  /* ------------------------------------------------------------- EXPORT (PDF / Excel / CSV) */
  const libs = {};
  function loadScript(url) { return libs[url] || (libs[url] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => { delete libs[url]; rej({ message: 'Could not load the export library. Check your connection and retry (CSV works offline).' }); }; document.head.appendChild(s); })); }
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  const fileName = (t, ext) => t.replace(/[^A-Za-z0-9._-]+/g, '_') + '_' + today() + '.' + ext;
  const WRITE = TRK.WRITE = {
    csv(rep) { const q = v => { let s = String(v == null ? '' : v); if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && isNaN(Number(s)))) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }; const out = [q(rep.title), q(rep.subtitle || ''), ''];
      rep.sections.forEach(s => { out.push(q(s.name)); out.push(s.columns.map(q).join(',')); s.rows.forEach(r => out.push(r.map(q).join(','))); out.push(''); });
      download(fileName(rep.title, 'csv'), new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' })); },
    async xlsx(rep) { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); const wb = XLSX.utils.book_new(), used = {};
      const safe = v => (typeof v === 'string' && /^[=+@\t\r]/.test(v)) ? "'" + v : v;
      rep.sections.forEach(s => { let n = s.name.replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 28); while (used[n]) n += '_'; used[n] = 1; const ws = XLSX.utils.aoa_to_sheet([s.columns].concat(s.rows.map(r => r.map(safe)))); ws['!cols'] = s.columns.map(c => ({ wch: Math.min(40, Math.max(10, c.length + 4)) })); XLSX.utils.book_append_sheet(wb, ws, n); });
      XLSX.writeFile(wb, fileName(rep.title, 'xlsx')); },
    async pdf(rep) { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'); await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
      const wide = rep.sections.some(s => s.columns.length > 12), doc = new jspdf.jsPDF({ orientation: 'landscape', format: wide ? 'a3' : 'a4' }), L = v => String(v == null ? '' : v).replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '?');
      doc.setFontSize(16); doc.text(L(rep.title), 14, 16); doc.setFontSize(10); doc.setTextColor(110); doc.text(L((rep.subtitle || '') + '   |   Generated ' + fmtD(today())), 14, 23); let y = 30;
      rep.sections.forEach(s => { if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 16; } doc.setFontSize(12); doc.setTextColor(40); doc.text(L(s.name) + ' (' + s.rows.length + ')', 14, y);
        doc.autoTable({ head: [s.columns.map(L)], body: s.rows.length ? s.rows.map(r => r.map(L)) : [[{ content: 'No records', colSpan: s.columns.length }]], startY: y + 3, styles: { fontSize: s.columns.length > 12 ? 6.5 : 8, cellPadding: 1.6, overflow: 'linebreak' }, headStyles: { fillColor: [120, 86, 255] }, alternateRowStyles: { fillColor: [245, 243, 255] }, margin: { left: 14, right: 14 } });
        y = doc.lastAutoTable.finalY + 12; });
      doc.save(fileName(rep.title, 'pdf')); }
  };
  const EXPORTS = { test: 'Individual test report', tests: 'Complete test history', subjects: 'Subject-wise analytics', mistakes: 'Mistake log', revisions: 'R1/R2/R3 revision history', planner: 'Daily planner', month: 'Monthly planner', mcq: 'Daily MCQ practice', overall: 'Overall performance report' };
  const testOpts = () => (state.tests || []).filter(Boolean).slice().sort((a, b) => a.date < b.date ? 1 : -1).map(t => [t.tid, t.tid + ' · ' + (t.name || '')]);
  ACT.exportMenu = d => {
    TRK.sync(); S.exp = { kind: d.kind, id: d.id || '' }; const k = d.kind, t = today();
    TRK.modal('<i class="fas fa-download" aria-hidden="true"></i> Export · ' + EXPORTS[k] + (d.id ? ' · ' + esc(d.id) : ''), (k === 'test' ? '<p class="t-sub t-mb">Includes the Test ID, all subject-wise performance, every mistake of this test and its revision history.</p>' : '') +
      (k === 'planner' || k === 'mcq' ? '<div class="t-fgrid t-mb">' + fld('From', inp('ex-from', addDays(t, -30), 'date')) + fld('To', inp('ex-to', addDays(t, 60), 'date')) + '</div>' : '') + (k === 'month' ? '<div class="t-fgrid t-mb">' + fld('Month', inp('ex-month', t.slice(0, 7), 'month')) + '</div>' : '') +
      (k === 'test' && !d.id ? '<div class="t-fgrid t-mb">' + fld('Test', '<select class="form-control" id="ex-test">' + opts(testOpts()) + '</select>', 'wf') + '</div>' : '') + (k === 'mistakes' && !d.id && S.page !== 'mistake-revision' ? '<div class="t-fgrid t-mb">' + fld('Scope', '<select class="form-control" id="ex-test">' + opts(testOpts().map(o => [o[0], 'Only ' + o[1]]), '', 'Global mistake log (all tests + notebook)') + '</select>', 'wf') + '</div>' : '') +
      ((k === 'mistakes' || k === 'revisions') && !d.id && S.page === 'mistake-revision' ? '<p class="t-sub t-mb">Uses the filters currently set on this page.</p>' : '') +
      '<div class="t-grid t-g3">' + [['pdf', 'PDF', 'fa-file-pdf', C.coral], ['xlsx', 'Excel', 'fa-file-excel', C.teal], ['csv', 'CSV', 'fa-file-csv', C.blue]].map(f => '<button class="btn btn-outline" style="padding:18px;flex-direction:column" data-trk="exportGo" data-fmt="' + f[0] + '"><i class="fas ' + f[2] + '" style="font-size:26px;color:' + f[3] + '" aria-hidden="true"></i>' + f[1] + '</button>').join('') + '</div>');
  };
  ACT.exportGo = (d, btn) => busy(btn, async () => {
    const e = S.exp, id = e.id || val('ex-test'), onM = isPageActive('mistake-revision'); let rep;
    if (e.kind === 'test') { if (!id) throw { message: 'Choose a test to export.' }; rep = E.report(state, 'test', { id: id }); }
    else if (e.kind === 'mistakes' || e.kind === 'revisions') rep = E.report(state, e.kind, { filter: id ? { exactTestId: id } : (onM ? S.mf : {}) });
    else if (e.kind === 'tests') rep = E.report(state, 'tests', { filter: isPageActive('test-history') ? { type: S.hist.type || 'ALL', format: S.hist.format || 'ALL', from: S.hist.from, to: S.hist.to } : {} });
    else if (e.kind === 'planner' || e.kind === 'mcq') rep = E.report(state, e.kind, { filter: { from: val('ex-from'), to: val('ex-to') } });
    else if (e.kind === 'month') { const m = val('ex-month') || today().slice(0, 7), y = +m.slice(0, 4), mm = +m.slice(5), last = new Date(y, mm, 0).getDate(); rep = E.report(state, 'planner', { filter: { from: m + '-01', to: m + '-' + pad(last) } }); rep.title = 'Zona Occludens Monthly Planner ' + MON[mm - 1] + ' ' + y; }
    else rep = E.report(state, e.kind, { filter: S.filt });
    await WRITE[d.fmt](rep); TRK.closeModal(); toast(rep.title + ' exported as ' + d.fmt.toUpperCase() + '.');
  });

  /* ------------------------------------------------------------- REPORTS & DATA page */
  RENDER['reports'] = function () {
    const T = E.userSummary(state);
    $('page-reports').innerHTML = '<div class="trk"><div class="t-grid t-g4 t-mb">' + stat('Tests logged', N(T.tests), 'every one has a permanent Test ID', C.saffron, 'fa-file-lines') + stat('Overall accuracy', P(T.accuracy === '' ? null : T.accuracy), 'weighted across all tests', C.purple, 'fa-crosshairs') + stat('Mistakes', N(T.mistakes), N(T.pendingRev) + ' pending revision', C.coral, 'fa-triangle-exclamation') + stat('Storage', 'Encrypted', 'in your own Google Sheet', C.teal, 'fa-shield-halved') + '</div>' +
      '<div class="glass-card t-acc t-mb" style="--acc:' + C.saffron + '"><div class="t-card-h"><h3><i class="fas fa-file-export" aria-hidden="true"></i>Reports &amp; exports</h3><span class="t-sub">PDF, Excel or CSV · made on this device, so they work offline (PDF / Excel need the internet the first time)</span></div><div class="t-grid t-g4">' + Object.keys(EXPORTS).map(k => '<button class="btn btn-outline" style="justify-content:flex-start" data-trk="exportMenu" data-kind="' + k + '"><i class="fas fa-download" aria-hidden="true"></i> ' + EXPORTS[k] + '</button>').join('') + '</div></div>' +
      '<div class="t-grid t-g2"><div class="glass-card t-acc" style="--acc:' + C.purple + '"><div class="t-card-h"><h3><i class="fas fa-box-archive" aria-hidden="true"></i>Backup &amp; restore</h3></div><p class="t-sub t-mb">Your tests, subject rows, mistakes and revision history travel inside the normal Zona backup. Restore offers Merge, which only adds what is missing and never overwrites existing records.</p><div class="t-row"><button class="btn btn-primary" data-trk="bkJson"><i class="fas fa-download" aria-hidden="true"></i> Download full backup (JSON)</button><button class="btn btn-outline" data-trk="bkImport"><i class="fas fa-upload" aria-hidden="true"></i> Restore from a file</button><button class="btn btn-outline" data-trk="nav" data-page="settings"><i class="fas fa-cloud" aria-hidden="true"></i> Cloud snapshots</button></div></div>' +
      '<div class="glass-card t-acc" style="--acc:' + C.teal + '"><div class="t-card-h"><h3><i class="fas fa-server" aria-hidden="true"></i>Server check</h3></div><p class="t-sub t-mb">The same calculation engine runs in the app and in code.gs. These tools sync first, then ask the server to recompute from your encrypted cloud copy.</p><div class="t-row"><button class="btn btn-outline" data-trk="srvVerify"><i class="fas fa-circle-check" aria-hidden="true"></i> Verify my analytics with the server</button><button class="btn btn-outline" data-trk="srvLog"><i class="fas fa-list" aria-hidden="true"></i> Recent sync log</button><button class="btn btn-outline" data-trk="srvSync"><i class="fas fa-rotate" aria-hidden="true"></i> Sync now</button></div></div></div></div>';
  };
  ACT.bkJson = () => exportData();
  ACT.bkImport = () => { const f = $('importFile'); if (f) f.click(); };
  ACT.srvSync = (d, btn) => busy(btn, async () => { await syncDataCloud(); });
  const srvErr = e => { throw { message: (e && (e.code === 'BAD_ACTION' || /Unknown action/i.test(e.message || ''))) ? 'Your Apps Script is still the v3 code.gs. Paste the new code.gs and deploy a NEW VERSION to use this.' : Z.util.explain(e) }; };
  ACT.srvVerify = (d, btn) => busy(btn, async () => {
    if (!Z.util.profile()) throw { message: 'Sign in first.' };
    await Z.sync.flush(true);
    const r = await Z.api.call('analytics', { filter: {} }).catch(srvErr), l = E.analytics(state, {});
    const rows = [['Tests', l.totals.tests, r.totals.tests], ['Questions', l.totals.totalQ, r.totals.totalQ], ['Attempted', l.totals.attempted, r.totals.attempted], ['Correct', l.totals.correct, r.totals.correct], ['Incorrect', l.totals.incorrect, r.totals.incorrect],
      ['Cumulative accuracy', P(l.totals.pct.accuracy), P(r.totals.pct.accuracy)], ['Mistakes', l.mistakes.total, r.mistakes.total], ['Pending revisions', l.mistakes.pending, r.mistakes.pending]];
    const same = rows.every(x => String(x[1]) === String(x[2]));
    TRK.modal('<i class="fas fa-circle-check" aria-hidden="true"></i> Server check', '<div class="t-alert t-mb" style="--c:' + (same ? C.teal : C.saffron) + '"><i class="fas ' + (same ? 'fa-circle-check' : 'fa-triangle-exclamation') + '" aria-hidden="true"></i><div>' + (same ? 'The server and this device agree on every figure.' : 'Some figures differ. This usually means a change has not synced yet: tap Sync now and check again.') + '</div></div>' +
      '<div class="t-tw"><table class="t-t"><thead><tr><th>Metric</th><th class="n">This device</th><th class="n">Server (code.gs v' + esc(r.version || '?') + ')</th></tr></thead><tbody>' + rows.map(x => '<tr><td>' + x[0] + '</td><td class="n">' + esc(x[1]) + '</td><td class="n ' + (String(x[1]) === String(x[2]) ? 'okc' : 'warnc') + '"><b>' + esc(x[2]) + '</b></td></tr>').join('') + '</tbody></table></div>');
  });
  ACT.srvLog = (d, btn) => busy(btn, async () => {
    if (!Z.util.profile()) throw { message: 'Sign in first.' };
    const r = await Z.api.call('syncLog').catch(srvErr);
    TRK.modal('<i class="fas fa-list" aria-hidden="true"></i> Recent sync log', r.items.length ? '<div class="t-tw"><table class="t-t"><thead><tr><th>Time</th><th>Action</th><th>Status</th><th>Operation ID</th></tr></thead><tbody>' + r.items.map(l => '<tr><td style="white-space:nowrap">' + esc(new Date(l.at).toLocaleString()) + '</td><td>' + esc(l.action) + '</td><td>' + badge(l.status, C.teal) + '</td><td class="t-sub">' + esc(l.opId) + '</td></tr>').join('') + '</tbody></table></div><p class="t-sub t-mt">Each save carries a unique operation ID, so a retried request is never written twice.</p>' : emptyBox('No saves logged yet.', 'fa-list'), true);
  });
})();
