/* =====================================================================
   Zona Occludens: Test & Mistake Tracker ENGINE  (v4)
   ---------------------------------------------------------------------
   Pure data logic, no DOM and no network. The SAME code runs in three places:
     - the browser (zona-tracker.js uses it, so analytics work offline),
     - Google Apps Script (code.gs embeds an identical copy for the
       analytics / report / admin endpoints),
     - Node (tests).
   Data model (all inside the user's synced state, encrypted at rest):
     Test (permanent Test ID "tid")  ->  subject rows  ->  mistakes (state.errors, linked by testId)
       ->  R1 / R2 / R3 revision history (append-only "hist" on each mistake)
   ===================================================================== */
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
if (typeof module !== 'undefined' && module.exports) module.exports = ZTE;
if (typeof window !== 'undefined') window.ZonaTrackerEngine = ZTE;
