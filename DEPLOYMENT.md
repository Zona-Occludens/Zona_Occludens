# Zona Occludens v3: deployment notes

## What goes where

| File | Where it lives | Purpose |
|---|---|---|
| `code.gs` | Google Apps Script (bound to your Sheet) | Backend: auth, sync, encryption, admin API, Telegram bot |
| `index.html`, `mednotes.html`, `guidelines.html`, `admin.html` | GitHub Pages | Pages |
| `zona-config.js` | GitHub Pages | **The only frontend file you edit** (API URL + API key) |
| `zona-core.js`, `zona-boot.js`, `zona-planner.js`, `zona-content.js`, `zona-onboarding.js` | GitHub Pages | App modules |
| `guidelines.js`, `admin.js`, `theme-boot.js` | GitHub Pages | Scripts for the standalone pages |
| `zona-themes.css`, `zona-upgrade.css` | GitHub Pages | Themes + new UI |
| `favicon.png` | GitHub Pages | Icon |

Upload **all** of these to the same folder of the repo.

## 1. Backend (10 minutes)

1. Open your Google Sheet → Extensions → Apps Script. Replace the contents of `Code.gs` with `code.gs`.
   Project Settings must show the **V8** runtime (the default).
2. Edit the `CFG` block at the top:
   * `API_KEY`: a long random string (40+ chars). You will paste the same value into `zona-config.js`.
   * `ADMIN_PIN`: 8+ characters. Used only for the admin panel. It is checked on the server and never appears in any HTML.
   * `TELEGRAM_BOT_TOKEN` / `ADMIN_CHAT_ID`: optional (see step 4).
3. In the editor choose the function **`setupZona`** → Run. Approve the permissions (Sheets, external requests).
   It moves the secrets into Script Properties and generates the signing/encryption keys.
   After it succeeds you can blank the values in `CFG`.
   **Never delete or regenerate `DATA_KEY`**: data encrypted with it becomes unreadable.
4. Deploy → New deployment → Web app → *Execute as: Me*, *Who has access: Anyone* → copy the `/exec` URL.
   After later code changes use Deploy → Manage deployments → Edit → New version (the URL stays the same).

### Optional: Telegram admin bot
1. Create a bot with @BotFather and copy the token. Get your numeric chat id (message @userinfobot).
2. Put both into `CFG`, run `setupZona` again, then run **`setTelegramWebhook`** once (after deploying). The log should show `{"ok":true,...}`.
3. Message your bot from your own account: `/stats`, `/users`, `/security`, `/broadcast <message>`, `/resetdevice <mobile>`.
   Any other chat is ignored and written to the `Security` sheet.

### Optional: clean up the old matchmaking columns
Run **`purgeLegacyMatchmaking`** once to delete the old `TG Username` and `Matched Partner TG` columns from `Users_DB`.
Existing rows and per-user sheets keep working; plaintext rows are re-encrypted automatically the next time each user syncs.

## 2. Frontend

1. Edit `zona-config.js`: set `API_URL` to the new `/exec` URL and `API_KEY` to the value from `CFG`.
2. Commit and push everything. Admin panel: `https://<you>.github.io/<repo>/admin.html` (or `index.html#admin`). It is not linked anywhere.

## 3. Smoke test (use a private/incognito window)

1. Complete onboarding. A row appears in `Users_DB`, and a `State_<mobile>` sheet appears whose cells start with `enc1:`.
2. Add a planner target. The header pill goes *Unsynced → Syncing → Synced*.
3. Switch the phone to airplane mode, add a target (pill: *Offline*), reconnect (pill: *Synced*).
4. Open `admin.html`, sign in with the PIN, check the tiles, send a test broadcast, then reopen the app to see it.
5. Settings → Delete account (type `DELETE`). The user's row and sheets disappear.

## Behaviour you should know about

* **Accounts are bound to a device.** The first browser that registers a mobile number owns it. A different device must enter the one-time **recovery code** shown at sign-up (existing users see theirs once, on their first v3 visit). If a student loses it, use the admin panel (reset device) or `/resetdevice <mobile>` in Telegram. This is what stops someone who merely knows a phone number from reading that student's data.
* **Sessions** are signed tokens that expire after 12 h. The app locks itself after 15 idle minutes (changeable in Settings) and asks for the mobile number to resume.
* **Offline**: every change is saved on the device immediately and synced when possible; unsynced local edits are never overwritten by the cloud copy.
* **NEET PG is now 180 questions everywhere.** INICET stays 200. Predictor weights are scaled so they always add up to the paper size.
* **Exam dates**: edit `EXAM_DATES` and `COUNTDOWN_META` in `index.html` when new cycles are announced; finished exams disappear from the dashboard by themselves. Please verify the dates against the official bulletins, they were carried over from your previous version.

## Honest limits of this architecture

* Everything in a GitHub Pages site is public, including `API_KEY`. It only blocks casual abuse. The real protection is server-side: signed tokens, device binding, rate limits, encryption at rest and the audit sheets.
* Apps Script cannot read the caller's IP or `Origin`, and cannot set CORS headers. Domain-locking and per-IP rate limiting are therefore not possible there. Rate limits are per user / per mobile number.
* The Content-Security-Policy still needs `'unsafe-inline'` for scripts because the original app uses inline `onclick` handlers. All user-supplied text is escaped, and all new code builds the DOM with `textContent`.
* Data in the browser (localStorage) is not encrypted; encryption protects the copy in Google Sheets. Anyone who can edit the Apps Script project can read Script Properties, exactly as anyone who can open the Sheet can read the Users sheet.
* This code was tested against a faithful mock of the Apps Script services and in real browsers, **not** on Google's runtime. Run the smoke test above after deploying.

## If sync / sign-in / leaderboard "do not work"
Tap the **sync pill** in the app header (or Settings → *Connection check*). It tests the link step by step and names the cause. The usual ones:
1. `code.gs` was pasted but **not redeployed**: Deploy → Manage deployments → pencil → Version: **New version** → Deploy. (Saving the script is not enough; the old version keeps answering.)
2. `API_KEY` in `zona-config.js` still says `CHANGE_ME…` or differs from `CFG.API_KEY`, or `setupZona()` was not run after editing it.
3. Web app access is not "Anyone", or `API_URL` is wrong.

See **ADMIN-GUIDE.md** for the admin panel (sign-in, stats, support cases).
