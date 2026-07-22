// RMM Prototype - Central Server (v0.2)
// Adds on top of the original live-monitoring hub:
//   - session-based login, org-scoped multi-tenancy
//   - SQLite persistence (metrics history, inventory, alerts, audit log)
//   - threshold-based alerting with webhook/email notifications
//   - remote script execution with an audit trail
//
// SECURITY NOTE: remote script execution runs arbitrary commands on target
// machines. It is gated behind login + org scoping and every run is logged
// to script_runs (who, what, when, output) - but there is no role/approval
// step yet. Do not expose this server to untrusted users, and read the
// README before pointing it at anything you don't own or administer.

const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const db = require("./db");
const { sessionParser, requireLogin, verifyPassword } = require("./auth");
const { notifyAlert } = require("./notify");

const PORT = process.env.PORT || 8787;
const SCRIPT_TIMEOUT_MS = Number(process.env.SCRIPT_TIMEOUT_MS || 30000);

const app = express();
app.use(express.json());
app.use(sessionParser);
app.use(express.static(path.join(__dirname, "public"), { index: false }));

const server = http.createServer(app);
const wssAgents = new WebSocketServer({ noServer: true });
const wssDashboards = new WebSocketServer({ noServer: true });

// ---- Live in-memory state (fast path; DB is the source of truth for history) ----
const liveAgents = new Map(); // agentId -> { ws, orgId, hostname, lastMetrics, status }

function dashboardsForOrg(orgId) {
  return [...wssDashboards.clients].filter((c) => c.readyState === c.OPEN && c.orgId === orgId);
}
function broadcastToOrg(orgId, msg) {
  const payload = JSON.stringify(msg);
  for (const client of dashboardsForOrg(orgId)) client.send(payload);
}

// =====================================================================
// Auth routes
// =====================================================================
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.getUserByUsername(username || "");
  if (!user || !(await verifyPassword(password || "", user.password_hash))) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  req.session.userId = user.id;
  req.session.orgId = user.org_id;
  req.session.username = user.username;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/session", requireLogin, (req, res) => {
  const org = db.getOrgById(req.session.orgId);
  res.json({ username: req.session.username, orgName: org ? org.name : "unknown" });
});

app.get("/", requireLogin, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Everything else under /api requires a session.
app.use("/api", requireLogin);

// =====================================================================
// Agents
// =====================================================================
app.get("/api/agents", (req, res) => {
  const agents = db.getAgentsByOrg(req.session.orgId).map((a) => ({
    ...a,
    lastMetrics: liveAgents.get(a.id)?.lastMetrics || null,
  }));
  res.json(agents);
});

app.get("/api/agents/:id/history", (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent || agent.org_id !== req.session.orgId) return res.status(404).json({ error: "not found" });

  const ranges = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3 };
  const span = ranges[req.query.range] || ranges["1h"];
  const rows = db.getHistory(agent.id, Date.now() - span);

  // Downsample to ~150 points so the payload/render stays cheap for long ranges.
  const bucketCount = 150;
  const bucketSize = Math.max(1, Math.ceil(rows.length / bucketCount));
  const out = [];
  for (let i = 0; i < rows.length; i += bucketSize) {
    const chunk = rows.slice(i, i + bucketSize);
    const avg = (key) => chunk.reduce((s, r) => s + (r[key] || 0), 0) / chunk.length;
    out.push({
      ts: chunk[chunk.length - 1].ts,
      cpuLoad: Number(avg("cpu_load").toFixed(1)),
      memUsedPct: Number(avg("mem_used_pct").toFixed(1)),
      diskUsedPct: Number(avg("disk_used_pct").toFixed(1)),
      netRxKBs: Number(avg("net_rx").toFixed(1)),
      netTxKBs: Number(avg("net_tx").toFixed(1)),
    });
  }
  res.json(out);
});

app.get("/api/agents/:id/inventory", (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent || agent.org_id !== req.session.orgId) return res.status(404).json({ error: "not found" });
  const inv = db.getInventory(agent.id);
  if (!inv) return res.json(null);
  res.json({
    collectedAt: inv.collected_at,
    hardware: JSON.parse(inv.hardware_json || "{}"),
    software: JSON.parse(inv.software_json || "[]"),
  });
});

// =====================================================================
// Alert rules + events
// =====================================================================
app.get("/api/alert-rules", (req, res) => res.json(db.getRulesByOrg(req.session.orgId)));

app.post("/api/alert-rules", (req, res) => {
  const { metric, comparator, threshold, webhookUrl } = req.body || {};
  if (!["cpuLoad", "memUsedPct", "diskUsedPct"].includes(metric)) return res.status(400).json({ error: "invalid metric" });
  if (![">", ">=", "<", "<="].includes(comparator)) return res.status(400).json({ error: "invalid comparator" });
  const rule = {
    id: db.uid(),
    org_id: req.session.orgId,
    metric,
    comparator,
    threshold: Number(threshold),
    webhook_url: webhookUrl || null,
    created_at: db.now(),
  };
  db.createRule(rule);
  res.json(rule);
});

app.delete("/api/alert-rules/:id", (req, res) => {
  db.deleteRule(req.params.id, req.session.orgId);
  res.json({ ok: true });
});

app.get("/api/alerts", (req, res) => res.json(db.getEventsByOrg(req.session.orgId)));

app.post("/api/alerts/:id/ack", (req, res) => {
  db.acknowledgeEvent(req.params.id, req.session.orgId);
  res.json({ ok: true });
});

function evaluateAlerts(orgId, agentId, hostname, data) {
  const rules = db.getRulesByOrg(orgId).filter((r) => r.enabled);
  for (const rule of rules) {
    const value = data[rule.metric];
    if (value === undefined) continue;
    const breach =
      (rule.comparator === ">" && value > rule.threshold) ||
      (rule.comparator === ">=" && value >= rule.threshold) ||
      (rule.comparator === "<" && value < rule.threshold) ||
      (rule.comparator === "<=" && value <= rule.threshold);

    const firing = db.getFiringEvent(rule.id, agentId);
    if (breach && !firing) {
      const event = {
        id: db.uid(), org_id: orgId, rule_id: rule.id, agent_id: agentId,
        metric: rule.metric, value, triggered_at: db.now(),
      };
      db.createEvent(event);
      broadcastToOrg(orgId, { type: "alert", event: { ...event, hostname } });
      notifyAlert({ hostname, metric: rule.metric, value, threshold: rule.threshold, comparator: rule.comparator, webhookUrl: rule.webhook_url });
    } else if (!breach && firing) {
      db.resolveEvent(firing.id);
      broadcastToOrg(orgId, { type: "alert_resolved", id: firing.id });
    }
  }
}

// =====================================================================
// Remote script execution
// =====================================================================
app.post("/api/agents/:id/run", (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent || agent.org_id !== req.session.orgId) return res.status(404).json({ error: "not found" });
  const script = (req.body && req.body.script || "").trim();
  if (!script) return res.status(400).json({ error: "script is required" });

  const run = {
    id: db.uid(), org_id: agent.org_id, agent_id: agent.id,
    user_id: req.session.userId, script, requested_at: db.now(),
  };
  db.createScriptRun(run);

  const live = liveAgents.get(agent.id);
  if (!live || live.ws.readyState !== live.ws.OPEN) {
    db.completeScriptRun(run.id, { exit_code: null, stdout: "", stderr: "agent is offline", status: "failed" });
    return res.status(409).json({ error: "agent is offline", runId: run.id });
  }

  live.ws.send(JSON.stringify({ type: "run_script", runId: run.id, script, timeoutMs: SCRIPT_TIMEOUT_MS }));
  res.status(202).json({ runId: run.id, status: "pending" });
});

app.get("/api/agents/:id/script-runs", (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent || agent.org_id !== req.session.orgId) return res.status(404).json({ error: "not found" });
  res.json(db.getScriptRunsByAgent(agent.id));
});

// =====================================================================
// WebSocket upgrade routing (session auth for dashboards, token auth for agents)
// =====================================================================
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === "/ws/agent") {
    wssAgents.handleUpgrade(req, socket, head, (ws) => wssAgents.emit("connection", ws, req));
    return;
  }

  if (pathname === "/ws/dashboard") {
    sessionParser(req, {}, () => {
      if (!req.session || !req.session.userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wssDashboards.handleUpgrade(req, socket, head, (ws) => {
        ws.orgId = req.session.orgId;
        wssDashboards.emit("connection", ws, req);
      });
    });
    return;
  }

  socket.destroy();
});

// ---- Agent connections ----
wssAgents.on("connection", (ws) => {
  let agentId = null;
  let orgId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "register") {
      const org = db.getOrgByToken(msg.token || "");
      if (!org) { ws.close(4001, "invalid token"); return; }
      agentId = msg.agentId;
      orgId = org.id;
      const info = msg.info || {};
      db.upsertAgent({
        id: agentId, org_id: orgId, hostname: info.hostname, platform: info.platform,
        distro: info.distro, cpu_model: info.cpuModel, cores: info.cores,
      });
      liveAgents.set(agentId, { ws, orgId, hostname: info.hostname, lastMetrics: null, status: "online" });
      ws.send(JSON.stringify({ type: "registered", agentId }));
      broadcastToOrg(orgId, { type: "agent_online", id: agentId, info });
      return;
    }

    if (!agentId || !liveAgents.has(agentId)) return; // must register first

    if (msg.type === "metrics") {
      const live = liveAgents.get(agentId);
      live.lastMetrics = msg.data;
      live.status = "online";
      db.touchAgent(agentId);
      db.insertMetrics(agentId, msg.data);
      broadcastToOrg(orgId, { type: "metrics", id: agentId, data: msg.data, ts: db.now() });
      evaluateAlerts(orgId, agentId, live.hostname, msg.data);
      return;
    }

    if (msg.type === "inventory") {
      db.upsertInventory(agentId, msg.hardware || {}, msg.software || []);
      return;
    }

    if (msg.type === "script_result") {
      db.completeScriptRun(msg.runId, {
        exit_code: msg.exitCode,
        stdout: (msg.stdout || "").slice(0, 100000),
        stderr: (msg.stderr || "").slice(0, 100000),
        status: msg.timedOut ? "timed_out" : "completed",
      });
      broadcastToOrg(orgId, {
        type: "script_result", runId: msg.runId, agentId,
        exitCode: msg.exitCode, stdout: msg.stdout, stderr: msg.stderr, timedOut: !!msg.timedOut,
      });
      return;
    }
  });

  ws.on("close", () => {
    if (agentId && liveAgents.has(agentId)) {
      liveAgents.get(agentId).status = "offline";
      db.setAgentStatus(agentId, "offline");
      broadcastToOrg(orgId, { type: "agent_offline", id: agentId });
    }
  });
});

// ---- Dashboard connections ----
wssDashboards.on("connection", (ws, req) => {
  const orgId = ws.orgId;
  const agents = db.getAgentsByOrg(orgId).map((a) => ({
    id: a.id, info: { hostname: a.hostname, platform: a.platform, distro: a.distro, cpuModel: a.cpu_model, cores: a.cores },
    status: liveAgents.get(a.id)?.status || a.status,
    lastMetrics: liveAgents.get(a.id)?.lastMetrics || null,
  }));
  ws.send(JSON.stringify({ type: "snapshot", agents }));
});

// Mark agents offline if we haven't heard from them in a while.
const STALE_MS = 15000;
setInterval(() => {
  for (const [id, live] of liveAgents.entries()) {
    if (live.status === "online" && (!live.ws || live.ws.readyState !== live.ws.OPEN)) {
      live.status = "offline";
      db.setAgentStatus(id, "offline");
      broadcastToOrg(live.orgId, { type: "agent_offline", id });
    }
  }
}, 5000);

// Prune metrics older than 30 days so the DB doesn't grow forever.
setInterval(() => db.pruneHistory(Date.now() - 30 * 86400e3), 6 * 3600e3);

server.listen(PORT, () => {
  console.log(`RMM server listening on http://localhost:${PORT}`);
  console.log(`  Dashboard:    http://localhost:${PORT}  (login required)`);
  console.log(`  Agent WS:     ws://localhost:${PORT}/ws/agent`);
  console.log(`  Dashboard WS: ws://localhost:${PORT}/ws/dashboard`);
  console.log(`If this is your first run: npm run seed  (creates an org, admin login, and agent token)`);
});
