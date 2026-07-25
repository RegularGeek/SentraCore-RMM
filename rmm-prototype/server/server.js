// SentraCore RMM - Central Server
// HTTP app lives in app.js; this file owns the WebSocket layer (agents +
// dashboards), alert evaluation, and process lifecycle.

const http = require("http");
const { WebSocketServer } = require("ws");

const db = require("./database/db");
const { createApp } = require("./app");
const { sessionParser } = require("./auth/session");
const { notifyAlert } = require("./services/notify");

const PORT = process.env.PORT || 8787;

// ---- Live in-memory state (fast path; DB is the source of truth for history) ----
const liveAgents = new Map(); // agentId -> { ws, orgId, hostname, lastMetrics, status }

const app = createApp({ liveAgents });
const server = http.createServer(app);
const wssAgents = new WebSocketServer({ noServer: true });
const wssDashboards = new WebSocketServer({ noServer: true });

function dashboardsForOrg(orgId) {
  return [...wssDashboards.clients].filter((c) => c.readyState === c.OPEN && c.orgId === orgId);
}
function broadcastToOrg(orgId, msg) {
  const payload = JSON.stringify(msg);
  for (const client of dashboardsForOrg(orgId)) client.send(payload);
}

// =====================================================================
// Alert evaluation
// =====================================================================
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
      // Re-check the account on upgrade: a deactivated user's live cookie
      // shouldn't buy them a metrics stream after the HTTP API cuts them off.
      const user = db.getUserById(req.session.userId);
      if (!user || user.active === 0) {
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

  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "register") {
      const org = db.getOrgByToken(msg.token || "");
      if (!org) { ws.close(4001, "invalid token"); return; }
      if (typeof msg.agentId !== "string" || !msg.agentId) { ws.close(4002, "missing agentId"); return; }
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
      // Only the agent the run was dispatched to may report its result -
      // otherwise any registered agent could overwrite another's audit row.
      const run = db.getScriptRun(msg.runId);
      if (!run || run.agent_id !== agentId) return;
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
wssDashboards.on("connection", (ws) => {
  const orgId = ws.orgId;
  const agents = db.getAgentsByOrg(orgId).map((a) => ({
    id: a.id, info: { hostname: a.hostname, platform: a.platform, distro: a.distro, cpuModel: a.cpu_model, cores: a.cores },
    status: liveAgents.get(a.id)?.status || a.status,
    lastMetrics: liveAgents.get(a.id)?.lastMetrics || null,
  }));
  ws.send(JSON.stringify({ type: "snapshot", agents }));
});

// Heartbeat: a half-open agent socket (laptop lid closed, NAT timeout) never
// fires 'close', so ping and drop the ones that stop answering.
const HEARTBEAT_MS = 15000;
const heartbeat = setInterval(() => {
  for (const ws of wssAgents.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }

  for (const [id, live] of liveAgents.entries()) {
    if (live.status === "online" && (!live.ws || live.ws.readyState !== live.ws.OPEN)) {
      live.status = "offline";
      db.setAgentStatus(id, "offline");
      broadcastToOrg(live.orgId, { type: "agent_offline", id });
    }
  }
}, HEARTBEAT_MS);

// Prune metrics older than 30 days so the DB doesn't grow forever.
const pruneTimer = setInterval(() => db.pruneHistory(Date.now() - 30 * 86400e3), 6 * 3600e3);

function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down`);
  clearInterval(heartbeat);
  clearInterval(pruneTimer);
  for (const ws of [...wssAgents.clients, ...wssDashboards.clients]) ws.close(1001, "server shutting down");
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(PORT, () => {
  console.log(`SentraCore RMM server listening on http://localhost:${PORT}`);
  console.log(`  Dashboard:    http://localhost:${PORT}  (login required)`);
  console.log(`  Agent WS:     ws://localhost:${PORT}/ws/agent`);
  console.log(`  Dashboard WS: ws://localhost:${PORT}/ws/dashboard`);
  console.log(`If this is your first run: npm run seed  (creates an org, admin login, and agent token)`);
});

module.exports = { server, app, liveAgents, evaluateAlerts };
