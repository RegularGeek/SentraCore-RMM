# SentraCore RMM — Beta (v0.4)

A working RMM stack covering the core pillars: **live monitoring**, **historical
trending**, **asset inventory**, **threshold alerting**, and **audited remote
script execution** — behind hardened login/session auth with role-based
access control.

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
| **Remote script execution** | Run a script on any endpoint from the dashboard; every run — who, what, when, exit code, stdout/stderr — is logged and viewable per-agent. Gated to the `technician` role and above (see Authentication) |
| **User management** | Admins manage their org's users from the dashboard (**account** → Users): create, change role, deactivate/reactivate, reset password. Every user can change their own password from the same drawer |

## Authentication

The server enforces session-cookie auth on every route, plus:

- **Password hashing** — bcrypt (`bcryptjs`, 10 salt rounds), never plaintext, never logged.
- **Role-based access control** — `users.role` is one of `readonly < technician < admin < superadmin`
  (weakest to strongest). `requireRole(minRole)` middleware gates mutating routes:
  remote script execution and alert-rule create/ack/pause need `technician`+, alert-rule
  deletion and all user management need `admin`+. Reads stay open to any signed-in user.
- **Role/state changes take effect immediately** — every authenticated request re-reads the
  user row, so a demotion or deactivation applies to live sessions (including the dashboard
  WebSocket) without waiting for the cookie to expire.
- **Role ceiling** — nobody can create a user, promote a user, or reset a password for a role
  above their own, and the last active admin in an org can't be demoted or deactivated.
- **Password policy** — minimum 10 characters, obvious passwords rejected (`server/auth/password.js`),
  enforced on seeding, admin resets, and self-service changes alike.
- **No default/hardcoded credentials** — `npm run seed` now *requires* `SEED_ADMIN_PASS` to be
  set and refuses to create an account otherwise. There is no `changeme123` fallback anymore.
- **Secure session cookies** — `httpOnly`, `sameSite: lax`, and `secure` (HTTPS-only) when
  `NODE_ENV=production`. Signed with `SESSION_SECRET`, rolling expiry, and the session id is
  regenerated on login (session-fixation protection).
- **Persistent sessions** — sessions live in SQLite (`server/auth/sessionStore.js`), so a server
  restart no longer signs everyone out; expired rows are pruned in the background.
- **Login rate limiting** — a coarse per-IP throttle (`express-rate-limit`) plus a persisted,
  per-username+IP failed-attempt counter (`login_attempts` table) that survives restarts.
- **CSRF protection** — double-submit cookie pattern (`server/middleware/csrf.js`) on every
  state-changing `/api/*` route. The dashboard client echoes the cookie back as an
  `x-csrf-token` header automatically.
- **Security headers** — `helmet` is applied globally, including a Content-Security-Policy
  allowlisting only what the dashboard actually loads (self, Google Fonts, unpkg for Lucide);
  `object-src`/`frame-ancestors` are `'none'` and no inline styles or scripts are used.
- **`last_login` tracking** — updated on every successful login, stored on the `users` row.
- **Environment-variable secrets** — `SESSION_SECRET`, `SEED_ADMIN_PASS`, etc. are never
  committed; see `deploy/.env.example`.

**What's still a known gap (see Roadmap):** there's no approval/second-signoff step before a
script runs, even for `admin`/`superadmin` — role gating narrows *who* can run scripts, it
doesn't add a review step for *what* gets run. Multi-org management still has no UI.

### Folder structure

Authentication-related code was split out of the single `server.js` file it used to live in:

```
server/
  auth/             session config, SQLite session store, password hashing + policy
  middleware/       requireAuth, requireRole (RBAC), csrf, loginRateLimit
  database/         db.js (schema + queries)
  routes/           authRoutes, agentRoutes, alertRoutes, scriptRoutes, userRoutes
  services/         authService (login/password flows), notify (webhook/email)
  models/           User.js (thin wrapper over the users queries)
  test/             node:test + supertest suites (auth, users, alerts, RBAC, session store)
  app.js            the Express app: middleware, CSP, /healthz, route mounting
  server.js         HTTP + WebSocket wiring, WS message handling, alert evaluation, shutdown
```

Splitting the Express app out of `server.js` is what makes the HTTP layer testable without
binding a port: the tests call `createApp()` directly.

Route paths, WebSocket message shapes, and the SQLite schema are unchanged from v0.2 — the
dashboard and agent don't need any changes to keep working. Old-format `users` rows (created
before `email`/`updated_at`/`last_login` existed) are migrated automatically on server start.

## Running it locally

**1. Install & seed the server**
```bash
cd server
npm install
SEED_ADMIN_PASS='choose a real password' npm run seed
# prints a superadmin login and an agent token
npm start
# → Dashboard at http://localhost:8787
```

**2. Start an agent**
```bash
cd agent
npm install
SERVER_URL=ws://localhost:8787/ws/agent AGENT_TOKEN=<token from seed> npm start
```

**3. Sign in** at `http://localhost:8787` with the credentials `npm run seed` printed.
The agent appears in the sidebar within a couple of seconds. Click it to see
live metrics, then explore the **History**, **Inventory**, and **Scripts** tabs.

**4. Set up an alert** — click **alerts** in the top bar → add a rule (e.g.
`CPU load > 90`) → it fires the next time any matching endpoint breaches it,
shown in the drawer and (if you set a webhook URL) POSTed as JSON. Rules can be
paused instead of deleted.

**5. Add your team** — click **account** in the top bar to change your own
password, and (as `admin`+) to create users, set roles, reset passwords, or
deactivate accounts.

Run multiple agents to populate the dashboard with several endpoints.

### Tests and linting

```bash
cd server
npm test     # node:test + supertest, runs against a throwaway SQLite file
npm run lint # eslint (server + browser code)
```

Both run in CI on every pull request (`.github/workflows/ci.yml`).

### Health check

`GET /healthz` is unauthenticated and returns `{ "status": "ok", "uptimeSec": n }` —
wire it into your load balancer, `docker-compose` healthcheck (already configured),
or uptime monitor.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | server | `8787` | HTTP/WS port |
| `SESSION_SECRET` | server | `dev-secret-change-me` | Signs session cookies — **change this**; the server refuses to start in production without it |
| `DB_PATH` | server | `./rmm.db` | SQLite file location |
| `SESSION_TTL_MS` | server | `43200000` (12 h) | Idle lifetime of a session before re-login |
| `SEED_ADMIN_USER` | server (seed) | `admin` | Initial login username |
| `SEED_ADMIN_EMAIL` | server (seed) | `<user>@local` | Initial login email |
| `SEED_ADMIN_PASS` | server (seed) | *(none — required)* | Initial login password. `seed.js` exits with an error if this isn't set |
| `LOGIN_RATE_WINDOW_MS` | server | `900000` (15 min) | Login rate-limit window |
| `LOGIN_RATE_MAX` | server | `10` | Max login attempts per IP/username within the window |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | server | unset | Optional — enables email alerts alongside webhooks |
| `SCRIPT_TIMEOUT_MS` | server | `30000` | Max time a remote script may run before the agent kills it |
| `NODE_ENV` | server | unset | Set to `production` to enable secure (`https`-only) session cookies |
| `SERVER_URL` | agent | `ws://localhost:8787/ws/agent` | Where the agent connects |
| `AGENT_TOKEN` | agent | *(from seed)* | Identifies which org this agent belongs to |
| `INTERVAL_MS` | agent | `2000` | Metrics sampling interval |
| `INVENTORY_INTERVAL_MS` | agent | `1800000` (30 min) | How often hardware/software inventory is re-collected |
| `ALLOW_REMOTE_SCRIPTS` | agent | `true` | Set to `false` to make an agent refuse all remote scripts, regardless of what the server sends |

## Database initialization

`npm run seed` (run from `server/`) is idempotent — safe to re-run. It:
1. Creates a "Default Org" (and an agent token) if one doesn't exist.
2. Creates a `superadmin` user with the username/email/password from
   `SEED_ADMIN_USER` / `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASS`, if that
   username doesn't already exist.
3. Prints the login and agent token to stdout — nothing is written to disk
   in plaintext beyond the SQLite file itself.

After the first login, everything else happens in the UI: rotate the seeded
password under **account** → *Change your password*, and add the rest of your
team under **account** → *Users*. `SEED_ADMIN_PASS` must satisfy the same
password policy as the UI.

## Hosting it somewhere real

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for a full walkthrough — a small VPS,
Caddy for automatic HTTPS, and either Docker (`docker-compose.yml`) or a
native systemd service (`deploy/rmm-server.service`). Once it's live, point
agents at `wss://your-domain/ws/agent` instead of `localhost` and they'll
connect from anywhere.

## Before pointing this at real machines

This is a beta. It's built to be extended, not to be dropped onto a
client's network unmonitored. At minimum, before doing that:

- **Use TLS.** Run behind HTTPS/`wss://` (e.g. a reverse proxy with a real
  cert). Plaintext `ws://` is for localhost/private-network testing only.
- **Rotate `SESSION_SECRET`** and make sure `SEED_ADMIN_PASS` was a real
  password, not a placeholder.
- **Treat remote script execution as your highest-trust surface.** It's now
  gated to `technician` role and above and fully logged (who ran what, when,
  with what result), but there's still no approval/second-signoff step —
  don't hand out `technician`+ roles to anyone you wouldn't trust with shell
  access to every endpoint in the org.
- **Plan for horizontal scale.** Sessions are persisted in SQLite, which
  survives restarts and is fine for a single server. Running multiple
  instances behind a load balancer still needs a shared store (Redis) and a
  shared database.
- **Only deploy agents to systems you're authorized to monitor and manage**,
  with the owner's knowledge, same as any commercial RMM tool's license
  terms require.

## Roadmap (not built yet)

- **Approval step for scripts** — optional second-approval before a script
  runs, independent of role
- **True multi-org UI** — org creation/switching, per-org signup, so one
  deployment can serve multiple separate clients with strict isolation
- **Patch management** — detect and apply missing OS/app patches
- **Native agent installers** — Windows Service / systemd unit / launchd,
  instead of running `npm start` in a terminal
- **Ticketing** — alerts auto-open tickets, track resolution
- **Remote desktop/screen control** — a much larger subsystem on its own
- **Self-hosted fonts/icons** — would let the CSP drop the `unpkg.com` and
  Google Fonts allowances entirely
