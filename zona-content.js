/* =====================================================================
   Zona Occludens: content modules (loaded AFTER the main inline script)
   ---------------------------------------------------------------------
   Strategy  : "Last 40 Days Topper Strategy", adapts to NEET PG / INICET / FMGE / UPSC CMS
   Syllabus  : subject-wise accordion built from the exam blueprint + your Topic Library
   To change advice, edit the STRATEGY / HIGH_YIELD objects only. The rendering code is generic.
   ===================================================================== */
(function () {
  'use strict';
  const Z = window.Zona, U = Z.util, h = U.h, ico = U.ico, $ = U.$;
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parse = s => new Date(s + 'T00:00:00');
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const pretty = s => parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  /* ================================================================ STRATEGY */
  const DAILY_RHYTHM = [
    ['book-open', 'Block 1 · Revise (≈3 h)', 'One subject from your own notes / RR material. Active recall, cover and retrieve. No new resources.'],
    ['bullseye', 'Block 2 · Practise (≈2 h)', 'Timed subject-wise MCQs, then review every question, right or wrong.'],
    ['triangle-exclamation', 'Block 3 · Repair (≈1.5 h)', 'Mistake Notebook, images, tables, drug lists. Fix what the MCQs exposed.'],
    ['moon', 'Block 4 · Recall (30 min)', 'Write ten things you remember from today, then plan tomorrow. Sleep 7+ hours.']
  ];

  // [daysBeforeExam, kind, title, note]   kind: GT = full-length, SWT = subject test, Light = confidence check
  const STRATEGY = {
    'NEET PG': {
      icon: 'stethoscope', pattern: '180 MCQs · +4 correct / −1 wrong · computer-based',
      summary: 'Negative marking rewards disciplined guessing. The paper is clinical-heavy: Medicine, Surgery, OBG, Paediatrics and PSM carry nearly half of it.',
      weeks: [
        { to: 40, from: 34, title: 'Heavy clinical I', subjects: ['General Medicine', 'General Surgery'], focus: ['Revise Medicine system-by-system (cardio, endocrine, nephro, neuro, infections), then Surgery.', 'Last 10 years of PYQs per topic before moving on.', 'Lock topics only when you got them right in your last two attempts.'] },
        { to: 33, from: 27, title: 'Heavy clinical II', subjects: ['OBG', 'Pediatrics', 'Community Medicine'], focus: ['OBG and Paediatrics from RR notes; PSM national programmes, vaccines and biostatistics as tables.', 'Daily 40-60 timed MCQs on the subject of the day.', 'Add every miss to the Mistake Notebook with the micro-topic.'] },
        { to: 26, from: 20, title: 'Para-clinical sweep', subjects: ['Pathology', 'Pharmacology', 'Microbiology'], focus: ['Image-based PYQs for Path (histology, smears) and Micro (stains, cultures).', 'Pharmacology as drug-class tables: mechanism, adverse effect, interaction.', 'One subject test at the end of the week.'] },
        { to: 19, from: 13, title: 'Short subjects + pre-clinical', subjects: ['ENT', 'Ophthalmology', 'Forensic Medicine', 'Orthopedics', 'Dermatology', 'Psychiatry', 'Anesthesia', 'Radiology', 'Anatomy', 'Physiology', 'Biochemistry'], focus: ['Short subjects give fast marks: finish one per day with 30 MCQs.', 'Pre-clinical rapid pass: neuroanatomy, embryology, graphs, pathways, vitamins.', 'Re-test your weakest three subjects from the mocks.'] },
        { to: 12, from: 8, title: 'Weak-area repair', subjects: [], focus: ['Take your 10 weakest micro-topics from each mock and fix them one by one.', 'Mixed-subject timed blocks of 50 Qs to rebuild switching speed.', 'Images, algorithms, national guidelines, drug and programme tables.'] }
      ],
      order: [
        ['Tier 1 · highest yield per hour (D-40 → D-27)', ['General Medicine', 'General Surgery', 'OBG', 'Pediatrics', 'Community Medicine']],
        ['Tier 2 · para-clinical (D-26 → D-20)', ['Pathology', 'Pharmacology', 'Microbiology']],
        ['Tier 3 · short subjects + pre-clinical (D-19 → D-13)', ['ENT', 'Ophthalmology', 'Forensic Medicine', 'Orthopedics', 'Dermatology', 'Psychiatry', 'Anesthesia', 'Radiology', 'Anatomy', 'Physiology', 'Biochemistry']]
      ],
      mocks: [[38, 'GT', 'Baseline full-length mock (180 Qs)', 'Sit it like the real exam: timing, interface, no breaks beyond the allowed ones.'], [34, 'SWT', 'Subject test: Medicine + Surgery'], [32, 'GT', 'Full-length mock #2'], [27, 'SWT', 'Subject test: OBG, Paediatrics, PSM'], [26, 'GT', 'Full-length mock #3'], [21, 'SWT', 'Subject test: Path, Pharma, Micro'], [20, 'GT', 'Full-length mock #4'], [15, 'SWT', 'Subject test: short subjects'], [14, 'GT', 'Full-length mock #5'], [10, 'SWT', 'Mixed image-based test'], [8, 'GT', 'Final full-length mock #6', 'Analyse strategy and guess policy, not syllabus. No more big tests after this.'], [3, 'Light', 'Light PYQ set / mini-mock', 'Confidence check only. Do not debate answers.']],
      extra: 'Decide your guess policy now: skip unless you can eliminate to two options, and take the two-option guesses.',
      hy: ['General Medicine', 'General Surgery', 'OBG', 'Pediatrics', 'Community Medicine', 'Pathology', 'Pharmacology', 'Microbiology', 'Short subjects', 'Pre-clinical']
    },
    'INICET': {
      icon: 'hospital', pattern: '200 MCQs · +1 correct / −⅓ wrong · computer-based',
      summary: 'Reference-level detail and images matter more than in NEET PG. A −⅓ penalty makes two-option guesses worth taking.',
      weeks: [
        { to: 40, from: 34, title: 'Clinical core', subjects: ['General Medicine', 'General Surgery'], focus: ['Revise Medicine and Surgery to reference depth: staging systems, criteria, landmark trials, latest guidelines.', 'PYQs plus image/clinical-photo questions for each topic.', 'Tabulate classifications and criteria as you go.'] },
        { to: 33, from: 27, title: 'OBG, Paediatrics, PSM', subjects: ['OBG', 'Pediatrics', 'Community Medicine'], focus: ['OBG and Paediatrics: protocols, thresholds, schedules. PSM: programmes, statistics and study designs.', 'Daily 50 timed MCQs on the subject of the day.', 'Log lucky-rights in the Mistake Notebook too.'] },
        { to: 26, from: 20, title: 'Para-clinical with images', subjects: ['Pathology', 'Pharmacology', 'Microbiology'], focus: ['Histopathology and microscopy images, culture media, stains, life cycles.', 'Pharmacology: mechanisms, adverse effects, newer drugs and monoclonals.', 'One subject test at week end.'] },
        { to: 19, from: 13, title: 'Pre-clinical detail + short subjects', subjects: ['Anatomy', 'Physiology', 'Biochemistry', 'ENT', 'Ophthalmology', 'Forensic Medicine', 'Orthopedics', 'Dermatology', 'Psychiatry', 'Anesthesia', 'Radiology'], focus: ['Anatomy (neuroanatomy, embryology, radiological anatomy), physiology graphs, biochemistry pathways and molecular biology.', 'Short subjects: one per day with image practice.', 'Re-test weakest three subjects.'] },
        { to: 12, from: 8, title: 'Weak-area repair', subjects: [], focus: ['Fix the 10 weakest micro-topics from each mock.', 'Image bank, flowcharts and one-liners: rapid cycles.', 'Mixed blocks of 50 Qs at exam pace.'] }
      ],
      order: [
        ['Tier 1 · clinical core (D-40 → D-27)', ['General Medicine', 'General Surgery', 'OBG', 'Pediatrics', 'Community Medicine']],
        ['Tier 2 · para-clinical (D-26 → D-20)', ['Pathology', 'Pharmacology', 'Microbiology']],
        ['Tier 3 · pre-clinical + short subjects (D-19 → D-13)', ['Anatomy', 'Physiology', 'Biochemistry', 'ENT', 'Ophthalmology', 'Forensic Medicine', 'Orthopedics', 'Dermatology', 'Psychiatry', 'Anesthesia', 'Radiology']]
      ],
      mocks: [[38, 'GT', 'Baseline full-length mock (200 Qs)', 'Real timing. Aim to finish the first pass with 20-25 minutes spare.'], [34, 'SWT', 'Subject test: Medicine + Surgery'], [32, 'GT', 'Full-length mock #2'], [27, 'SWT', 'Subject test: OBG, Paediatrics, PSM'], [25, 'GT', 'Full-length mock #3'], [21, 'SWT', 'Subject test: Path, Pharma, Micro'], [19, 'GT', 'Full-length mock #4'], [15, 'SWT', 'Image-based test'], [13, 'GT', 'Full-length mock #5'], [9, 'SWT', 'Mixed subject test'], [7, 'GT', 'Final full-length mock #6', 'Analyse pace and guess policy, not syllabus.'], [3, 'Light', 'Light PYQ set', 'Confidence check only.']],
      extra: 'Rehearse image questions daily. With −⅓ marking, a two-option guess is positive expected value, so do not leave answerable questions blank.',
      hy: ['General Medicine', 'General Surgery', 'OBG', 'Pediatrics', 'Community Medicine', 'Pathology', 'Pharmacology', 'Microbiology', 'Pre-clinical', 'Short subjects']
    },
    'FMGE': {
      icon: 'globe', pattern: '300 MCQs · two sessions of 150 · no negative marking · pass 150/300',
      summary: 'Breadth wins. With no negative marking you never leave a blank, and the pass mark rewards being solid in every subject.',
      weeks: [
        { to: 40, from: 34, title: 'Community Medicine + Medicine', subjects: ['Community Medicine', 'General Medicine'], focus: ['PSM (~30 Qs) as tables: programmes, vaccines, statistics, nutrition. Then Medicine (~33 Qs) system by system.', 'PYQs after each chapter. 60 MCQs a day.', 'Never skip the Mistake Notebook.'] },
        { to: 33, from: 27, title: 'Surgery, OBG, Paediatrics', subjects: ['General Surgery', 'OBG', 'Pediatrics'], focus: ['Surgery (~32), OBG (~30), Paediatrics (~15): core protocols and classic presentations.', 'One subject test at the end of the week.', 'Keep a running list of weak chapters.'] },
        { to: 26, from: 20, title: 'Pre-clinical', subjects: ['Anatomy', 'Physiology', 'Biochemistry'], focus: ['Anatomy, Physiology and Biochemistry carry ~17 Qs each. Cover high-frequency topics fully before low-frequency ones.', 'Diagrams, graphs, pathways, vitamins and enzymes.', '50 MCQs a day.'] },
        { to: 19, from: 13, title: 'Para-clinical + Forensic', subjects: ['Pathology', 'Pharmacology', 'Microbiology', 'Forensic Medicine'], focus: ['Path, Pharma, Micro (~13 each) and FMT (~10): fast one-liner revision with PYQs.', 'Drug classes, stains, life cycles, BNS sections and toxicology tables.', 'Re-test weakest subjects.'] },
        { to: 12, from: 8, title: 'ENT, Ophthalmology, short subjects + repair', subjects: ['ENT', 'Ophthalmology', 'Orthopedics', 'Dermatology', 'Psychiatry', 'Anesthesia', 'Radiology'], focus: ['ENT and Ophthalmology (~15 each), then 5-mark subjects quickly.', 'Mixed 100-question blocks to build two-session stamina.', 'Repair the lowest-scoring chapters from your mocks.'] }
      ],
      order: [
        ['Tier 1 · highest weight (D-40 → D-27)', ['Community Medicine', 'General Medicine', 'General Surgery', 'OBG', 'Pediatrics']],
        ['Tier 2 · pre-clinical + para-clinical (D-26 → D-13)', ['Anatomy', 'Physiology', 'Biochemistry', 'Pathology', 'Pharmacology', 'Microbiology', 'Forensic Medicine']],
        ['Tier 3 · quick wins (D-12 → D-8)', ['ENT', 'Ophthalmology', 'Orthopedics', 'Dermatology', 'Psychiatry', 'Anesthesia', 'Radiology']]
      ],
      mocks: [[37, 'GT', 'Full mock #1 (300 Qs, 2 × 150)', 'Practise the session break: eat, hydrate, reset. Do not re-litigate session 1.'], [33, 'SWT', 'Subject test: PSM + Medicine'], [29, 'GT', 'Full mock #2'], [25, 'SWT', 'Subject test: Surgery, OBG, Paeds'], [21, 'GT', 'Full mock #3'], [17, 'SWT', 'Subject test: pre-clinical'], [13, 'GT', 'Full mock #4'], [10, 'SWT', 'Subject test: para-clinical + FMT'], [7, 'GT', 'Half-length mock (150 Qs)', 'Last big test. Review for gaps, not for panic.'], [3, 'Light', 'Light PYQ set', 'Confidence check only.']],
      extra: 'No negative marking: answer every single question. Rehearse the two-session, five-hour stamina at least twice.',
      hy: ['Community Medicine', 'General Medicine', 'General Surgery', 'OBG', 'Pediatrics', 'Pre-clinical', 'Pathology', 'Pharmacology', 'Microbiology', 'Short subjects']
    },
    'UPSC CMS': {
      icon: 'landmark', pattern: 'Two papers × 120 MCQs (2 h each) · −⅓ wrong · no calculators',
      summary: 'Each paper is scored separately for qualifying. Paper I is Medicine (96) + Paediatrics (24). Paper II is Surgery, OBG and PSM (40 each).',
      weeks: [
        { to: 40, from: 34, title: 'Paper I · Medicine core', subjects: ['General Medicine'], focus: ['Cardiology, respiratory, GI, renal, neuro, haematology and endocrine, built around the PYTS page.', 'CMS repeats topics heavily: finish the year-wise PYQs per chapter.', '60 MCQs a day, timed.'] },
        { to: 33, from: 27, title: 'Paper I · infections, emergencies, Paediatrics', subjects: ['General Medicine', 'Pediatrics'], focus: ['Tropical medicine, vaccine-preventable diseases, poisoning, snake bite, critical care.', 'Dermatology, psychiatry and musculoskeletal topics inside Medicine.', 'Paediatrics (24 Qs): emergencies, newborn care, milestones, immunisation, programmes.'] },
        { to: 26, from: 20, title: 'Paper II · Surgery', subjects: ['General Surgery', 'ENT', 'Ophthalmology', 'Orthopedics', 'Anesthesia'], focus: ['General surgery systems, urology, neurosurgery, trauma, shock, fluids.', 'ENT, Ophthalmology, Orthopaedics and Anaesthesia are inside the Surgery 40.', 'Subject test at week end.'] },
        { to: 19, from: 13, title: 'Paper II · OBG and PSM', subjects: ['OBG', 'Community Medicine'], focus: ['OBG: antenatal, intranatal, postnatal, gynaecology, family planning, MTP.', 'PSM: epidemiology, statistics, programmes, nutrition, environment.', 'Daily 40 timed MCQs.'] },
        { to: 12, from: 8, title: 'PYTS repair + paper-wise practice', subjects: [], focus: ['Run both papers separately, 2 hours each, on alternate days.', 'Repair weak chapters from the PYTS page and your Mistake Notebook.', 'Practise without a calculator and with −⅓ guess discipline.'] }
      ],
      order: [
        ['Paper I · 120 Qs (D-40 → D-27)', ['General Medicine', 'Pediatrics']],
        ['Paper II · Surgery 40 (D-26 → D-20)', ['General Surgery', 'ENT', 'Ophthalmology', 'Orthopedics', 'Anesthesia']],
        ['Paper II · OBG 40 + PSM 40 (D-19 → D-13)', ['OBG', 'Community Medicine']]
      ],
      mocks: [[38, 'GT', 'Paper I full test (120 Qs · 2 h)', 'Exam conditions, no calculator.'], [37, 'GT', 'Paper II full test (120 Qs · 2 h)'], [30, 'SWT', 'Medicine subject test'], [24, 'SWT', 'Surgery subject test'], [20, 'GT', 'Paper I full test #2'], [19, 'GT', 'Paper II full test #2'], [15, 'SWT', 'OBG + PSM test'], [11, 'GT', 'Paper I full test #3'], [10, 'GT', 'Paper II full test #3'], [6, 'Light', 'PYQ mixed set', 'Confidence check only.'], [3, 'Light', 'Light revision test']],
      extra: 'Pace each paper independently. A weak paper cannot be rescued by the other, so keep both above the cut-off.',
      hy: ['General Medicine', 'Pediatrics', 'General Surgery', 'OBG', 'Community Medicine', 'Short subjects']
    }
  };

  const HIGH_YIELD = {
    'General Medicine': ['Cardiology: ACS, heart failure, valvular lesions, arrhythmias and ECG', 'Endocrine: diabetes and DKA, thyroid, adrenal, pituitary', 'Nephrology: AKI/CKD, nephrotic vs nephritic, electrolytes, acid-base', 'Neurology: stroke, epilepsy, demyelination, neuromuscular disease', 'Infections: TB, HIV, malaria, dengue, enteric fever (national guidelines)', 'Haematology: anaemias, leukaemias, lymphomas, coagulation'],
    'General Surgery': ['Breast, thyroid and parathyroid', 'GI: oesophagus, stomach, hepatobiliary and pancreas', 'Hernia, appendix, intestinal obstruction', 'Trauma (ATLS), burns, shock, fluids', 'Urology: stones, BPH, testicular tumours', 'Vascular disorders and transplantation basics'],
    'OBG': ['Hypertensive disorders, APH and PPH', 'Labour mechanics, partograph, abnormal labour', 'Contraception and MTP Act', 'PCOS, endometriosis, fibroids, infertility', 'Gynae cancers: cervix, ovary, endometrium', 'Ectopic pregnancy and gestational trophoblastic disease'],
    'Pediatrics': ['Growth and developmental milestones', 'Neonatology: resuscitation, jaundice, sepsis', 'Immunisation schedule and IMNCI', 'Congenital heart disease', 'Nutrition: SAM and vitamin deficiencies'],
    'Community Medicine': ['Epidemiology and biostatistics', 'National health programmes (NTEP, NACP, immunisation)', 'Screening, demography, vaccines and cold chain', 'Nutrition, occupational and environmental health'],
    'Pathology': ['Cell injury, inflammation and neoplasia', 'Haematology: anaemia, leukaemia, lymphoma, platelets', 'Immunology and hypersensitivity', 'Systemic: renal, liver, CNS and GI tumours'],
    'Pharmacology': ['Autonomic and cardiovascular drugs', 'Antimicrobials: mechanism and adverse effects', 'Endocrine, anticancer and CNS drugs', 'Pharmacokinetics and drug interactions'],
    'Microbiology': ['Bacteriology: Gram stain, culture media, toxins', 'Virology: hepatitis, HIV, herpes viruses', 'Parasitology life cycles', 'Immunology, vaccines, sterilisation'],
    'Short subjects': ['ENT: ear and larynx lesions, hearing tests', 'Ophthalmology: glaucoma, retina, cornea, neuro-ophthalmology', 'Orthopaedics: fractures, nerve injuries, bone tumours', 'Dermatology: leprosy, bullous and papulosquamous disorders', 'Psychiatry: mood, psychosis, substance use', 'Forensic Medicine: injuries, toxicology, BNS sections', 'Anaesthesia and Radiology: agents, blocks, signs'],
    'Pre-clinical': ['Anatomy: neuroanatomy, embryology, histology and radiological images', 'Physiology: CVS, renal and respiratory graphs', 'Biochemistry: metabolism, vitamins, molecular biology']
  };

  const BLUEPRINT_OF = { 'NEET PG': 'NEET PG', 'INICET': 'INICET Nov', 'FMGE': 'FMGE', 'UPSC CMS': 'UPSC CMS' };
  const S = () => { const s = U.settings(); if (!s.strategy || typeof s.strategy !== 'object') s.strategy = { exam: null, dates: {}, done: {} }; if (!s.strategy.dates) s.strategy.dates = {}; if (!s.strategy.done) s.strategy.done = {}; return s.strategy; };
  const examKeyFromProfile = () => { const e = (U.profile() || {}).exam || ''; return /INICET/i.test(e) ? 'INICET' : /FMGE/i.test(e) ? 'FMGE' : /UPSC/i.test(e) ? 'UPSC CMS' : 'NEET PG'; };
  function defaultDate(exam) {
    const st = S(); if (st.dates[exam] && /^\d{4}-\d{2}-\d{2}$/.test(st.dates[exam])) return st.dates[exam];
    const today = iso(new Date());
    const keys = { 'NEET PG': ['neetpg'], 'INICET': ['inicetNov', 'inicetMay'], 'FMGE': ['fmge'], 'UPSC CMS': ['upsc'] }[exam] || [];
    const future = keys.map(k => EXAM_DATES[k] && EXAM_DATES[k].slice(0, 10)).filter(d => d && d >= today).sort();
    if (future.length) return future[0];
    const p = U.profile();
    if (p && p.targetDate && p.targetDate >= today && examKeyFromProfile() === exam) return p.targetDate;
    return '';
  }

  const Strategy = Z.strategy = {
    render() {
      const root = $('strategyRoot'); if (!root) return;
      const st = S();
      const exam = STRATEGY[st.exam] ? st.exam : examKeyFromProfile();
      st.exam = exam;
      const cfg = STRATEGY[exam];
      const examDate = defaultDate(exam);
      const today = iso(new Date());
      const dLeft = examDate ? Math.round((parse(examDate) - parse(today)) / 864e5) : null;   // days until exam
      const dayOf = n => addDays(examDate, -n);

      /* controls */
      const chips = h('div', { class: 'st-exams', role: 'tablist', 'aria-label': 'Exam type' }, Object.keys(STRATEGY).map(k => {
        const b = h('button', { type: 'button', role: 'tab', class: 'st-chip' + (k === exam ? ' active' : ''), 'aria-selected': k === exam ? 'true' : 'false' }, ico(STRATEGY[k].icon), ' ' + k);
        b.addEventListener('click', () => { st.exam = k; saveData(); Strategy.render(); });
        return b;
      }));
      const dateIn = h('input', { class: 'form-control', id: 'stDate', type: 'date', value: examDate, 'aria-label': 'Exam date', min: today });
      dateIn.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(dateIn.value)) { st.dates[exam] = dateIn.value; saveData(); Strategy.render(); } });

      /* status banner */
      let banner;
      if (!examDate) banner = h('div', { class: 'st-banner warn' }, ico('calendar-plus'), h('div', null, h('b', { text: 'Pick your exam date' }), h('p', { text: 'No upcoming ' + exam + ' date is on file. Enter yours above and the whole 40-day plan will be dated for you.' })));
      else if (dLeft < 0) banner = h('div', { class: 'st-banner warn' }, ico('flag-checkered'), h('div', null, h('b', { text: 'That date has passed' }), h('p', { text: 'Choose your next ' + exam + ' attempt date above.' })));
      else if (dLeft > 40) banner = h('div', { class: 'st-banner info' }, ico('hourglass-start'), h('div', null, h('b', { text: 'The 40-day window opens on ' + pretty(dayOf(40)) }), h('p', { text: dLeft + ' days to go. Use the time to finish your first pass and build your Mistake Notebook. This plan starts at D-40.' })));
      else banner = h('div', { class: 'st-banner ok' }, ico('fire'), h('div', null, h('b', { text: 'You are on D-' + dLeft }), h('p', { text: dLeft === 0 ? 'Exam day. Trust your preparation.' : 'Day ' + (41 - dLeft) + ' of 40. Follow today\'s block below.' })));
      const pct = examDate && dLeft >= 0 ? Math.max(0, Math.min(100, Math.round((40 - Math.min(dLeft, 40)) / 40 * 100))) : 0;

      /* tab bodies */
      const tab = st.tab || 'timeline';
      const tabs = [['timeline', 'Timeline', 'timeline'], ['order', 'Subject order', 'list-ol'], ['mocks', 'Mock schedule', 'file-pen'], ['hy', 'High-yield', 'fire'], ['last7', 'Last 7 days', 'flag-checkered']];
      const tabBar = h('div', { class: 'st-tabs', role: 'tablist' }, tabs.map(t => {
        const b = h('button', { type: 'button', role: 'tab', class: 'st-tab' + (tab === t[0] ? ' active' : ''), 'aria-selected': tab === t[0] ? 'true' : 'false' }, ico(t[2]), h('span', { text: t[1] }));
        b.addEventListener('click', () => { st.tab = t[0]; Strategy.render(); });
        return b;
      }));
      let body;
      if (tab === 'timeline') body = Strategy.timeline(cfg, exam, examDate, dLeft, dayOf);
      else if (tab === 'order') body = Strategy.order(cfg, exam);
      else if (tab === 'mocks') body = Strategy.mocks(cfg, examDate, dLeft, dayOf);
      else if (tab === 'hy') body = Strategy.hy(cfg);
      else body = Strategy.last7(cfg, examDate, dayOf);

      root.replaceChildren(
        h('div', { class: 'glass-card st-hero reveal' },
          h('div', { class: 'st-hero-top' },
            h('div', null, h('h2', { class: 'h2-title' }, ico('trophy'), ' Last 40 Days Topper Strategy'), h('p', { class: 'sub-text', text: cfg.summary })),
            h('div', { class: 'st-date' }, h('label', { for: 'stDate', text: 'Exam date' }), dateIn)),
          chips,
          h('div', { class: 'st-pattern' }, ico('circle-info'), ' ' + cfg.pattern + '. Confirm the final pattern in the official bulletin for your attempt.'),
          banner,
          examDate && dLeft >= 0 && dLeft <= 40 ? h('div', { class: 'st-bar', 'aria-label': pct + '% of the 40-day window done' }, h('i', { style: { width: pct + '%' } })) : null),
        tabBar, h('div', { class: 'st-body' }, body));
    },

    timeline(cfg, exam, examDate, dLeft, dayOf) {
      const st = S();
      const weeks = cfg.weeks.map((w, i) => {
        const key = exam + ':' + i;
        const range = examDate ? pretty(dayOf(w.to)) + ' – ' + pretty(dayOf(w.from)) : 'D-' + w.to + ' to D-' + w.from;
        const current = examDate && dLeft !== null && dLeft <= w.to && dLeft >= w.from;
        const done = !!st.done[key];
        const mark = h('button', { type: 'button', class: 'btn btn-outline btn-sm st-done' + (done ? ' on' : ''), 'aria-pressed': done ? 'true' : 'false' }, ico(done ? 'circle-check' : 'circle'), done ? ' Done' : ' Mark done');
        mark.addEventListener('click', () => { if (done) delete st.done[key]; else { st.done[key] = true; Z.confetti(40); } saveData(); Strategy.render(); });
        return h('article', { class: 'glass-card st-week' + (current ? ' current' : '') + (done ? ' is-done' : '') },
          h('div', { class: 'st-week-head' },
            h('span', { class: 'st-wk-num', text: 'W' + (i + 1) }),
            h('div', null, h('h3', { text: w.title }), h('small', { text: 'D-' + w.to + ' → D-' + w.from + ' · ' + range })),
            current ? h('span', { class: 'st-now', text: 'This week' }) : null, mark),
          w.subjects.length ? h('div', { class: 'st-subjs' }, w.subjects.map(s => h('span', { class: 'st-subj', text: (SUBJECT_EMOJIS[s] || '📘') + ' ' + s }))) : null,
          h('ul', { class: 'st-list' }, w.focus.map(f => h('li', { text: f }))));
      });
      const rhythm = h('div', { class: 'glass-card st-rhythm' }, h('h3', null, ico('clock'), ' Daily rhythm (every day, D-40 to D-8)'),
        h('div', { class: 'st-rhythm-grid' }, DAILY_RHYTHM.map(r => h('div', { class: 'st-rh' }, ico(r[0]), h('b', { text: r[1] }), h('p', { text: r[2] })))));
      const finale = h('article', { class: 'glass-card st-week finale' }, h('div', { class: 'st-week-head' }, h('span', { class: 'st-wk-num', text: '7' }), h('div', null, h('h3', { text: 'Last 7 days: lock and calm' }), h('small', { text: examDate ? pretty(dayOf(7)) + ' – ' + pretty(dayOf(1)) : 'D-7 to D-1' }))), h('p', { class: 'st-note', text: 'No new resources. See the "Last 7 days" tab for the day-by-day plan.' }));
      return h('div', { class: 'st-stack' }, rhythm, weeks, finale, h('p', { class: 'st-note', text: cfg.extra }));
    },

    order(cfg, exam) {
      const bp = EXAM_WEIGHTAGES[BLUEPRINT_OF[exam]] || { subjects: {}, max: 0 };
      const sum = Object.values(bp.subjects).reduce((a, b) => a + b, 0) || 1, k = bp.max / sum;
      return h('div', { class: 'st-stack' }, cfg.order.map((t, i) => h('article', { class: 'glass-card st-tier' },
        h('div', { class: 'st-week-head' }, h('span', { class: 'st-wk-num', text: String(i + 1) }), h('h3', { text: t[0] })),
        h('ol', { class: 'st-order' }, t[1].map(s => {
          const w = bp.subjects[s];
          return h('li', null, h('span', { text: SUBJECT_EMOJIS[s] || '📘' }), h('b', { text: s }), w ? h('small', { text: '~' + Math.round(w * k) + ' Qs' }) : null);
        })))));
    },

    mocks(cfg, examDate, dLeft, dayOf) {
      const today = iso(new Date());
      const rows = cfg.mocks.map(m => {
        const d = examDate ? dayOf(m[0]) : null;
        const past = d && d < today, isToday = d === today;
        const tag = { GT: 'Full-length', SWT: 'Subject test', Light: 'Light' }[m[1]];
        return h('li', { class: 'st-mock ' + m[1].toLowerCase() + (past ? ' past' : '') + (isToday ? ' today' : '') },
          h('span', { class: 'st-mock-d' }, h('b', { text: 'D-' + m[0] }), h('small', { text: d ? pretty(d) : '' })),
          h('div', null, h('b', { text: m[2] }), m[3] ? h('p', { text: m[3] }) : null), h('span', { class: 'st-tag', text: tag }));
      });
      return h('div', { class: 'st-stack' },
        h('ol', { class: 'glass-card st-mocks' }, rows),
        h('div', { class: 'glass-card st-note-card' }, h('b', { text: 'How to use a mock' }), h('ul', { class: 'st-list' }, [
          'Review takes as long as the test: every wrong, lucky-right and skipped question goes into the Mistake Notebook.',
          'Log each test in "Enter Test Data" so your accuracy trend and XP stay up to date.',
          'Compare mock-to-mock on pace, accuracy and negative marks, not on rank.',
          'Fill gaps between mocks with 2-3 subject-wise tests (SWT), never with new books.'].map(t => h('li', { text: t })))));
    },

    hy(cfg) {
      return h('div', { class: 'st-stack' },
        h('p', { class: 'st-note', text: 'High-yield areas to protect first. Treat these as a minimum list: if time is short, keep these and drop the rest.' }),
        cfg.hy.map((k, i) => h('details', { class: 'acc glass-card', open: i === 0 ? true : null },
          h('summary', null, h('span', { class: 'acc-t' }, (SUBJECT_EMOJIS[k] || '🔥') + ' ' + k), ico('chevron-down', 'chev')),
          h('ul', { class: 'st-list' }, (HIGH_YIELD[k] || []).map(t => h('li', { text: t }))))));
    },

    last7(cfg, examDate, dayOf) {
      const plan = [
        [7, 'One full mock under exam conditions. Triage the result: list your 10 weakest micro-topics from the Mistake Notebook. No new resources from here on.'],
        [6, 'RR pass on the heavy subjects (Medicine, Surgery, OBG, Paediatrics, PSM). 60 mixed MCQs.'],
        [5, 'RR pass on Pathology, Pharmacology, Microbiology plus image-based PYQs for these. Review the weak list from D-7.'],
        [4, 'RR pass on short subjects (ENT, Ophthalmology, FMT, Ortho, Derm, Psych, Anaesthesia, Radiology). One subject-wise test.'],
        [3, 'Pre-clinical rapid pass (Anatomy, Physiology, Biochemistry) and one last mock. Review only, no debating answers.'],
        [2, 'Mistake Notebook, formulae, tables, drug lists, national programmes. Stop by evening and take a 30-minute walk.'],
        [1, 'Light revision of locked 🔒 topics only (max 3 hours). Pack your bag, verify the route, sleep early. No new topics, no mocks.']
      ];
      return h('div', { class: 'st-stack' },
        h('div', { class: 'glass-card st-plan7' }, plan.map(p => h('div', null, h('b', { text: 'D-' + p[0] + (examDate ? ' · ' + pretty(dayOf(p[0])) : '') }), h('span', { text: p[1] })))),
        h('div', { class: 'glass-card st-note-card' }, h('b', null, ico('lightbulb'), ' ' + ' For this exam'), h('p', { text: cfg.extra })),
        h('div', { class: 'glass-card st-note-card' }, h('b', null, ico('clipboard-check'), ' Exam-day checklist'), h('ul', { class: 'st-list' }, [
          'Admit card (two printouts) and original photo ID. Leave electronics and notes behind.',
          'Reach the centre 60-90 minutes before reporting time, with a backup route planned.',
          'Spend the first two minutes on instructions and the interface, then run the passes: sure answers, mark-and-return, educated guesses.',
          'Check the clock at fixed milestones. Change an answer only for a concrete reason.'].map(t => h('li', { text: t })))));
    }
  };

  /* ================================================================ SYLLABUS */
  const EXAM_FACTS = {
    'NEET PG': ['180 MCQs', '+4 correct / −1 wrong', 'Computer-based, 5 sections. NBEMS publishes no subject-wise split, so the question counts below are estimates. Confirm rules in the bulletin.'],
    'INICET Nov': ['200 MCQs', '+1 correct / −⅓ wrong', 'Computer-based (AIIMS). Detailed, reference-level facts and images.'],
    'FMGE': ['300 MCQs', 'No negative marking', 'Two sessions of 150 questions. Pass mark 150/300 (50%).'],
    'UPSC CMS': ['2 papers × 120 MCQs', '−⅓ wrong · no calculators', 'Paper I: Medicine 96 + Paediatrics 24. Paper II: Surgery, OBG, PSM (40 each). Then a 100-mark personality test.']
  };
  const Syllabus = Z.syllabus = {
    exam: 'NEET PG', q: '',
    render() {
      const root = $('syllabusRoot'); if (!root) return;
      const exam = Syllabus.exam, bp = EXAM_WEIGHTAGES[exam];
      const sum = Object.values(bp.subjects).reduce((a, b) => a + b, 0) || 1, k = bp.max / sum;
      const topics = {}; Object.entries(state.masterTopics || {}).forEach(([id, t]) => { (topics[t.subject] = topics[t.subject] || []).push(t); });
      const q = Syllabus.q.trim().toLowerCase();
      const subjects = Object.entries(bp.subjects).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);

      const sel = h('select', { class: 'form-control sy-sel', 'aria-label': 'Exam' }, Object.keys(EXAM_FACTS).map(e => h('option', { value: e, selected: e === exam ? true : null, text: e })));
      sel.addEventListener('change', () => { Syllabus.exam = sel.value; Syllabus.render(); });
      const search = h('input', { class: 'form-control sy-search', type: 'search', placeholder: 'Search subject or topic…', value: Syllabus.q, 'aria-label': 'Search syllabus', maxlength: 60 });
      search.addEventListener('input', U.debounce(() => { Syllabus.q = search.value; Syllabus.render(); const s2 = $('syllabusRoot').querySelector('.sy-search'); if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); } }, 220));
      const f = EXAM_FACTS[exam];
      const facts = h('div', { class: 'sy-facts' }, h('div', null, h('small', { text: 'Questions' }), h('b', { text: f[0] })), h('div', null, h('small', { text: 'Marking' }), h('b', { text: f[1] })), h('p', { text: f[2] }));

      let shown = 0;
      const accs = subjects.map(([subj, w], i) => {
        const list = (topics[subj] || []).slice().sort((a, b) => String(a.topic).localeCompare(String(b.topic)));
        const match = !q || subj.toLowerCase().indexOf(q) > -1 || list.some(t => String(t.topic).toLowerCase().indexOf(q) > -1);
        if (!match) return null; shown++;
        const rows = list.filter(t => !q || subj.toLowerCase().indexOf(q) > -1 || String(t.topic).toLowerCase().indexOf(q) > -1);
        const done = list.filter(t => t.completed).length, pct = list.length ? Math.round(done / list.length * 100) : 0;
        const qs = Math.round(w * k * 10) / 10;
        return h('details', { class: 'acc glass-card sy-acc', open: q ? true : null },
          h('summary', null,
            h('span', { class: 'acc-t' }, h('span', { class: 'sy-emo', text: SUBJECT_EMOJIS[subj] || '📘' }), h('b', { text: subj })),
            h('span', { class: 'sy-meta' }, h('span', { class: 'sy-q', text: '~' + qs + ' Qs' }), h('span', { class: 'sy-pct', text: pct + '%' })),
            ico('chevron-down', 'chev')),
          h('div', { class: 'sy-prog', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } })),
          rows.length ? h('ul', { class: 'sy-topics' }, rows.map(t => h('li', { class: t.completed ? 'done' : '' },
            h('span', { class: 'sy-tn', text: t.topic }),
            h('span', { class: 'sy-tags' }, ['r1', 'r2', 'r3'].map(r => h('i', { class: 'sy-tag' + (t[r] ? ' on' : ''), text: r.toUpperCase() })), t.completed ? h('i', { class: 'sy-tag lock on', text: '🔒' }) : null)))) :
            h('p', { class: 'st-note', text: 'No topics in your library for this subject yet.' }));
      }).filter(Boolean);

      root.replaceChildren(
        h('div', { class: 'glass-card sy-hero reveal' },
          h('h2', { class: 'h2-title' }, ico('scale-balanced'), ' Syllabus & Weightage'),
          h('p', { class: 'sub-text', text: 'Subject-wise breakdown with the estimated number of questions and your own progress per topic.' }),
          h('div', { class: 'sy-controls' }, sel, search), facts),
        accs.length ? h('div', { class: 'sy-list' }, accs) : h('div', { class: 'empty-state' }, h('div', { class: 'es-title', text: 'No subject matches "' + Syllabus.q + '"' })));
    }
  };
})();
