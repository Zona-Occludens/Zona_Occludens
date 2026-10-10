/* =====================================================================
   Zona Occludens: boot / integration layer  (loaded LAST)
   Installs thin wrappers around functions defined in the main inline script so every
   existing feature keeps working while gaining: event-driven state, cloud sync with offline
   queue, 5 themes, new pages and the Guidelines embed.
   ===================================================================== */
(function () {
  'use strict';
  const Z = window.Zona, U = Z.util, $ = U.$;

  /* 1. State events + sync: every saveData() marks dirty, schedules a POST and emits 'state' */
  const _saveData = window.saveData;
  window.saveData = function () {
    if (Z.deleting) return;
    const r = _saveData.apply(this, arguments);
    Z.sync.markDirty();
    Z.bus.emit('state');
    return r;
  };
  window.syncDataCloud = async function (silent) {
    if (!silent) U.toast('Syncing to cloud…', 'info');
    const ok = await Z.sync.flush(!silent);
    if (!silent) U.toast(ok ? 'Cloud sync successful ✓' : (navigator.onLine ? 'Could not sync right now. It will retry automatically.' : 'Offline. Changes are saved on this device.'), ok ? 'success' : 'warn');
    return ok;
  };

  /* 2. Data tools (header buttons keep their inline handlers) */
  window.exportData = Z.data.exportJson;
  window.importData = function (ev) {
    const f = ev.target.files && ev.target.files[0];
    Promise.resolve(Z.data.importFile(f)).finally(() => { try { ev.target.value = ''; } catch (e) {} });
  };
  window.resetMyData = Z.data.deleteAccount;          // sidebar "Delete account" button

  /* 3. Themes (5) */
  window.isDarkTheme = function () { return Z.theme.get() !== 'light'; };
  let lastTheme = null;
  const rebuildCharts = U.debounce(function () {
    try {
      if (typeof weightageChartInst !== 'undefined' && weightageChartInst) { weightageChartInst.destroy(); weightageChartInst = null; }
      ['testChartInst', 'mcqChartInst', 'radarChartInstance', 'volumeChartInstance'].forEach(k => { if (window[k]) { window[k].destroy(); window[k] = null; } });
      STW.destroyCharts();
      if (isPageActive('dashboard')) renderDashboard(); else renderWeightageChart();
      if (isPageActive('stw')) renderStw();
      if (isPageActive('planner')) renderPlanner.now();
      renderStreak();
    } catch (e) { console.warn('chart rebuild', e); }
  }, 120);
  Z.bus.on('theme', function (id) {
    const t = Z.THEMES.find(x => x.id === id) || Z.THEMES[0];
    const btn = $('themeBtn'); if (btn) btn.replaceChildren(U.ico(t.icon));
    const meta = $('metaThemeColor'); if (meta) meta.setAttribute('content', t.color);
    if (lastTheme !== null && lastTheme !== id) rebuildCharts();
    lastTheme = id;
  });
  UI.applyTheme = function (theme, announce) {
    if (!Z.theme.ids.includes(theme)) theme = 'dark';
    Z.theme.set(theme, !!announce);
    if (announce) { const t = Z.THEMES.find(x => x.id === theme); U.toast('Theme: ' + t.name, 'info'); }
  };
  window.toggleTheme = function () { UI.applyTheme(Z.theme.next(), true); };

  /* 4. Guidelines embed (same fullscreen engine as MedNotes) + bridge */
  window.Guidelines = Z.makeEmbed({ card: 'glCard', frame: 'guidelinesFrame', btn: 'glFsBtn', label: 'glFsLabel' });
  window.toggleGuidelinesFullscreen = function () { window.Guidelines.toggle(); };
  const glFrame = () => $('guidelinesFrame');
  function glHydrate() {
    const f = glFrame(); if (!f || !f.contentWindow) return;
    f.contentWindow.postMessage({ source: 'zona', type: 'hydrate', payload: { checks: (state.guidelines && state.guidelines.checks) || {} }, theme: Z.theme.get() }, Z.origin);
  }
  window.addEventListener('message', function (e) {
    const d = e.data, f = glFrame();
    if (!d || d.source !== 'guidelines' || !f || e.source !== f.contentWindow || e.origin !== location.origin) return;
    if (d.type === 'ready') glHydrate();
    else if (d.type === 'changed' && d.payload && d.payload.checks && typeof d.payload.checks === 'object' && !Array.isArray(d.payload.checks)) {
      const clean = {};
      Object.keys(d.payload.checks).forEach(k => { if (/^(do|dont)-\d{1,3}$/.test(k) && d.payload.checks[k] === true) clean[k] = true; });
      state.guidelines = { checks: clean };
      saveData();
    }
  });

  /* 5. Navigation hooks: new pages render lazily when opened */
  const _nav = window._navToImpl;
  const hooks = {
    settings: () => Z.settings.render(),
    'revision-schedule': () => Z.strategy.render(),
    syllabus: () => Z.syllabus.render(),
    rewards: () => setTimeout(() => Z.social.renderLeaderboard(), 0),
    planner: () => window.ZonaPlanner.init(),
    dashboard: () => window.renderTodayTomorrow(),
    guidelines: () => window.Guidelines.enter()
  };
  window._navToImpl = function (pageId) {
    if (pageId !== 'guidelines') window.Guidelines.leave();
    _nav.apply(this, arguments);
    document.body.classList.toggle('on-guidelines', pageId === 'guidelines');
    document.body.classList.toggle('on-embed', pageId === 'mednotes' || pageId === 'guidelines');
    if (hooks[pageId]) { try { hooks[pageId](); } catch (e) { console.error('[page hook]', pageId, e); } }
    setTimeout(scanReveal, 60);
  };

  /* 6. Init wrapper: cross-device theme, planner controls, widgets, announcements */
  const _fin = window.finalizeInit;
  window.finalizeInit = function () {
    if (!U.ls.get('zona-theme') && state.settings && state.settings.theme) U.ls.set('zona-theme', state.settings.theme);
    _fin.apply(this, arguments);
    U.settings();
    window.ZonaPlanner.init();
    window.renderTodayTomorrow();
    window.dispatchEvent(new Event('resize'));
    if (!Z._announced) { Z._announced = true; setTimeout(Z.social.announcements, 3000); }
    Z.bus.emit('ready');
  };

  /* 7. Scroll-reveal (only for cards that start below the fold; never hides anything in view) */
  let io = null;
  function scanReveal() {
    if (!('IntersectionObserver' in window) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    if (!io) io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('sr-in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    document.querySelectorAll('.page.active .glass-card:not(.sr):not(.reveal), .page.active .stat-card:not(.sr)').forEach(el => {
      if (el.getBoundingClientRect().top > innerHeight * 0.95) { el.classList.add('sr'); io.observe(el); }
    });
  }
  const scanSoon = U.debounce(scanReveal, 250);
  Z.bus.on('ready', scanSoon);

  /* 8. Go */
  Z.boot();
  Z.sync.setStatus(Z.sync.isDirty() ? 'pending' : 'idle');
})();
