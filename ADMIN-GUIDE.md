# Admin guide

## 1. Sign in
* Open **`https://<your-github-username>.github.io/<repo>/admin.html`** (or add `#admin` to the app address). The page is deliberately not linked from the app.
* Enter the **admin PIN**. It is whatever you put in `CFG.ADMIN_PIN` in `code.gs` before running `setupZona()`.
  To change it: edit `CFG.ADMIN_PIN`, run `setupZona()` again.
* 5 wrong PINs lock admin login for 15 minutes (and ping your Telegram). The panel locks itself after 15 idle minutes.
* If the page says *API key mismatch*, *old code.gs* or *cannot reach the backend*, the problem is setup, not the PIN. See "Setup problems" below.

## 2. What you can see
| Section | Shows |
|---|---|
| Tiles | Total users, active in 24 h, active in 7 days, signups today |
| Charts | New users per day (14 days), users per exam |
| Users table | Name, mobile, exam, rank, XP, last seen, logins, status. Search and click headers to sort |
| Row buttons | Activity log · Reset device · Block/Unblock · Delete |
| Broadcast | Sends an in-app announcement to everyone (shown on their next app open) |
| Export | JSON or CSV of the users list |
| Security events | Wrong PINs, rate limits, device mismatches, tamper attempts, honeypot hits |

## 3. Looking at the raw data
Open the Google Sheet. Tabs: `Users_DB`, `Activity`, `Security`, `Broadcasts`, and per user `State_<mobile>` (encrypted), `Topics_<mobile>`, `Backup_<mobile>`.

## 4. Telegram (optional)
Message your bot from the admin chat: `/stats`, `/users`, `/security`, `/broadcast <text>`, `/resetdevice <mobile>`.

## 5. Common support cases
* **Student switched phone / cleared the browser and is locked out:** they enter their recovery code on the sign-in screen ("I already have an account"). If they lost it, press *Reset device* on their row (or `/resetdevice <mobile>`); their next sign-in binds the new device and shows a fresh code.
* **Suspicious account:** Block it, then check its Activity log.

## 6. Setup problems
Open the app → tap the **sync pill** in the header (or Settings → *Connection check*). It tells you which of these is wrong:
1. `API_KEY` in `zona-config.js` is still `CHANGE_ME…` or differs from `CFG.API_KEY`.
2. The Apps Script is still the old `code.gs` (paste the new one and use Deploy → Manage deployments → Edit → **New version**).
3. `setupZona()` was never run.
4. The web app is not deployed with "Who has access: Anyone", or `API_URL` is wrong.
