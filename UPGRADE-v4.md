# Zona Occludens v4: what is new and how to upgrade

Everything from v3 is still here and works the same way: planner, MCQ practice, subject progress, topic library, MedNotes, guidelines, quick test log, Test Records, Mistake Notebook, upcoming tests, rewards/shop/streak repair, leaderboard, broadcasts, device binding, encryption, admin panel and Telegram bot. v4 only **adds**.

## Upgrade in 3 steps (about 5 minutes)

1. **Backend.** Apps Script editor → replace `Code.gs` with the new `code.gs` → *Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy*. The `/exec` URL stays the same.
   **Do not** run `setupZona()` again (it is harmless, but not needed) and **never** change `DATA_KEY`.
2. **Frontend.** Upload every file of this folder to your GitHub Pages repo (overwrite). `zona-config.js` is unchanged; keep yours.
3. Open the app once. Existing tests get permanent Test IDs (`ZO-YYYYMMDD-NNN` from the test date), old notebook entries get mistake IDs and start at *R1 pending*. Nothing is deleted. `Users_DB` gains 4 columns automatically.

Old v3 browsers keep syncing with the v4 backend, and the v4 app keeps working with a v3 backend (only the "server check" tools need v4).

## New pages (sidebar)

| Section | Page | What it does |
|---|---|---|
| Exams & Tests | **Detailed Test Log** | Central module. Test category (GT/SWT/Mock/Daily/Custom), exam format (sets marking scheme), optional manual Test ID (unique) or automatic one, provider, times → duration, marks/negative marking → automatic score, total questions/attempted/correct/incorrect with live % tiles, **subject-wise rows** (add one, several or all 19) that must reconcile with the overall numbers unless you tick "incomplete", and **mistakes added inside the test** (subject, topic, subtopic, Q no., category, priority, reason, correct concept, explanation, notes). Draft autosaves on the device; "Save draft" syncs it. |
| | **Test History** | Card per test: ID, accuracy ring, numbers, mistakes, R1/R2/R3 progress bar. Search by ID/name/provider; filter by category, format, dates. |
| | Test Record (opens from a card) | The full original record: details, subject table, doughnut, mistakes of this test only grouped by subject, edit / export / delete. |
| | **Mistake Log & Revision** | Global view of every mistake (incl. the old notebook). 8 R1/R2/R3 tiles, 11 filters, edit, delete, revise. |
| Analytics | **Test Trends** | 8 charts + test-by-test table with running weighted accuracy. |
| | **Subject Analytics** | Radar, accuracy bars, full subject table, mistake heatmap, most-missed topics. |
| | **Weightage Predictor** | Per exam: app blueprint, *your own* figures, and estimates from *your own* GT/Mock subject breakdowns (clearly labelled; no "official" numbers). High-yield and weak-area flags, projected correct. The old Dashboard predictor is unchanged. |
| | **Reports & Exports** | 9 exports, each as PDF, Excel or CSV: one test, test history, subjects, mistake log, revision history, planner, monthly planner, MCQ practice, overall report. Backup/restore shortcuts. *Verify my analytics with the server* and *Recent sync log*. |

## Upgrades to existing pages

* **Dashboard:** a "Test performance analytics" block under the existing widgets: test-type / format / date filters, 14 tiles, 10 charts (accuracy progression, individual accuracy, attempt %, correct vs incorrect, subject radar, GT vs SWT vs Mock, weekly, monthly, R1/R2/R3 progress, mistake reduction), subject × category mistake heatmap, planner calendar heatmap, upcoming tests, activity streaks.
* **Upcoming Tests:** time, provider, subjects, priority, status (Scheduled/Completed/Missed/Cancelled), a **Log** button that opens the Detailed Test Log pre-filled; the ticker only shows tests still scheduled, with a day count.
* **Quests & Rewards:** four activity streaks (combined, MCQ, revision, tests) with 30-day strips, and the test/revision XP table. Each reward is paid once per item.
* **Log a Test / Test Records / Mistake Notebook:** unchanged, with a small pointer to the new pages. They share the same data, so a quick-logged test appears in every analytic, and mistakes made in a test appear in the notebook.
* Keyboard: `g l` Detailed Test Log, `g h` Test History, `g e` Mistake Log & Revision.

## How the numbers are calculated

* **Test accuracy** = correct ÷ attempted for that test only (N/A when nothing was attempted).
* **Overall cumulative accuracy is weighted**: total correct ÷ total attempted across the selected tests, not the average of the test percentages.
* Revision is strictly R1 → R2 → R3. A completion date cannot be in the future. Reopening is allowed (last completed stage first) and every action is appended to the mistake's history; notes are never overwritten.
* Test IDs are permanent and never reused, even after a delete. If two offline devices produce the same automatic ID, the later test gets the next free one after sync.
* The same engine file (`zona-tracker-engine.js`) is embedded at the bottom of `code.gs`, so the app and the server always compute identical figures. If you edit one copy, edit the other.

## Backend additions (code.gs v4)

* New user actions: `analytics`, `weightage`, `report`, `testReport`, `trackerSummary`, `syncLog`.
* `save` accepts an operation ID; a retried request with the same ID is answered from cache and not written twice. Confirmed saves are logged in the new `SyncLog` sheet.
* Each save fills `Users_DB` → *Tests, Mistakes, Accuracy %, Pending Revisions* and trims oversized fields. All data stays encrypted at rest as before.
* Returning-user sign-in on a new browser ("I already have an account") now works end-to-end: the server returns the stored profile and never overwrites it.
* Admin: `adminUserAnalytics`, `adminUserReport` (tests/subjects/overall only, audited); stats include tests, mistakes, pending revisions. Telegram: `/user <mobile>`.
* Account deletion also scrubs the `SyncLog`.

## Notes

* PDF and Excel export load their library from cdnjs the first time (needs internet); CSV always works offline.
* Data volume: everything still lives in one encrypted state per student. Thousands of tests and tens of thousands of mistakes fit comfortably; caps of 5,000 tests / 20,000 mistakes protect the sheet.
