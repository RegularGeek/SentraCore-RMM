// SQLite data layer. Uses better-sqlite3 (synchronous) to keep the rest
// of the code simple - no async/await noise around every query.
//
// Moved from server/db.js -> server/database/db.js as part of the
// auth folder restructuring. No schema-breaking changes were made to
// existing tables; the users table gained two nullable-safe columns
// (updated_at, last_login) via idempotent ALTER TABLE guards so this
// is safe to run against an existing rmm.db from v0.2.

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "rmm.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  agent_token TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  hostname TEXT,
  platform TEXT,
  distro TEXT,
  cpu_model TEXT,
  cores INTEGER,
  first_seen INTEGER,
  last_seen INTEGER,
  status TEXT DEFAULT 'offline'
);

CREATE TABLE IF NOT EXISTS metrics_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  cpu_load REAL,
  mem_used_pct REAL,
  disk_used_pct REAL,
  net_rx REAL,
  net_tx REAL
);
CREATE INDEX IF NOT EXISTS idx_metrics_agent_ts ON metrics_history(agent_id, ts);

CREATE TABLE IF NOT EXISTS inventory (
  agent_id TEXT PRIMARY KEY,
  collected_at INTEGER,
  hardware_json TEXT,
  software_json TEXT
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  comparator TEXT NOT NULL,
  threshold REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  webhook_url TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  rule_id TEXT,
  agent_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  status TEXT NOT NULL DEFAULT 'firing',
  triggered_at INTEGER NOT NULL,
  resolved_at INTEGER,
  acknowledged_at INTEGER
);

CREATE TABLE IF NOT EXISTS script_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  script TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  requested_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  ip TEXT NOT NULL,
  success INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ident_ts ON login_attempts(identifier, ts);
`);

// --- Idempotent migration guard for DBs created by v0.2 (before email/
// updated_at/last_login existed on users). Safe to run every boot.
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
if (!columnExists("users", "email")) {
  // Older DBs won't have email; backfill with username@local so the
  // UNIQUE constraint doesn't block startup. Real deployments should
  // update these via the admin UI once available.
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
  db.exec(`UPDATE users SET email = username || '@local' WHERE email IS NULL`);
}
if (!columnExists("users", "updated_at")) db.exec(`ALTER TABLE users ADD COLUMN updated_at INTEGER`);
if (!columnExists("users", "last_login")) db.exec(`ALTER TABLE users ADD COLUMN last_login INTEGER`);

const now = () => Date.now();
const uid = () => crypto.randomUUID();

// Role tiers, weakest to strongest. Kept as a flat array (not an enum
// library) to avoid adding a dependency for something this small.
const ROLES = ["readonly", "technician", "admin", "superadmin"];

module.exports = {
  db,
  now,
  uid,
  ROLES,

  // ---- Orgs / users ----
  getOrgByToken: (token) => db.prepare("SELECT * FROM orgs WHERE agent_token = ?").get(token),
  getOrgById: (id) => db.prepare("SELECT * FROM orgs WHERE id = ?").get(id),
  getUserByUsername: (username) => db.prepare("SELECT * FROM users WHERE username = ?").get(username),
  getUserByEmail: (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email),
  getUserById: (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id),
  createUser: (u) => {
    db.prepare(`
      INSERT INTO users (id, org_id, email, username, password_hash, role, created_at, updated_at)
      VALUES (@id, @org_id, @email, @username, @password_hash, @role, @created_at, @created_at)
    `).run(u);
  },
  touchLastLogin: (userId) =>
    db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(now(), userId),
  recordLoginAttempt: (identifier, ip, success) =>
    db.prepare("INSERT INTO login_attempts (identifier, ip, success, ts) VALUES (?, ?, ?, ?)")
      .run(identifier, ip, success ? 1 : 0, now()),
  countRecentFailedLogins: (identifier, ip, sinceTs) =>
    db.prepare(`
      SELECT COUNT(*) AS n FROM login_attempts
      WHERE (identifier = ? OR ip = ?) AND success = 0 AND ts >= ?
    `).get(identifier, ip, sinceTs).n,

  // ---- Agents ----
  upsertAgent: (a) => {
    db.prepare(`
      INSERT INTO agents (id, org_id, hostname, platform, distro, cpu_model, cores, first_seen, last_seen, status)
      VALUES (@id, @org_id, @hostname, @platform, @distro, @cpu_model, @cores, @now, @now, 'online')
      ON CONFLICT(id) DO UPDATE SET
        hostname=excluded.hostname, platform=excluded.platform, distro=excluded.distro,
        cpu_model=excluded.cpu_model, cores=excluded.cores, last_seen=excluded.last_seen, status='online'
    `).run({ ...a, now: now() });
  },
  setAgentStatus: (id, status) => db.prepare("UPDATE agents SET status = ?, last_seen = ? WHERE id = ?").run(status, now(), id),
  touchAgent: (id) => db.prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(now(), id),
  getAgentsByOrg: (orgId) => db.prepare("SELECT * FROM agents WHERE org_id = ? ORDER BY hostname").all(orgId),
  getAgent: (id) => db.prepare("SELECT * FROM agents WHERE id = ?").get(id),

  // ---- Metrics history ----
  insertMetrics: (agentId, d) => {
    db.prepare(`
      INSERT INTO metrics_history (agent_id, ts, cpu_load, mem_used_pct, disk_used_pct, net_rx, net_tx)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(agentId, now(), d.cpuLoad, d.memUsedPct, d.diskUsedPct, d.netRxKBs, d.netTxKBs);
  },
  getHistory: (agentId, sinceTs) =>
    db.prepare("SELECT * FROM metrics_history WHERE agent_id = ? AND ts >= ? ORDER BY ts ASC").all(agentId, sinceTs),
  pruneHistory: (olderThanTs) => db.prepare("DELETE FROM metrics_history WHERE ts < ?").run(olderThanTs),

  // ---- Inventory ----
  upsertInventory: (agentId, hardware, software) => {
    db.prepare(`
      INSERT INTO inventory (agent_id, collected_at, hardware_json, software_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET collected_at=excluded.collected_at,
        hardware_json=excluded.hardware_json, software_json=excluded.software_json
    `).run(agentId, now(), JSON.stringify(hardware), JSON.stringify(software));
  },
  getInventory: (agentId) => db.prepare("SELECT * FROM inventory WHERE agent_id = ?").get(agentId),

  // ---- Alert rules ----
  getRulesByOrg: (orgId) => db.prepare("SELECT * FROM alert_rules WHERE org_id = ? ORDER BY created_at DESC").all(orgId),
  createRule: (r) => {
    db.prepare(`
      INSERT INTO alert_rules (id, org_id, metric, comparator, threshold, enabled, webhook_url, created_at)
      VALUES (@id, @org_id, @metric, @comparator, @threshold, 1, @webhook_url, @created_at)
    `).run(r);
  },
  deleteRule: (id, orgId) => db.prepare("DELETE FROM alert_rules WHERE id = ? AND org_id = ?").run(id, orgId),

  // ---- Alert events ----
  getFiringEvent: (ruleId, agentId) =>
    db.prepare("SELECT * FROM alert_events WHERE rule_id = ? AND agent_id = ? AND status = 'firing'").get(ruleId, agentId),
  createEvent: (e) => {
    db.prepare(`
      INSERT INTO alert_events (id, org_id, rule_id, agent_id, metric, value, status, triggered_at)
      VALUES (@id, @org_id, @rule_id, @agent_id, @metric, @value, 'firing', @triggered_at)
    `).run(e);
  },
  resolveEvent: (id) => db.prepare("UPDATE alert_events SET status='resolved', resolved_at=? WHERE id=?").run(now(), id),
  acknowledgeEvent: (id, orgId) =>
    db.prepare("UPDATE alert_events SET status='acknowledged', acknowledged_at=? WHERE id=? AND org_id=?").run(now(), id, orgId),
  getEventsByOrg: (orgId, limit = 100) =>
    db.prepare(`
      SELECT ae.*, a.hostname FROM alert_events ae
      JOIN agents a ON a.id = ae.agent_id
      WHERE ae.org_id = ? ORDER BY ae.triggered_at DESC LIMIT ?
    `).all(orgId, limit),

  // ---- Script runs (audit log) ----
  createScriptRun: (r) => {
    db.prepare(`
      INSERT INTO script_runs (id, org_id, agent_id, user_id, script, status, requested_at)
      VALUES (@id, @org_id, @agent_id, @user_id, @script, 'pending', @requested_at)
    `).run(r);
  },
  completeScriptRun: (id, { exit_code, stdout, stderr, status }) => {
    db.prepare(`
      UPDATE script_runs SET status=?, exit_code=?, stdout=?, stderr=?, completed_at=? WHERE id=?
    `).run(status, exit_code, stdout, stderr, now(), id);
  },
  getScriptRunsByAgent: (agentId, limit = 25) =>
    db.prepare("SELECT * FROM script_runs WHERE agent_id = ? ORDER BY requested_at DESC LIMIT ?").all(agentId, limit),
  getScriptRun: (id) => db.prepare("SELECT * FROM script_runs WHERE id = ?").get(id),
};
