/* =====================================================================
   Zona Guidelines: behaviour for guidelines.html
   - search + expand/collapse all
   - Do / Don't checklist (synced with the Zona app through postMessage when embedded)
   - theme sync with the host app
   Standalone mode (opened directly) keeps checks in this browser's localStorage.
   ===================================================================== */
(function () {
  'use strict';
  var THEMES = ['dark', 'light', 'oled', 'midnight', 'solarized'];
  var ORIGIN = location.origin === 'null' ? '*' : location.origin;
  var embedded = window.parent && window.parent !== window;
  if (embedded) document.documentElement.classList.add('embedded');
  var LS_KEY = 'zona-guidelines-checks';

  var GL_DO = [
    ['do-1', 'Start your first study block within 30 minutes of your fixed wake-up time.'],
    ['do-2', "Finish today's planner targets before opening any new resource."],
    ['do-3', 'Attempt at least one timed MCQ block and review every question.'],
    ['do-4', 'Log every wrong or lucky-right answer in the Mistake Notebook.'],
    ['do-5', "Spend 10 minutes recalling yesterday's topics from memory (spaced repetition)."],
    ['do-6', 'Break every 25–50 minutes: hydrate, stretch, look away from screens.'],
    ['do-7', 'Sleep 7+ hours. Screens off 30 minutes before bed.'],
    ['do-8', "Review tomorrow's plan before you sleep so you can start without deciding."]
  ];
  var GL_DONT = [
    ['dont-1', 'Start a brand-new resource in the final 6 weeks.'],
    ['dont-2', "Skip the Mistake Notebook because you're tired."],
    ['dont-3', 'Compare yourself with other aspirants during study blocks.'],
    ['dont-4', "Study in bed or with your phone within arm's reach."],
    ['dont-5', 'Read passively for more than 40 minutes without any recall.'],
    ['dont-6', 'Binge lectures at 2× speed with no notes or MCQs afterwards.'],
    ['dont-7', 'Trade sleep for extra hours. It costs more than it gives.'],
    ['dont-8', 'Re-read locked 🔒 topics instead of testing yourself on them.']
  ];

  var $ = function (id) { return document.getElementById(id); };
  var checks = {};
  try { checks = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { checks = {}; }

  function post(type, payload) {
    if (!embedded) return;
    try { window.parent.postMessage({ source: 'guidelines', type: type, payload: payload }, ORIGIN); } catch (e) {}
  }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(checks)); } catch (e) {}
    post('changed', { checks: checks });
  }

  /* ---------- checklist ---------- */
  function renderChecks() {
    [['doList', GL_DO], ['dontList', GL_DONT]].forEach(function (pair) {
      var ul = $(pair[0]); ul.textContent = '';
      pair[1].forEach(function (row) {
        var li = document.createElement('li'), label = document.createElement('label'),
          cb = document.createElement('input'), span = document.createElement('span');
        cb.type = 'checkbox'; cb.checked = checks[row[0]] === true; cb.setAttribute('data-id', row[0]);
        span.textContent = row[1];                                  // text only, never HTML
        cb.addEventListener('change', function () {
          if (cb.checked) checks[row[0]] = true; else delete checks[row[0]];
          progress(); persist();
        });
        label.appendChild(cb); label.appendChild(span); li.appendChild(label); ul.appendChild(li);
      });
    });
    progress();
  }
  function progress() {
    var all = GL_DO.concat(GL_DONT), done = all.filter(function (r) { return checks[r[0]] === true; }).length;
    $('progText').textContent = done + ' / ' + all.length;
    $('progBar').style.width = (done / all.length * 100) + '%';
  }
  $('resetChecks').addEventListener('click', function () { checks = {}; renderChecks(); persist(); });

  /* ---------- search + expand/collapse ---------- */
  var sections = Array.prototype.slice.call(document.querySelectorAll('details[data-section]'));
  function applySearch(q) {
    q = q.trim().toLowerCase();
    var any = false;
    sections.forEach(function (d) {
      // clear old highlights only in text we created (we do not rewrite innerHTML; we just show/hide)
      var hit = !q || d.textContent.toLowerCase().indexOf(q) > -1;
      d.classList.toggle('hidden', !hit);
      if (hit) { any = true; if (q && d.parentElement.closest('details')) d.parentElement.closest('details').open = true; if (q) d.open = true; }
    });
    $('noResults').classList.toggle('hidden', any);
  }
  $('q').addEventListener('input', function () { applySearch(this.value); });

  var allOpen = false;
  $('toggleAll').addEventListener('click', function () {
    allOpen = !allOpen;
    sections.forEach(function (d) { d.open = allOpen; });
    this.setAttribute('aria-expanded', allOpen ? 'true' : 'false');
    this.querySelector('span').textContent = allOpen ? 'Collapse all' : 'Expand all';
    this.querySelector('i').className = 'fas ' + (allOpen ? 'fa-angles-up' : 'fa-angles-down');
  });

  /* ---------- host bridge ---------- */
  function setTheme(t) { if (THEMES.indexOf(t) > -1) document.documentElement.setAttribute('data-theme', t); }
  window.addEventListener('message', function (e) {
    if (!embedded || e.source !== window.parent || e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.source !== 'zona') return;
    if (d.type === 'hydrate') {
      if (d.theme) setTheme(d.theme);
      if (d.payload && d.payload.checks && typeof d.payload.checks === 'object') {
        var c = {};
        Object.keys(d.payload.checks).forEach(function (k) { if (/^(do|dont)-\d{1,3}$/.test(k) && d.payload.checks[k] === true) c[k] = true; });
        checks = c; try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (err) {}
        renderChecks();
      }
    } else if (d.type === 'theme') setTheme(d.theme);
  });

  renderChecks();
  post('ready');
})();
