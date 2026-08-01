# Telegram Bot Dashboard

A secure web dashboard for managing and monitoring two Python Telegram bots
running as `systemd` services on a Linux server — plus the Telegram Local Bot
API server they depend on.

- **Backend:** Node.js 22+ / Express, server-side sessions, `helmet`, rate
  limiting, CSRF defense, `bcryptjs` password hashing.
- **Frontend:** React 18 + Vite, dark operations theme, auto-refresh every
  5 seconds, live log viewer.
- **No database.** All configuration comes from environment variables. Sessions
  are held in memory (single process) — a dashboard restart simply logs
  everyone out.
- **No root.** The app runs as a dedicated user and only ever executes the
  exact `systemctl`/`journalctl` commands granted in a restricted sudoers
  file.

---

## 1. Prerequisites

- A Linux server (Debian/Ubuntu instructions below; works on any
  systemd-based distro) with:
  - Node.js **22 or newer** (`sudo apt install nodejs npm`, or use
    [NodeSource](https://github.com/nodesource/distributions))
  - `systemd` (default), `systemctl`, `journalctl`
  - `sudo`
  - Nginx (for the HTTPS reverse proxy) — optional but recommended
- The two bot services already installed, e.g. `mybot_bale.service` and
  `mybot_rubika.service`, and the Telegram Local Bot API service
  (`telegram-bot-api.service`).
- Your own machine for development: Node.js 22+, npm, git.

## 2. Project installation

```bash
# Clone
git clone https://github.com/shiny222/dashbord-bale-rubika.git
cd dashbord-bale-rubika

# Install dependencies (server + client)
npm run install:all
```

## 3. Development mode

Terminal 1 — backend (API on http://127.0.0.1:3000):

```bash
cd server
npm run dev
```

Terminal 2 — frontend (Vite dev server on http://localhost:5173, proxies
`/api` to the backend):

```bash
cd client
npm run dev
```

Both need the environment from `.env.example` to be set (see section 5).
The frontend has hot reload; the backend restarts on file changes.

## 4. Production build

```bash
npm run build          # builds the React client into server/public
npm start --prefix server   # serves the API + built client on PORT (default 3000)
```

`npm start --prefix server` is what the systemd unit runs.

## 5. Environment configuration

All configuration is read from environment variables. Copy the template and
fill it in:

```bash
cp .env.example /etc/telegram-bot-dashboard.env   # production
# or
cp .env.example server/.env                       # local development
```

Key variables (full list in `.env.example`):

| Variable | Meaning |
| --- | --- |
| `BOT_1_NAME`, `BOT_1_SERVICE` | Display name + systemd unit of bot 1 |
| `BOT_2_NAME`, `BOT_2_SERVICE` | Display name + systemd unit of bot 2 |
| `TELEGRAM_API_SERVICE` | systemd unit of the Local Bot API |
| `TELEGRAM_API_URL` | HTTP endpoint for the health probe (no token needed) |
| `PORT`, `HOST` | Bind address (keep `127.0.0.1` behind Nginx) |
| `SESSION_SECRET` | Long random secret for session cookies |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | Login credentials (hash only!) |
| `SECURE_COOKIES` | `true` when served over HTTPS |
| `TRUST_PROXY` | `true` behind Nginx |
| `USE_SUDO` | `true` (default) — control commands run via `sudo -n` |

> **Never commit real secrets.** The repo ships `.env.example` only;
> `.env` files are git-ignored.

## 6. Password-hash generation

The app stores only a bcrypt hash — never a plaintext password.

```bash
cd server
node scripts/hash-password.js "your-very-strong-password"
```

Put the output into `ADMIN_PASSWORD_HASH=...` in the env file.

## 7. Creating the Linux service user

The dashboard must **not** run as root. Create a dedicated, unprivileged
user:

```bash
sudo useradd --system --home /opt/telegram-bot-dashboard --shell /usr/sbin/nologin botdashboard
```

Give it read access to the journal (so `journalctl -u <unit>` works without
sudo):

```bash
sudo usermod -aG systemd-journal botdashboard
```

(On some distros the group is `adm` or `systemd-journal`; verify with
`getent group systemd-journal`.)

Deploy the code:

```bash
sudo mkdir -p /opt/telegram-bot-dashboard
sudo cp -r server client package.json .env.example /opt/telegram-bot-dashboard/
cd /opt/telegram-bot-dashboard && sudo npm run install:all && sudo npm run build
sudo chown -R botdashboard:botdashboard /opt/telegram-bot-dashboard
```

## 8. Installing the restricted sudoers configuration

The app controls services with exactly three commands per unit. Grant only
those:

```bash
# Edit deploy/sudoers.d-botdashboard first and replace the example
# service names with your real ones.
sudo cp deploy/sudoers.d-botdashboard /etc/sudoers.d/botdashboard
sudo chmod 440 /etc/sudoers.d/botdashboard
sudo visudo -c          # MUST print "parsed OK"
```

The file grants **no wildcards and no `ALL`** — only the exact
`systemctl start|stop|restart <unit>` commands for the configured units.
`Defaults:botdashboard timestamp_type=none` lets sudo work without writing
to `/run/sudo` under the hardened service unit.

Verify it works from the dashboard user:

```bash
sudo -u botdashboard sudo -n systemctl status my-first-bot.service   # replace unit
```

## 9. Installing the dashboard systemd service

```bash
sudo cp deploy/telegram-bot-dashboard.service /etc/systemd/system/
sudo nano /etc/telegram-bot-dashboard.env      # fill in real values
sudo systemctl daemon-reload
sudo systemctl enable --now telegram-bot-dashboard
sudo systemctl status telegram-bot-dashboard
```

The unit uses `EnvironmentFile=/etc/telegram-bot-dashboard.env`, runs as
`botdashboard`, and is hardened (`PrivateTmp`, `ProtectSystem=strict`,
`ReadWritePaths=/opt/telegram-bot-dashboard`, `RestrictSUIDSGID`, …).

> **Why `NoNewPrivileges` is off:** the app must be able to run `sudo -n`.
> Privilege is kept to the bare minimum through the restricted sudoers file
> instead. `RestrictSUIDSGID` stays on — it only blocks *creating* setuid
> files, not executing the existing `sudo` binary.

## 10. Configuring Nginx and HTTPS

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp deploy/nginx-dashboard.conf /etc/nginx/sites-available/dashboard
sudo ln -s /etc/nginx/sites-available/dashboard /etc/nginx/sites-enabled/
# Edit the server_name and certificate paths in the file first!
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d dashboard.example.com
```

The Nginx config:

- Terminates HTTPS (TLS 1.2/1.3) and redirects HTTP → HTTPS
- Proxies `/api/` and the SPA to `http://127.0.0.1:3000`
- Sets standard proxy headers (`X-Forwarded-For`, `X-Forwarded-Proto`, …)
- Adds security headers (HSTS, `X-Frame-Options: DENY`, `nosniff`, …)
- Limits request body size to `32k` (the API never needs more)
- Never exposes port 3000 to the network

Remember to set `SECURE_COOKIES=true` and `TRUST_PROXY=true` in the env file
once HTTPS is in front.

**Firewall recommendations:**

```bash
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80/tcp        # HTTP (redirects to HTTPS)
sudo ufw allow 443/tcp       # HTTPS
sudo ufw enable
```

Do **not** open port 3000 — it is bound to 127.0.0.1 only.

## 11. Starting and enabling the dashboard

```bash
sudo systemctl enable --now telegram-bot-dashboard
sudo systemctl status telegram-bot-dashboard
```

Then open `https://dashboard.example.com` and sign in with the credentials
from `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`.

## 12. Troubleshooting permissions

Symptom | Fix
--- | ---
`PERMISSION_DENIED` when starting/stopping a bot | Unit name in the app env doesn't match the sudoers entry. Check both, then `sudo visudo -c`.
`Unable to read journal logs: permission denied` | Add the user to the journal group: `sudo usermod -aG systemd-journal botdashboard` and restart the service.
`COMMAND_TIMEOUT` on a huge bot | The bot may be slow to stop/start. `systemctl start` waits for the unit to become active; if it takes > 60 s, check the unit with `systemctl status`.
`SYSTEMD_UNAVAILABLE` | The app cannot talk to systemd — check `systemctl status systemd-journald` and that the box is actually a systemd host.
`SERVICE_NOT_ALLOWED` (404) | You asked for a unit that isn't in `BOT_N_SERVICE` / `TELEGRAM_API_SERVICE`. Only configured units are ever touched.
`sudo -n` fails under the hardened service | The unit sets `ProtectHome=true` and `PrivateTmp=true`; if sudo misbehaves, these are the first suspects (and `timestamp_type=none` in sudoers must be present).

## 13. Checking dashboard logs

The app logs structured JSON to stdout/stderr, which systemd captures:

```bash
sudo journalctl -u telegram-bot-dashboard -f
sudo journalctl -u telegram-bot-dashboard -n 200 --no-pager
```

You should see `"msg":"dashboard started"` on boot and a `"level":"warn"`
entry for every failed login attempt.

## 14. Security recommendations

- **Never run the app as root.** The dedicated user + restricted sudoers is
  the whole security model.
- **Only HTTPS.** `SECURE_COOKIES=true` makes session cookies
  Secure+HttpOnly+SameSite=Strict.
- **Strong secrets.** Generate with `openssl rand -base64 48` and keep the
  env file `chmod 600 root:root` (systemd reads it as root).
- **Rotate.** If the repo is ever public or shared, rotate any secrets that
  were committed and regenerate `SESSION_SECRET`.
- **Brute-force protection** is built in: 10 login attempts per 15 min per
  IP, plus a constant-ish delay on failure.
- **Logs are redacted.** Bot tokens, `api_id`/`api_hash`, authorization
  headers and env secrets are replaced with `[REDACTED]` before anything is
  sent to the browser.
- **Keep the allowlist tight.** Every unit name is validated against the
  config; commands are built with argv arrays (`execFile`) — no shell
  strings, no user-controlled unit names.
- **CSRF:** SameSite=Strict cookies plus an Origin check on every
  state-changing request.

## 15. How to change the two managed bot services

1. Edit the sudoers file to add/remove the exact
   `systemctl start|stop|restart <unit>` lines, then `sudo visudo -c`.
2. Update `BOT_1_SERVICE` / `BOT_2_SERVICE` (or add `BOT_3_*` … up to
   `BOT_10_*`) in `/etc/telegram-bot-dashboard.env`.
3. Restart the dashboard: `sudo systemctl restart telegram-bot-dashboard`.
4. The dashboard will show the new unit(s) — no rebuild needed.

---

## API overview

```
POST /api/auth/login                 # session cookie on success (rate-limited)
POST /api/auth/logout
GET  /api/auth/session               # { authenticated, username }

GET  /api/services                   # status of every configured bot
GET  /api/services/:serviceName      # single bot
POST /api/services/:serviceName/start|stop|restart
GET  /api/services/:serviceName/logs?lines=100&search=error

GET  /api/telegram-api/health        # systemd state + endpoint probe
POST /api/telegram-api/control/start|stop|restart   # if enabled
```

All routes except login require an authenticated session. Only allowlisted
service names are accepted.

## Testing

```bash
cd server && npm test
```

52 tests cover: allowlist enforcement, unknown-unit rejection, `systemctl
show` parsing, auth + logout, start/stop/restart routes, command failure and
timeout handling, log-line validation, secret redaction, and Telegram API
health-check behavior. **All Linux commands are mocked** — the test suite
never touches a real service.
