/* =====================================================================
   Zona Occludens: onboarding (CRED-style)  (loaded AFTER the main inline script)
   Splash  ->  Name & mobile  ->  Exam & phase  ->  Target date  ->  Daily goal  ->  Preferences  ->  Success
   - Profile is saved to localStorage immediately and registered with the backend (device-bound).
   - Offline / backend hiccup never blocks a student from starting: data syncs later.
   - Honeypot field + minimum-time check deter bots; the server re-checks the honeypot.
   ===================================================================== */
(function () {
  'use strict';
  const Z = window.Zona, U = Z.util, h = U.h, ico = U.ico, $ = U.$;
  const STEPS = 5;
  const EXAMS = [
    ['NEET PG', 'stethoscope', 'neetpg'], ['INICET Nov', 'hospital', 'inicetNov'], ['INICET May 2027', 'hospital', 'inicetMay'],
    ['FMGE', 'globe', 'fmge'], ['UPSC CMS', 'landmark', 'upsc']
  ];
  const PHASES = ['Just Started', 'Mid Phase', 'Final Phase', 'Revision'];
  const RESOURCES = ['Marrow', 'Prepladder', 'DAMS', 'BTR', 'Cerebellum', 'Arise', 'MIST', 'Other'];
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const hoursBucket = g => (g <= 2 ? '0-2' : g <= 4 ? '2-4' : g <= 8 ? '4-8' : '>8');

  const D = { name: '', mobile: '', exam: 'NEET PG', phase: 'Just Started', targetDate: '', goal: 6, resources: [], notif: { daily: true, time: '20:00', streak: true, announce: true }, leaderboard: false };
  let step = 0, started = 0, root, busy = false;

  function examDateFor(label) {
    const row = EXAMS.find(e => e[0] === label); if (!row) return '';
    const d = EXAM_DATES[row[2]]; const s = d ? d.slice(0, 10) : '';
    return s && s >= iso(new Date()) ? s : '';
  }
  function setErr(i, msg) { const el = root.querySelector('[data-err="' + i + '"]'); if (el) el.textContent = msg || ''; }

  /* -------------------------------------------------------------- build */
  function build() {
    root = $('obRoot'); if (!root || root.dataset.built) return;
    root.dataset.built = '1';

    /* step 1 */
    const name = h('input', { class: 'form-control ob-input', id: 'obName', type: 'text', maxlength: 60, placeholder: 'e.g. Aditi Sharma', autocomplete: 'name', 'aria-label': 'Full name' });
    const mobile = h('input', { class: 'form-control ob-input', id: 'obMobile', type: 'tel', inputmode: 'numeric', maxlength: 15, placeholder: '9876543210', autocomplete: 'tel', 'aria-label': 'Mobile number' });
    name.addEventListener('input', () => { D.name = name.value.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trimStart().slice(0, 60); validate(); });
    mobile.addEventListener('input', () => { mobile.value = mobile.value.replace(/\D/g, '').slice(0, 15); D.mobile = mobile.value; validate(); });
    const hp = h('input', { type: 'text', name: 'website', id: 'obWebsite', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'ob-hp' });

    /* step 2 */
    const examGrid = h('div', { class: 'ob-cards', role: 'radiogroup', 'aria-label': 'Target exam' }, EXAMS.map(e => {
      const b = h('button', { type: 'button', class: 'ob-card' + (D.exam === e[0] ? ' active' : ''), role: 'radio', 'aria-checked': D.exam === e[0] ? 'true' : 'false', 'data-exam': e[0] }, h('span', { class: 'ob-card-ico' }, ico(e[1])), h('b', { text: e[0] }));
      b.addEventListener('click', () => { D.exam = e[0]; D.targetDate = examDateFor(e[0]); examGrid.querySelectorAll('.ob-card').forEach(x => { const on = x.dataset.exam === e[0]; x.classList.toggle('active', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); }); syncDate(); });
      return b;
    }));
    const phaseRow = h('div', { class: 'ob-chips', role: 'radiogroup', 'aria-label': 'Preparation phase' }, PHASES.map(p => {
      const b = h('button', { type: 'button', class: 'ob-chip' + (D.phase === p ? ' active' : ''), role: 'radio', 'aria-checked': D.phase === p ? 'true' : 'false', text: p });
      b.addEventListener('click', () => { D.phase = p; phaseRow.querySelectorAll('.ob-chip').forEach(x => { const on = x.textContent === p; x.classList.toggle('active', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); }); });
      return b;
    }));

    /* step 3 */
    const dateIn = h('input', { class: 'form-control ob-input ob-date', id: 'obDate', type: 'date', min: iso(new Date()), 'aria-label': 'Target exam date' });
    dateIn.addEventListener('change', () => { D.targetDate = dateIn.value; validate(); });
    const quick = h('div', { class: 'ob-chips' }, [['In 1 month', 30], ['In 3 months', 90], ['In 6 months', 180]].map(q => {
      const b = h('button', { type: 'button', class: 'ob-chip', text: q[0] });
      b.addEventListener('click', () => { const d = new Date(); d.setDate(d.getDate() + q[1]); D.targetDate = iso(d); syncDate(); validate(); });
      return b;
    }));
    const countdown = h('div', { class: 'ob-count', 'aria-live': 'polite' });
    function syncDate() {
      dateIn.value = D.targetDate || '';
      if (D.targetDate) { const n = Math.round((new Date(D.targetDate + 'T00:00:00') - new Date(iso(new Date()) + 'T00:00:00')) / 864e5); countdown.replaceChildren(h('b', { text: String(Math.max(0, n)) }), ' days to go' + (n > 0 ? ' · about ' + Math.max(1, Math.round(n / 7)) + ' weeks' : '')); }
      else countdown.replaceChildren('Not sure yet? You can set this later in Settings.');
    }

    /* step 4 */
    const goalNum = h('output', { class: 'ob-goal-num', 'aria-live': 'polite', text: String(D.goal) });
    const goalLbl = h('small', { text: 'hours of focused study per day' });
    const dec = h('button', { type: 'button', class: 'ob-step-btn', 'aria-label': 'Decrease daily goal' }, ico('minus'));
    const inc = h('button', { type: 'button', class: 'ob-step-btn', 'aria-label': 'Increase daily goal' }, ico('plus'));
    const slider = h('input', { type: 'range', min: 1, max: 14, step: 1, value: D.goal, class: 'ob-range', 'aria-label': 'Daily study goal in hours' });
    const setGoal = v => { D.goal = Math.max(1, Math.min(16, v)); goalNum.textContent = String(D.goal); slider.value = D.goal; };
    dec.addEventListener('click', () => setGoal(D.goal - 1)); inc.addEventListener('click', () => setGoal(D.goal + 1));
    slider.addEventListener('input', () => setGoal(Number(slider.value)));
    const resRow = h('div', { class: 'ob-chips', role: 'group', 'aria-label': 'Resources you use' }, RESOURCES.map(r => {
      const b = h('button', { type: 'button', class: 'ob-chip', 'aria-pressed': 'false', text: r });
      b.addEventListener('click', () => { const i = D.resources.indexOf(r); if (i > -1) D.resources.splice(i, 1); else D.resources.push(r); b.classList.toggle('active', i === -1); b.setAttribute('aria-pressed', i === -1 ? 'true' : 'false'); });
      return b;
    }));

    /* step 5 */
    const sw = (label, sub, key, on) => {
      const b = h('button', { type: 'button', class: 'zm-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label }, h('i'));
      b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', v ? 'true' : 'false'); b.classList.toggle('on', v); if (key === 'leaderboard') D.leaderboard = v; else D.notif[key] = v; });
      return h('div', { class: 'ob-pref' }, h('div', null, h('b', { text: label }), h('small', { text: sub })), b);
    };
    const timeIn = h('input', { class: 'form-control ob-time', type: 'time', value: D.notif.time, 'aria-label': 'Reminder time' });
    timeIn.addEventListener('change', () => { D.notif.time = timeIn.value || '20:00'; });

    /* ---- existing-user sign-in (restore) ---- */
    const lMobile = h('input', { class: 'form-control ob-input', id: 'obLMobile', type: 'tel', inputmode: 'numeric', maxlength: 15, placeholder: 'Registered mobile number', autocomplete: 'tel', 'aria-label': 'Registered mobile number' });
    lMobile.addEventListener('input', () => { lMobile.value = lMobile.value.replace(/\D/g, '').slice(0, 15); });
    const lCode = h('input', { class: 'form-control ob-input', id: 'obLCode', type: 'text', maxlength: 14, placeholder: 'XXXXX-XXXXX', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Recovery code' });
    const lCodeWrap = h('div', { class: 'ob-code-wrap hidden-block' }, h('label', { class: 'ob-lbl', for: 'obLCode', text: 'Recovery code' }), lCode,
      h('p', { class: 'ob-sub', text: 'You saw this code when you registered. It is needed on a new phone or after clearing browser data. Lost it? Ask the admin to reset your device.' }));
    const lErr = h('p', { class: 'ob-err', role: 'alert' });
    const lBtn = h('button', { type: 'button', class: 'btn btn-primary ob-next' }, h('span', { text: 'Sign in' }), ico('right-to-bracket'));
    const lToggle = h('button', { type: 'button', class: 'ob-link', text: 'New phone? I have a recovery code' });
    const lNew = h('button', { type: 'button', class: 'ob-link', text: 'Create a new account instead' });
    lToggle.addEventListener('click', () => { lCodeWrap.classList.remove('hidden-block'); lCode.focus(); });
    lNew.addEventListener('click', () => { root.classList.remove('mode-login'); lErr.textContent = ''; });
    lBtn.addEventListener('click', async () => {
      if (busy) return;
      const mob = lMobile.value.trim(), rc = lCode.value.trim();
      lErr.textContent = '';
      if (!/^[0-9]{10,15}$/.test(mob)) { lErr.textContent = 'Enter the 10–15 digit mobile number you registered with.'; return; }
      busy = true; lBtn.disabled = true; lBtn.querySelector('span').textContent = 'Signing in…';
      try {
        const d = await Z.api.login({ profile: { mobile: mob }, restore: true, recoveryCode: rc, noPrompt: true, deferRecovery: true });
        const prof = d.profile || { mobile: mob, name: 'Student' };
        state.userProfile = prof; state = migrateState(state);
        lstore.set('pgmedprep_db_zacurians', JSON.stringify(state));
        busy = false; root.classList.remove('mode-login');
        started = Date.now();
        if (d._pendingRecovery) success(prof, d._pendingRecovery, false); else enterApp();
        return;
      } catch (e) {
        if (e.code === 'DEVICE_MISMATCH') { lCodeWrap.classList.remove('hidden-block'); lCode.focus(); }
        lErr.textContent = (e.code === 'NETWORK' || e.code === 'OFFLINE' || e.code === 'OLD_BACKEND' || e.code === 'FORBIDDEN' || e.code === 'NOT_CONFIGURED') ? U.explain(e) : e.message;
      }
      busy = false; lBtn.disabled = false; lBtn.querySelector('span').textContent = 'Sign in';
    });
    const loginPanel = h('section', { class: 'ob-login', 'aria-labelledby': 'obLT' },
      h('div', { class: 'ob-hero-ico', 'aria-hidden': 'true' }, ico('right-to-bracket')),
      h('h2', { id: 'obLT', class: 'ob-title', text: 'Welcome back' }),
      h('p', { class: 'ob-sub', text: 'Sign in with the mobile number you registered with. Your planner, tests and XP come back from the cloud.' }),
      h('label', { class: 'ob-lbl', for: 'obLMobile', text: 'Mobile number' }), lMobile, lCodeWrap, lErr, lBtn,
      h('div', { class: 'ob-links' }, lToggle, lNew));
    const toLogin = h('button', { type: 'button', class: 'ob-link', text: 'I already have an account' });
    toLogin.addEventListener('click', () => { root.classList.add('mode-login'); setTimeout(() => lMobile.focus(), 300); });
    const stepEl = (i, ico_, title, sub, ...kids) => h('section', { class: 'ob-step', 'data-step': i, 'aria-labelledby': 'obT' + i },
      h('div', { class: 'ob-hero-ico', 'aria-hidden': 'true' }, ico(ico_)),
      h('h2', { id: 'obT' + i, class: 'ob-title', text: title }), h('p', { class: 'ob-sub', text: sub }), ...kids,
      h('p', { class: 'ob-err', role: 'alert', 'data-err': i }));

    const steps = [
      stepEl(0, 'user-graduate', 'Let\'s get to know you', 'Your name and mobile number are your private study ID. We never message you without your consent.',
        h('label', { class: 'ob-lbl', for: 'obName', text: 'Full name' }), name, h('label', { class: 'ob-lbl', for: 'obMobile', text: 'Mobile number' }), mobile, hp, toLogin),
      stepEl(1, 'bullseye', 'What are you aiming for?', 'We will tailor countdowns, your 40-day strategy and the syllabus to this exam.', examGrid, h('label', { class: 'ob-lbl', text: 'Where are you in your preparation?' }), phaseRow),
      stepEl(2, 'calendar-days', 'When is the big day?', 'A date turns "someday" into a plan. Your dashboard will count down to it.', h('label', { class: 'ob-lbl', for: 'obDate', text: 'Target exam date' }), dateIn, quick, countdown),
      stepEl(3, 'fire', 'Set your daily study goal', 'Pick a number you can hit on a bad day. Consistency beats heroics.',
        h('div', { class: 'ob-goal' }, dec, h('div', { class: 'ob-goal-c' }, goalNum, goalLbl), inc), slider, h('label', { class: 'ob-lbl', text: 'Resources you use (optional)' }), resRow),
      stepEl(4, 'bell', 'Stay on track', 'Choose how Zona nudges you. You can change all of this in Settings.',
        sw('Daily study reminder', 'A nudge while the app is open', 'daily', true), h('div', { class: 'ob-pref time' }, h('div', null, h('b', { text: 'Reminder time' })), timeIn),
        sw('Streak-at-risk nudge', 'Heads-up before you lose your streak', 'streak', true), sw('Team announcements', 'Important updates only', 'announce', true),
        sw('Show me on the leaderboard', 'First name + XP, nothing else (opt-in)', 'leaderboard', false))
    ];

    const dots = h('div', { class: 'ob-dots', 'aria-hidden': 'true' }, Array.from({ length: STEPS }, () => h('i')));
    const label = h('span', { class: 'ob-steplabel', 'aria-live': 'polite' });
    const back = h('button', { type: 'button', class: 'ob-back', 'aria-label': 'Back' }, ico('arrow-left'));
    const next = h('button', { type: 'button', class: 'btn btn-primary ob-next' }, h('span', { text: 'Continue' }), ico('arrow-right'));
    back.addEventListener('click', () => { if (!busy && step > 0) go(step - 1, -1); });
    next.addEventListener('click', onNext);
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { if (root.classList.contains('mode-login')) { e.preventDefault(); lBtn.click(); } else if (!next.disabled) { e.preventDefault(); onNext(); } } });

    const splash = h('div', { class: 'ob-splash' },
      h('div', { class: 'ob-logo' }, h('span', { class: 'ob-ring r1' }), h('span', { class: 'ob-ring r2' }), h('img', { src: 'favicon.png', alt: '' })),
      h('h1', { class: 'ob-word' }, 'Zona Occludens'.split('').map((c, i) => h('span', { style: { animationDelay: (0.55 + i * 0.04) + 's' }, text: c === ' ' ? ' ' : c }))),
      h('p', { class: 'ob-tag', text: 'Tight junctions for mastery' }));
    splash.addEventListener('click', () => showMain());

    root.append(
      h('div', { class: 'ob-bg', 'aria-hidden': 'true' }, h('i', { class: 'o1' }), h('i', { class: 'o2' }), h('i', { class: 'o3' })),
      splash,
      h('div', { class: 'ob-main' },
        h('header', { class: 'ob-top' }, back, dots, label),
        h('div', { class: 'ob-stage' }, steps, h('div', { class: 'ob-done', 'aria-live': 'polite' })),
        h('footer', { class: 'ob-foot' }, next),
        loginPanel));
    root._next = next; root._label = label; root._dots = dots; root._back = back; root._steps = steps; root._splash = splash;
    syncDate();
  }

  /* ------------------------------------------------------------ logic */
  function validateStep(i, quiet) {
    if (i === 0) {
      if (D.name.trim().length < 2) { if (!quiet) setErr(0, 'Please enter your name.'); return false; }
      if (!/^[0-9]{10,15}$/.test(D.mobile)) { if (!quiet) setErr(0, 'Enter 10–15 digits, numbers only.'); return false; }
    }
    if (i === 2 && D.targetDate && D.targetDate < iso(new Date())) { if (!quiet) setErr(2, 'Pick a date that is today or later.'); return false; }
    setErr(i, ''); return true;
  }
  function validate() { const n = root && root._next; if (n) n.disabled = !validateStep(step, true); }

  function showMain() {
    const sp = root._splash; if (!sp || sp.classList.contains('out')) return;
    sp.classList.add('out'); root.classList.add('ready');
    started = Date.now();
    go(0, 1, true);
  }

  function go(n, dir, first) {
    const steps = root._steps, prev = steps[step];
    if (!first && prev) { prev.classList.remove('is-active'); prev.classList.add(dir > 0 ? 'leave-left' : 'leave-right'); const p = prev; setTimeout(() => p.classList.remove('leave-left', 'leave-right'), 420); }
    step = n;
    const cur = steps[n];
    cur.classList.remove('from-left', 'from-right', 'leave-left', 'leave-right');
    cur.classList.add(dir > 0 ? 'from-right' : 'from-left');
    void cur.offsetWidth;
    cur.classList.add('is-active'); cur.classList.remove('from-right', 'from-left');
    root._dots.querySelectorAll('i').forEach((d, i) => { d.classList.toggle('on', i === n); d.classList.toggle('done', i < n); });
    root._label.textContent = 'Step ' + (n + 1) + ' of ' + STEPS;
    root._back.style.visibility = n === 0 ? 'hidden' : 'visible';
    const nx = root._next; nx.querySelector('span').textContent = n === STEPS - 1 ? 'Create my space' : 'Continue';
    nx.querySelector('i').className = 'fas fa-' + (n === STEPS - 1 ? 'rocket' : 'arrow-right');
    validate();
    const f = cur.querySelector('input:not([tabindex="-1"]):not([type=range]):not([type=time])');
    if (f && (n === 0)) setTimeout(() => f.focus({ preventScroll: true }), 380);
  }

  function onNext() {
    if (busy) return;
    if (!validateStep(step, false)) { try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} return; }
    if (step < STEPS - 1) go(step + 1, 1); else finish();
  }

  async function finish() {
    const hpVal = ($('obWebsite') || {}).value || '';
    const tooFast = Date.now() - started < 4000;
    if (hpVal || tooFast) { setErr(4, 'Something looks off. Please try again in a moment.'); return; }
    busy = true; const nx = root._next; nx.disabled = true; nx.querySelector('span').textContent = 'Creating your space…';
    const profile = {
      name: D.name.trim().slice(0, 60), mobile: D.mobile, exam: D.exam, phase: D.phase, hours: hoursBucket(D.goal), resources: D.resources.slice(),
      targetDate: D.targetDate || '', goal: D.goal, notif: Object.keys(D.notif).filter(k => D.notif[k] === true)
    };
    const prevProfile = state.userProfile;
    state.userProfile = profile;
    state = migrateState(state);
    const S = U.settings(); S.notif = Object.assign({}, D.notif); S.leaderboard = D.leaderboard; S.theme = Z.theme.get();
    lstore.set('pgmedprep_db_zacurians', JSON.stringify(state));

    let recovery = '', offline = false;
    try {
      const r = await Z.api.login({ profile: profile, hp: hpVal, deferRecovery: true });
      recovery = r._pendingRecovery || '';
      if (D.leaderboard) { try { await Z.api.call('setLeaderboard', { optIn: true }); } catch (e) {} }
    } catch (e) {
      if (['BAD_REQUEST', 'RATE_LIMITED', 'DEVICE_MISMATCH'].indexOf(e.code) > -1) {
        state.userProfile = prevProfile || null;
        lstore.set('pgmedprep_db_zacurians', JSON.stringify(state));
        setErr(4, e.message); busy = false; nx.disabled = false; nx.querySelector('span').textContent = 'Create my space'; return;
      }
      offline = true;     // network / backend hiccup: continue locally, the sync engine retries
    }
    busy = false;
    success(profile, recovery, offline);
  }

  function success(profile, recovery, offline) {
    const done = root.querySelector('.ob-done');
    root._steps.forEach(s => s.classList.remove('is-active'));
    root.querySelector('.ob-top').classList.add('hide'); root.querySelector('.ob-foot').classList.add('hide');
    const start = h('button', { type: 'button', class: 'btn btn-primary ob-next' }, h('span', { text: 'Start studying' }), ico('arrow-right'));
    start.addEventListener('click', enterApp);
    const svg = '<svg viewBox="0 0 52 52" class="zm-check big" aria-hidden="true"><circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="3" class="zm-check-c"/><path d="M14 27l8 8 16-17" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="zm-check-p"/></svg>';
    const mark = h('div', { class: 'ob-hero-ico ok' }); mark.innerHTML = svg;        // static literal
    const code = recovery ? h('div', { class: 'ob-recovery' }, h('b', { text: 'Your recovery code' }), h('div', { class: 'zm-code', text: recovery }),
      h('small', { text: 'Save it somewhere safe. It is shown only once and lets you sign back in on a new phone or after clearing your browser.' }),
      (() => { const c = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Copy code' }); c.addEventListener('click', () => { try { navigator.clipboard.writeText(recovery); U.toast('Recovery code copied.', 'success'); } catch (e) {} }); return c; })()) : null;
    done.replaceChildren(mark,
      h('h2', { class: 'ob-title', text: 'You\'re all set, ' + profile.name.split(' ')[0] + '!' }),
      h('p', { class: 'ob-sub', text: offline ? 'You are offline or the server is busy. Everything is saved on this device and will sync automatically.' : 'Your study space is ready. Let\'s build that streak.' }),
      h('div', { class: 'ob-summary' }, [[profile.exam, 'bullseye'], [profile.targetDate ? new Date(profile.targetDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date: later', 'calendar-days'], [profile.goal + ' h / day', 'fire']].map(c => h('span', { class: 'ob-pill' }, ico(c[1]), ' ' + c[0]))),
      code, start);
    done.classList.add('show');
    setTimeout(() => Z.confetti(160), 250);
  }

  function enterApp() {
    const ov = $('loginOverlay'); ov.classList.remove('show'); ov.style.display = 'none';
    $('mainAppContent').style.display = 'flex';
    setUserGreeting(); initApp();
  }

  /* --------------------------------------------------------------- mount */
  function begin() { build(); if (!root) return; if (!root.classList.contains('ready')) { setTimeout(showMain, 1900); } }
  const ov = $('loginOverlay');
  if (ov) {
    new MutationObserver(() => { if (ov.classList.contains('show')) begin(); }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    if (ov.classList.contains('show')) begin();
  }
})();
