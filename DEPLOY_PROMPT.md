# Deployment Prompt — Telegram Bot Dashboard

> Copy everything between the `---` markers below and paste it to your
> deployment agent (or follow it yourself). It is written for the actual
> server: `etejah-bot@<host>` on Ubuntu/Debian, with the bots running from
> `~/bot2/` and the Telegram Local Bot API already on
> `http://127.0.0.1:8081` (`telegram-bot-api.service`, active).

---

## Mission

Deploy the Telegram Bot Dashboard (this repo, `github.com/shiny222/dashbord-bale-rubika`)
on this Linux server so the owner can open it in a browser, sign in, see the
two Telegram bot services + the Telegram Local Bot API, view their journals,
and start/stop/restart them. The dashboard must run **as a non-root user**
(`botdashboard`), control services **only through a restricted sudoers file**,
and **must not** modify the bots' own files (`config.json`, `run_bot.sh`,
`bridge.py`, bot `.service` files, or `telegram-bot-api.service`).

**Absolute rules:**
- Never run the Node app as root.
- Never grant wildcard sudo (`botdashboard ALL=(ALL) NOPASSWD: ALL`).
- Never commit or echo secrets (SESSION_SECRET, admin password, api_id/hash).
- Never restart the bot services or telegram-bot-api.service yourself — only
  the dashboard owner does that from the UI after deployment.
- If a step fails, stop and report the exact error instead of improvising.

## Step 0 — Preflight

1. Detect the OS: `cat /etc/os-release` (expect Ubuntu/Debian; adapt if not).
2. Check Node.js: `node -v`. It must be **22 or newer**. If missing/older,
   install the current LTS from NodeSource:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
   (NodeSource installs `/usr/bin/node`, which the systemd unit expects.)
3. Confirm the services exist and **discover the real unit names** — do not
   guess:
   ```bash
   systemctl list-units --type=service --all --no-pager | grep -iE "bale|rubika|telegram"
   ```
   Known: `mybot_rubika.service` and `telegram-bot-api.service` exist.
   Find the Bale unit's exact name (a candidate is `mybot_bale.service`).
   Verify each candidate really exists:
   ```bash
   systemctl show mybot_rubika.service --no-pager --property=Id
   systemctl show telegram-bot-api.service --no-pager --property=Id
   systemctl show <BALE-UNIT-NAME> --no-pager --property=Id
   ```
   Record the three confirmed names for Steps 3 and 4.

## Step 1 — Place the code and create the service user

```bash
sudo mkdir -p /opt/telegram-bot-dashboard
# If the repo is NOT on this server yet, clone directly into the (empty)
# target directory:
sudo git clone https://github.com/shiny222/dashbord-bale-rubika.git /opt/telegram-bot-dashboard
# If it is already checked out somewhere (e.g. ~/bot2/telegram-bot-dashboard),
# copy it instead (use rsync if available, else cp -r):
#   sudo rsync -a --exclude node_modules --exclude .git ~/bot2/telegram-bot-dashboard/ /opt/telegram-bot-dashboard/

# Dedicated unprivileged system user (home dir is /opt/telegram-bot-dashboard):
sudo useradd --system --home /opt/telegram-bot-dashboard --shell /usr/sbin/nologin botdashboard
# Journal read access (lets the dashboard read logs WITHOUT sudo):
# The group is "systemd-journal" on Ubuntu/Debian; verify it exists:
getent group systemd-journal || echo "systemd-journal group missing — use your distro's journal group (often 'adm') and edit the group name below accordingly"
sudo usermod -aG systemd-journal botdashboard
# Make botdashboard the owner of its home:
sudo chown -R botdashboard:botdashboard /opt/telegram-bot-dashboard
```

## Step 2 — Install dependencies and build the frontend

```bash
cd /opt/telegram-bot-dashboard
sudo -u botdashboard npm run install:all
sudo -u botdashboard npm run build
```
- If npm 12+ warns about esbuild's postinstall script, the build still
  works; if it errors, run `sudo -u botdashboard npm install-scripts approve esbuild`
  and retry.
- Sanity: `ls server/public/index.html` must exist after the build.

## Step 3 — Environment file

Create `/etc/telegram-bot-dashboard.env` (owner root, mode 600):

```bash
sudo touch /etc/telegram-bot-dashboard.env
sudo chmod 600 /etc/telegram-bot-dashboard.env
```

Fill it with the discovered unit names and fresh secrets. **Edit the file with
`sudo nano /etc/telegram-bot-dashboard.env` — never write it with an
unquoted heredoc**, because `$` characters (in the bcrypt hash and the
`openssl` command) must not be shell-expanded:

```bash
BOT_1_NAME=Bale Bot
BOT_1_SERVICE=<DISCOVERED-BALE-UNIT>.service
BOT_2_NAME=Rubika Bot
BOT_2_SERVICE=mybot_rubika.service

TELEGRAM_API_SERVICE=telegram-bot-api.service
TELEGRAM_API_URL=http://127.0.0.1:8081
TELEGRAM_API_CONTROL_ENABLED=true

PORT=3000
HOST=127.0.0.1
SESSION_SECRET=<paste output of: openssl rand -base64 48>
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<see below>
USE_SUDO=true
SECURE_COOKIES=false
TRUST_PROXY=false
LOG_LEVEL=info
```

Generate the two secrets by running these commands (do not paste the commands
themselves into the env file — paste their OUTPUT):

```bash
openssl rand -base64 48      # → paste into SESSION_SECRET
```

Generate the password hash on the server:

```bash
cd /opt/telegram-bot-dashboard && node server/scripts/hash-password.js "PUT-A-STRONG-PASSWORD-HERE"
```

Paste the output into `ADMIN_PASSWORD_HASH=`. Tell the owner the chosen
username/password (or let them set it) — the plaintext password is **not**
stored anywhere.

> `SECURE_COOKIES` / `TRUST_PROXY` become `true` only if Step 7 (HTTPS via
> Nginx) is completed; otherwise leave `false` and use the SSH tunnel.

## Step 4 — Restricted sudoers (control access only)

Edit `/opt/telegram-bot-dashboard/deploy/sudoers.d-botdashboard`: replace
`my-first-bot.service` and `my-second-bot.service` with the two confirmed bot
unit names (keep `telegram-bot-api.service`). Then:

```bash
sudo cp /opt/telegram-bot-dashboard/deploy/sudoers.d-botdashboard /etc/sudoers.d/botdashboard
sudo chmod 440 /etc/sudoers.d/botdashboard
sudo visudo -c        # MUST print "parsed OK"
```

The file must end up granting ONLY these nine commands (exact names):

```text
systemctl start|stop|restart  <bale-unit>.service
systemctl start|stop|restart  mybot_rubika.service
systemctl start|stop|restart  telegram-bot-api.service
```

Verify from the dashboard user. **Note: `systemctl status`/`journalctl` are
read-only and need NO sudo** (the sudoers file only grants start/stop/restart):

```bash
sudo -u botdashboard systemctl status mybot_rubika.service --no-pager | head -5
sudo -u botdashboard journalctl -u mybot_rubika.service -n 3 --no-pager
```

## Step 5 — Install and start the dashboard service

```bash
sudo cp /opt/telegram-bot-dashboard/deploy/telegram-bot-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now telegram-bot-dashboard
sudo systemctl status telegram-bot-dashboard --no-pager | head -10
```

`NoNewPrivileges=false` in the unit is **intentional** — the app needs
`sudo -n`; the restricted sudoers file is the compensating control. Do not
"fix" it.

## Step 6 — Validate

```bash
# 1) API alive (no auth needed):
curl -s http://127.0.0.1:3000/api/health
#    → {"success":true,"data":{"ok":true,...}}

# 2) Login and read service status with the session cookie:
curl -s -c /tmp/dash.cookies -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"PUT-A-STRONG-PASSWORD-HERE"}' \
  http://127.0.0.1:3000/api/auth/login
#    → {"success":true,"data":{"username":"admin","authenticated":true}}

curl -s -b /tmp/dash.cookies http://127.0.0.1:3000/api/services
#    → both bots present; status "running"/"stopped"; NO tokens in output

# 3) Logs endpoint + Telegram API health:
curl -s -b /tmp/dash.cookies "http://127.0.0.1:3000/api/services/mybot_rubika.service/logs?lines=100"
curl -s -b /tmp/dash.cookies http://127.0.0.1:3000/api/telegram-api/health
#    → healthy:true (the probe gets *any* HTTP reply from 8081, even 404 —
#      that proves the server is up; do not treat 404 as failure)

# 4) Without a cookie, everything is 401:
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/services   # → 401
```

Check the dashboard's own log for a clean boot:

```bash
sudo journalctl -u telegram-bot-dashboard -n 30 --no-pager
```

## Step 7 — Access: HTTPS (recommended) or SSH tunnel

**If the server has a public domain** (DNS A record pointing to it):

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp /opt/telegram-bot-dashboard/deploy/nginx-dashboard.conf /etc/nginx/sites-available/dashboard
sudo ln -s /etc/nginx/sites-available/dashboard /etc/nginx/sites-enabled/
# Edit the file: replace dashboard.example.com with the real domain,
# then run certbot to fill in the certificate paths automatically:
sudo certbot --nginx -d <YOUR-DOMAIN>
sudo nginx -t && sudo systemctl reload nginx
```
Then set `SECURE_COOKIES=true` and `TRUST_PROXY=true` in
`/etc/telegram-bot-dashboard.env`, and `sudo systemctl restart telegram-bot-dashboard`.

**If there is no public domain** (default): keep `SECURE_COOKIES=false` and
have the owner connect with an SSH tunnel — port 3000 stays bound to
127.0.0.1 and is never exposed to the internet:

```bash
ssh -L 3000:127.0.0.1:3000 etejah-bot@<server-ip>
# then open http://127.0.0.1:3000 in the local browser
```

Firewall (never open 3000):

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

## Handoff checklist

- [ ] Dashboard service `active (running)` and `enabled`
- [ ] Login works in the browser; dashboard shows 2 bot cards + API card
- [ ] Bot statuses are correct (not "Not found")
- [ ] Log viewer opens and shows journal lines (error lines highlighted)
- [ ] Start/Stop/Restart buttons work for the bots and the API (owner tests)
- [ ] `curl /api/services` output contains no tokens or secrets
- [ ] `/etc/telegram-bot-dashboard.env` is `600` root and contains no secrets
      in the repo

## Troubleshooting quick map

| Symptom | Cause / fix |
| --- | --- |
| Service shows "Not found" | Unit name in env file is wrong — confirm with `systemctl show <name> --property=Id` |
| Buttons fail with PERMISSION_DENIED | Sudoers names don't match env names — fix both, `sudo visudo -c` |
| Logs: "permission denied" | `botdashboard` not in `systemd-journal` group — re-run `usermod -aG` and restart the service |
| App fails to start | Missing env var — `sudo journalctl -u telegram-bot-dashboard -n 30` shows which |
| Login rejected repeatedly | Brute-force limiter (10/15 min) — wait, then retry |
| API card "unreachable" | `telegram-bot-api.service` stopped — `systemctl status telegram-bot-api` |

Report back: the three confirmed unit names, the validation curl outputs, and
any step that failed.
