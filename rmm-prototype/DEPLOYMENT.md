# Deployment Guide

Two ways to host the server, both ending with the same setup: a small VPS,
a domain pointed at it, Caddy handling HTTPS in front, and agents connecting
in over `wss://` from wherever the monitored machines actually are.

Either path works — Docker is less fiddly to reproduce/redeploy, the native
systemd path is more transparent if you want to see exactly what's running.

## 0. Before either path

- **A VPS.** Any $5-6/mo box (DigitalOcean, Hetzner, Linode, etc.) is plenty
  for a beta's worth of agents. Ubuntu 22.04/24.04 assumed below.
- **A domain (or subdomain)** pointed at the VPS's IP — an `A` record, e.g.
  `rmm.yourdomain.com → <VPS IP>`. Caddy needs this to issue a TLS cert.
- **Firewall:** only ports `80` and `443` need to be open to the internet
  (Caddy). The app itself binds to `127.0.0.1:8787` and is never exposed
  directly — that's what `docker-compose.yml` and the systemd unit both do.
  ```bash
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow OpenSSH
  sudo ufw enable
  ```

## Path A — Docker

```bash
# on the VPS
git clone <your repo>   # or scp the project folder up
cd rmm-prototype

cp deploy/.env.example .env
nano .env                 # set SESSION_SECRET and SEED_ADMIN_PASS to real values

docker compose up -d --build
docker compose exec server npm run seed   # prints superadmin login + agent token
```

Then install Caddy and point it at the container:
```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile           # replace rmm.yourdomain.com with your real domain
sudo systemctl reload caddy
```

Visit `https://rmm.yourdomain.com` — Caddy fetches the cert automatically
on first request.

**Updating later:** `git pull && docker compose up -d --build` (data persists
in the `rmm_data` volume).

## Path B — Native (systemd), no Docker

```bash
# on the VPS
sudo apt install -y nodejs npm build-essential   # build-essential for better-sqlite3
sudo useradd -r -m -d /opt/rmm-prototype rmm
sudo git clone <your repo> /opt/rmm-prototype     # or scp it up
cd /opt/rmm-prototype/server
sudo -u rmm npm ci --omit=dev

sudo -u rmm bash -c "SEED_ADMIN_PASS='choose a real password' npm run seed"

sudo tee /etc/rmm-server.env << EOF
SESSION_SECRET=$(openssl rand -hex 32)
PORT=8787
NODE_ENV=production
EOF

sudo cp ../deploy/rmm-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rmm-server
sudo journalctl -u rmm-server -f                  # confirm it's listening
```

Then the same Caddy steps as Path A (install, copy `deploy/Caddyfile`, set
your domain, reload).

## Connecting agents from anywhere

Once the server is live at `https://rmm.yourdomain.com`, point every agent
at the **public** WebSocket URL over `wss://` (not `ws://localhost`):

```bash
SERVER_URL=wss://rmm.yourdomain.com/ws/agent AGENT_TOKEN=<your token> npm start
```

This works from any network — the agent just needs outbound HTTPS access,
same as any other client. No VPN or port-forwarding needed on the monitored
machine's side.

## After you're live

- Rotate the seeded password from the dashboard: **account** → *Change your
  password*. Add the rest of your team under **account** → *Users* (admins
  only) instead of touching SQLite by hand.
- `SESSION_SECRET` is mandatory when `NODE_ENV=production` — the server exits
  on startup without it. Sessions are stored in SQLite, so they survive
  restarts and deploys.
- Point your monitoring at `GET /healthz` (unauthenticated, no side effects).
  The Docker Compose service already uses it as its container healthcheck:
  `docker compose ps` will show the server as `healthy`.
- Set up backups for the SQLite file: `/app/data/rmm.db` (Docker volume) or
  `/opt/rmm-prototype/server/rmm.db` (native). A daily `cp` to off-box
  storage is enough at this scale.
- Watch memory: `better-sqlite3` + a handful of agents is light, but if you
  scale to dozens of endpoints reporting every 2s, keep an eye on the VPS's
  RAM/CPU and bump the instance size if needed.
