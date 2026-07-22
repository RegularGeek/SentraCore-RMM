# RMM Prototype — v0.2

A working RMM stack covering the core pillars: **live monitoring**, **historical
trending**, **asset inventory**, **threshold alerting**, and **audited remote
script execution** — behind a real login.

```
┌────────────┐  register + metrics/inventory   ┌──────────────────┐   session-authed live push   ┌───────────────┐
│   Agent    │ ───────────────────────────────▶ │      Server       │ ─────────────────────────────▶ │   Dashboard    │
│  (per      │ ◀─────────────────────────────── │  Express + ws +   │ ◀───────────────────────────── │  (browser UI)  │
│  endpoint) │      run_script / result          │  SQLite + auth    │        login / API calls        │               │
└────────────┘                                   └──────────────────┘                                 └───────────────┘
```

## Features

| Pillar | What's built |
|---|---|
| **Live monitoring** | CPU / memory / disk / network / uptime streamed every 2s, live "oscilloscope" traces per endpoint |
| **Login / multi-tenant** | Session-based login (`express-session` + bcrypt), all data scoped by `org_id`. One org is seeded by default — the schema supports more, but there's no UI yet to create/manage additional orgs (see Roadmap) |
| **Historical trending** | Every metric sample persisted to SQLite; dashboard "History" tab charts 1h / 24h / 7d, downsampled to ~150 points |
| **Asset inventory** | Hardware summary (CPU, RAM modules, disks, GPU, network) + installed software list, collected on connect and every 30 min |
| **Threshold alerting** | Per-org rules (metric, comparator, threshold) evaluated on every metrics update; fires a webhook (and email if SMTP is configured) and shows in an in-app alerts drawer with counts/badges |
| **Remote script execution** | Run a script on any endpoint from the dashboard; every run — who, what, when, exit code, stdout/stderr — is logged and viewable per-agent |

## Running it locally

**1. Install & seed the server**
```bash
cd server
npm install
npm run seed
# prints an admin login (default: admin / changeme123) and an agent token
npm start
# → Dashboard at http://localhost:8787
```

**2. Start an agent**
```bash
cd agent
npm install
SERVER_URL=ws://localhost:8787/ws/agent AGENT_TOKEN=<token from seed> npm start
```

**3. Sign in** at `http://localhost:8787` with the seeded admin credentials.
The agent appears in the sidebar within a couple of seconds. Click it to see
live metrics, then explore the **History**, **Inventory**, and **Scripts** tabs.

**4. Set up an alert** — click **alerts** in the top bar → add a rule (e.g.
`CPU load > 90`) → it fires the next time any matching endpoint breaches it,
shown in the drawer and (if you set a webhook URL) POSTed as JSON.

Run multiple agents to populate the dashboard with several endpoints.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | server | `8787` | HTTP/WS port |
| `SESSION_SECRET` | server | `dev-secret-change-me` | Signs session cookies — **change this** |
| `SEED_ADMIN_USER` / `SEED_ADMIN_PASS` | server (seed) | `admin` / `changeme123` | Initial login, only used by `npm run seed` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | server | unset | Optional — enables email alerts alongside webhooks |
| `SCRIPT_TIMEOUT_MS` | server | `30000` | Max time a remote script may run before the agent kills it |
| `SERVER_URL` | agent | `ws://localhost:8787/ws/agent` | Where the agent connects |
| `AGENT_TOKEN` | agent | *(from seed)* | Identifies which org this agent belongs to |
| `INTERVAL_MS` | agent | `2000` | Metrics sampling interval |
| `INVENTORY_INTERVAL_MS` | agent | `1800000` (30 min) | How often hardware/software inventory is re-collected |
| `ALLOW_REMOTE_SCRIPTS` | agent | `true` | Set to `false` to make an agent refuse all remote scripts, regardless of what the server sends |

## Hosting it somewhere real

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for a full walkthrough — a small VPS,
Caddy for automatic HTTPS, and either Docker (`docker-compose.yml`) or a
native systemd service (`deploy/rmm-server.service`). Once it's live, point
agents at `wss://your-domain/ws/agent` instead of `localhost` and they'll
connect from anywhere.

## Before pointing this at real machines

This is a prototype. It's built to be extended, not to be dropped onto a
client's network as-is. At minimum, before doing that:

- **Use TLS.** Run behind HTTPS/`wss://` (e.g. a reverse proxy with a real
  cert). Plaintext `ws://` is for localhost/private-network testing only —
  this matters even more now that login credentials and script output cross
  the wire.
- **Rotate `SESSION_SECRET` and the seeded admin password.** Both defaults
  are meant to be changed immediately, not left as-is.
- **Treat remote script execution as your highest-trust surface.** It's
  logged (who ran what, when, with what result) but there's no per-user
  role gate or approval step yet — any logged-in user can run anything on
  any endpoint in their org. Add role checks (e.g. only `admin` role can
  run scripts) before giving out logins to a team.
- **Swap the session store.** `express-session`'s default `MemoryStore` is
  fine for one process but loses all sessions on restart and won't work
  if you ever run more than one server instance — move to Redis or similar.
- **Only deploy agents to systems you're authorized to monitor and manage**,
  with the owner's knowledge, same as any commercial RMM tool's license
  terms require.

## Roadmap (not built yet)

- **True multi-org UI** — org creation/switching, per-org signup, so one
  deployment can serve multiple separate clients with strict isolation
- **Roles & approvals** — viewer / technician / admin permission tiers,
  optional second-approval step before a script runs
- **Patch management** — detect and apply missing OS/app patches
- **Native agent installers** — Windows Service / systemd unit / launchd,
  instead of running `npm start` in a terminal
- **Ticketing** — alerts auto-open tickets, track resolution
- **Remote desktop/screen control** — a much larger subsystem on its own
