/* =====================================================================
   Zona Occludens: planner module (loaded AFTER the main inline script)
   ---------------------------------------------------------------------
   1. renderTodayTomorrow()   reactive Today / Tomorrow cards (listens to 'state')
   2. Planner navigation      month dropdown (YYYY-MM), prev/next, week strip, jump-to-date
   3. resetPlannerProgress()  confirmation modal + local reset + server sync
   ===================================================================== */
(function () {
  'use strict';
  const Z = window.Zona, U = Z.util, h = U.h, ico = U.ico, $ = U.$;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parse = s => new Date(s + 'T00:00:00');
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const clamp = s => (s < APP_PLANNER_START ? APP_PLANNER_START : s > APP_PLANNER_END ? APP_PLANNER_END : s);
  const targetsOf = e => ((e && e.targets) || []).map(t => (typeof t === 'string' ? { text: t, done: false } : t));

  /* ------------------------------------------------ 1. Today / Tomorrow */
  function dayCard(isoDate, label, iconName, accent) {
    const e = state.planner && state.planner[isoDate];
    const nice = parse(isoDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const head = h('div', { class: 'tt-head' },
      h('h3', { class: 'tt-title' }, ico(iconName), ' ' + label),
      h('span', { class: 'tt-date', text: nice }));
    const card = h('div', { class: 'glass-card tt-card', style: { borderLeft: '4px solid var(' + accent + ')' }, 'data-date': isoDate }, head);
    if (!e) {
      card.append(h('p', { class: 'tt-empty', text: 'This date is outside your planner range.' }));
      return card;
    }
    const ts = targetsOf(e);
    const done = ts.filter(t => t.done).length;
    const pct = ts.length ? Math.round(done / ts.length * 100) : 0;
    const meta = h('div', { class: 'tt-meta' },
      e.subject ? h('span', { class: 'tt-chip', text: (SUBJECT_EMOJIS[e.subject] || '') + ' ' + e.subject }) : null,
      e.priority ? h('span', { class: 'tt-chip warn', text: e.priority }) : null,
      e.dayFinished ? h('span', { class: 'tt-chip ok' }, ico('check-double'), ' Day finished') : null);
    card.append(meta);
    if (ts.length) {
      card.append(
        h('div', { class: 'tt-prog', 'aria-label': done + ' of ' + ts.length + ' done' },
          h('div', { class: 'tt-bar' }, h('i', { style: { width: pct + '%' } })), h('span', { text: done + '/' + ts.length })),
        h('ul', { class: 'tt-list' }, ts.map((t, idx) => {
          const cb = h('input', { type: 'checkbox', checked: t.done ? true : null, 'aria-label': 'Mark done: ' + t.text });
          cb.addEventListener('change', () => toggleTargetDone(isoDate, idx));
          return h('li', { class: t.done ? 'done' : '' }, h('label', null, cb, h('span', { text: t.text })));
        })));
    } else card.append(h('p', { class: 'tt-empty', text: 'Nothing planned yet. Add your first target below.' }));
    if (e.notes) card.append(h('p', { class: 'tt-notes', text: e.notes }));

    const inp = h('input', { class: 'form-control', type: 'text', maxlength: 120, placeholder: 'Quick add a target…', 'aria-label': 'Quick add target for ' + label });
    const add = h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'aria-label': 'Add target' }, ico('plus'));
    const go = () => { const v = inp.value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 120); if (!v) return; window.quickAddTarget(isoDate, v); };
    add.addEventListener('click', go);
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
    const open = h('button', { type: 'button', class: 'btn btn-outline btn-sm', title: 'Open in planner' }, ico('arrow-up-right-from-square'), ' Planner');
    open.addEventListener('click', () => { navToPage('planner'); setTimeout(() => P.goTo(isoDate), 120); });
    card.append(h('div', { class: 'tt-add' }, inp, add, open));
    return card;
  }

  window.renderTodayTomorrow = function () {
    const host = $('todayTomorrowHost');
    if (!host || typeof state === 'undefined' || !state.planner) return;
    const today = iso(new Date()), tomorrow = addDays(today, 1);
    host.dataset.day = today;
    host.replaceChildren(h('div', { class: 'grid-2 tt-grid' },
      dayCard(today, "Today's Plan", 'sun', '--orange'),
      dayCard(tomorrow, "Tomorrow's Plan", 'moon', '--purple')));
  };

  /** Adds a target from anywhere (dashboard quick-add). Everything re-renders through the state event. */
  window.quickAddTarget = function (d, text) {
    if (!state.planner[d]) { U.toast('That date is outside your planner range.', 'error'); return; }
    state.planner[d].targets.push({ text: text, done: false });
    saveData();
    if (isPageActive('planner')) renderPlanner.now();
    U.toast('Target added ✓', 'success');
  };

  const refreshWidget = U.debounce(() => { window.renderTodayTomorrow(); renderWeekStrip(); }, 60);
  Z.bus.on('state', refreshWidget);
  Z.bus.on('imported', refreshWidget);
  setInterval(() => { const host = $('todayTomorrowHost'); if (host && host.dataset.day && host.dataset.day !== iso(new Date())) { window.renderTodayTomorrow(); renderWeekStrip(); } }, 30000);

  /* ------------------------------------------------ 2. Navigation */
  const P = window.ZonaPlanner = { focus: null };

  function monthKeyOf(s) { return s.slice(0, 7); }
  function buildMonthOptions() {
    const sel = $('planner-month-filter'); if (!sel) return;
    const keep = sel.value;
    const opts = [];
    let d = parse(APP_PLANNER_START); d.setDate(1);
    const end = parse(APP_PLANNER_END);
    while (d <= end) { opts.push(h('option', { value: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), text: MONTHS[d.getMonth()] + ' ' + d.getFullYear() })); d.setMonth(d.getMonth() + 1); }
    sel.replaceChildren(...opts);
    const want = /^\d{4}-\d{2}$/.test(keep) && opts.some(o => o.value === keep) ? keep : monthKeyOf(clamp(iso(new Date())));
    sel.value = want;
    sel.setAttribute('aria-label', 'Planner month');
  }
  function setMonth(key) {
    const sel = $('planner-month-filter'); if (!sel) return;
    if (!Array.from(sel.options).some(o => o.value === key)) return;
    sel.value = key; renderPlanner.now();
  }
  P.shiftMonth = function (n) {
    const sel = $('planner-month-filter'); if (!sel) return;
    const i = sel.selectedIndex + n;
    if (i < 0 || i >= sel.options.length) { U.toast(n < 0 ? 'This is the first month of your planner.' : 'This is the last month of your planner.', 'info'); return; }
    sel.selectedIndex = i; P.focus = null; renderPlanner.now();
  };
  P.goTo = function (d) {
    d = clamp(d); P.focus = d;
    const sel = $('planner-month-filter');
    if (sel && sel.value !== monthKeyOf(d)) { sel.value = monthKeyOf(d); }
    renderPlanner.now();
    setTimeout(() => {
      const el = $('pd-' + d);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 1800); }
      else U.toast('That day is hidden. Toggle "Show Archived" to see finished days.', 'info');
    }, 80);
  };
  window.jumpToToday = function () { P.goTo(iso(new Date())); };

  function renderWeekStrip() {
    const host = $('plannerWeekStrip'); if (!host || typeof state === 'undefined') return;
    const today = iso(new Date());
    const base = P.focus || clamp(today);
    const dow = parse(base).getDay();
    const weekStart = addDays(base, -dow);
    const wk = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const label = parse(wk[0]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' – ' + parse(wk[6]).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous week' }, ico('chevron-left'));
    const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next week' }, ico('chevron-right'));
    prev.addEventListener('click', () => P.goTo(addDays(weekStart, -7)));
    next.addEventListener('click', () => P.goTo(addDays(weekStart, 7)));
    const jump = h('input', { class: 'form-control wk-jump', type: 'date', min: APP_PLANNER_START, max: APP_PLANNER_END, value: base, 'aria-label': 'Jump to date' });
    jump.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(jump.value)) P.goTo(jump.value); });
    const days = wk.map(d => {
      const e = state.planner[d], ts = targetsOf(e), done = ts.filter(t => t.done).length;
      const inRange = !!e;
      const st = !inRange ? 'off' : e.dayFinished ? 'full' : ts.length === 0 ? 'none' : done === ts.length ? 'full' : done > 0 ? 'part' : 'open';
      const b = h('button', {
        type: 'button', class: 'wk-day ' + st + (d === today ? ' today' : '') + (d === base ? ' focus' : ''), disabled: inRange ? null : true,
        'aria-label': parse(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + (ts.length ? ', ' + done + ' of ' + ts.length + ' done' : ', no targets'), 'aria-current': d === today ? 'date' : null
      }, h('small', { text: DOW[parse(d).getDay()] }), h('b', { text: String(parse(d).getDate()) }), h('i', { class: 'wk-dot' }), ts.length ? h('span', { class: 'wk-count', text: done + '/' + ts.length }) : null);
      b.addEventListener('click', () => P.goTo(d));
      return b;
    });
    host.replaceChildren(
      h('div', { class: 'wk-top' }, prev, h('div', { class: 'wk-label' }, ico('calendar-week'), ' ' + label), next, jump),
      h('div', { class: 'wk-days' }, days));
  }

  // keep the strip in sync with every planner render (original function is replaced, not edited)
  const _render = window._renderPlannerNow;
  window._renderPlannerNow = function () { _render.apply(this, arguments); renderWeekStrip(); };

  P.init = function () {
    buildMonthOptions();
    const prev = $('plPrevMonth'), next = $('plNextMonth');
    if (prev && !prev._z) { prev._z = 1; prev.addEventListener('click', () => P.shiftMonth(-1)); }
    if (next && !next._z) { next._z = 1; next.addEventListener('click', () => P.shiftMonth(1)); }
    const sub = $('plannerRangeText');
    if (sub) sub.textContent = 'Plan every day from ' + parse(APP_PLANNER_START).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + ' to ' + parse(APP_PLANNER_END).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + ' (' + Math.round((parse(APP_PLANNER_END) - parse(APP_PLANNER_START)) / 864e5) + ' days).';
    renderWeekStrip();
  };

  /* ------------------------------------------------ 3. Reset planner */
  window.resetPlannerProgress = async function () {
    const filled = Object.values(state.planner || {}).filter(d => d && ((d.targets && d.targets.length) || d.notes || d.dayFinished || d.starClaimed)).length;
    const ok = await Z.modal.confirm({
      title: 'Reset your planner?', danger: true, confirmLabel: 'Reset planner', icon: 'rotate-left',
      message: 'This clears all ' + filled + ' planned day' + (filled === 1 ? '' : 's') + ' (targets, notes, stars, trophies) and restarts your daily streak from today. Your profile, topics, tests, mistakes and XP are kept. A cloud snapshot is taken first so it can be restored from Settings.'
    });
    if (!ok) return;
    const today = iso(new Date());
    U.settings();
    state.settings.seeds = Object.assign({}, state.settings.seeds, { inicetNov2026: true });   // the old auto-schedule must never re-seed after a reset
    state.planner = {};
    setupPlanner();                                     // rebuilds every empty day in the planner range
    state.streak = { count: 1, lastDate: today, cards: 3, history: [today], pendingRepair: false };
    saveData();                                          // local save + marks dirty + emits 'state'
    renderPlanner.now(); renderOverdueTasks(); renderStreak(); window.renderTodayTomorrow(); renderWeekStrip();
    if (isPageActive('dashboard')) renderDashboard();
    U.toast('Planner reset ✓', 'success');
    if (navigator.onLine) {
      try { await Z.api.call('resetPlanner', { streak: state.streak }); U.toast('Planner cleared in the cloud too.', 'success'); }
      catch (e) { U.toast('Reset saved on this device. Cloud will update when sync succeeds.', 'warn'); }
    } else U.toast('Offline: the reset will sync when you are back online.', 'warn');
  };
})();
