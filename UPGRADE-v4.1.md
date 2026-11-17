# Zona Occludens v4.1: AKTrack v1.1 interface

v4.1 brings the AKTrack v1.1 look, dashboard, daily planner and settings into Zona. Every v3 / v4 feature is still here; nothing was deleted.

## Upgrade (same 3 steps as v4)

1. **Backend:** replace `Code.gs` with the new `code.gs` → *Deploy → Manage deployments → Edit → Version: New version → Deploy*. Do **not** change `DATA_KEY`.
2. **Frontend:** upload every file of this folder to your GitHub Pages repo (keep your own `zona-config.js`). New files: `zona-aktrack.js`, `zona-aktrack.css`.
3. Open the app once. Defaults are filled in (INICET 09 May 2027, planner 15 Nov 2026 → 01 Sep 2027, 8 h, 100 MCQs, 200 + 200 questions). Change them in **Settings → Account & examination goals**.

## What is new

| Where | What |
|---|---|
| Whole app | **AKTrack interface** (on by default): AKTrack dark `#120A2F` and light `#F3F1FC` palettes, colour-tiled sidebar icons, gradient brand, AKTrack buttons/cards, and a bottom bar on phones (Home · Planner · Log test · Mistakes · Settings). *Settings → Appearance* has **Switch to light/dark mode** and **AKTrack interface: On/Off** (Off = the classic Zona look). All 5 themes remain. |
| Dashboard | Top row: **INICET countdown**, **NEET PG countdown** (or "Exam date not set" + button), **Current study streak** (MCQ / Revision / Test / daily). Second row: **Today's goal completion** ring (planner tasks + classic targets, daily hours, MCQs today vs target), **Total XP** with rank bar, **Total coins**. The full AKTrack analytics (filters, 14 tiles, 10 charts, mistake heatmap, planner heatmap, upcoming tests) now sit directly under the heroes; the older Zona widgets follow below. |
| **Daily Planner** (new page) | AKTrack task planner: 4 stats (planner days, tasks planned, completed, missed), **Daily cards** with a ±7-day strip and progress bar, **Weekly overview** (7 cards with rings), **Monthly calendar** (done bars), **All tasks & search** (status, priority tag, missed only). Task fields: date, subject, topic, subtopic (autocomplete), study target, hours, MCQ target, MCQs done, revision target, Grand Test target, priority tag (High Yield / Needs Revision / Must Revise / Weak Topic / Completed), status (Not Started / In Progress / Completed / Postponed), remarks. **Mark completed**, **Reschedule** (original kept as *Postponed*, copy shows "Moved from"), edit, delete, **Change planner period**, **Export** (PDF / Excel / CSV). XP once per completed task, a bonus once per fully completed day. |
| Classic Planner | Renamed in the sidebar, unchanged otherwise. It now follows the planner period from Settings; a day that already holds targets or notes is never hidden. Its targets are shown read-only on the matching Daily Planner day. |
| **Settings** | **Account & examination goals**: your name, INICET date, NEET PG date, planner start / end (max 1100 days), daily study goal (h), daily MCQ target, INICET / NEET PG total questions; time zone and app version. **Subject list**: order, name, short name, colour, active; add subjects; rename or hide (never delete); old tests keep their saved subject names. **Topic library**: pick a subject → every syllabus topic is preloaded (plus custom topics, mistake topics and planner topics), add your own topic / subtopic, search, remove your own entries. |
| Everywhere | Active subjects (in your order) feed the Detailed Test Log, Mistake Log filters and the planner. Topic / subtopic autocomplete includes your library. The Weightage Predictor uses the paper sizes from Settings. Upcoming Tests shows countdown heroes. The ticker starts with the exam countdowns. Completed tasks count for the study streak, MCQs done in a task for the MCQ streak. |

## Data (inside the same encrypted state, synced as before)

`state.akSettings`, `state.akSubjects`, `state.plannerTasks`, `state.topicLibrary`. `code.gs` validates and size-caps them on every sync (`ZTE.cleanAk`) and the planner report includes the tasks.

## Tests run on this build

Engine 18 groups · code.gs (on an Apps Script mock) 12 groups · browser regression 73/73 · v4.1 browser suite 65/65 (desktop + mobile, light + dark, sync + reload, no JavaScript errors) · admin panel · visual / mobile overflow.
