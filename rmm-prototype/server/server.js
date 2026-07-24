// SentraCore RMM - Central Server
// Restructured from the original single-file server.js into
// auth/ middleware/ database/ routes/ services/ models/ per the
// feature/authentication milestone. No route paths, WS message shapes,
// or DB schemas were broken - see README "Authentication" section for
// what changed and why.

const express = require("express");
const http = require("http");
const path = require("path");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { WebSocketServer } = require("ws");

const db = require("./database/db");
const { sessionParser } = require("./auth/session");
const { requireLogin } = require("./middleware/requireAuth");
const { issueCsrfCookie, verifyCsrfToken } = require("./middleware/csrf");
const { notifyAlert } = require("./services/notify");

const authRoutes = require("./routes/authRoutes");
const createAgentRoutes = require("./routes/agentRoutes");
const alertRoutes = require("./routes/alertRoutes");
const { createScriptRoutes } = require("./routes/scriptRoutes");

const PORT = process.env.PORT || 8787;

const app = express();
app.set("trust proxy", 1); // needed for req.ip to be correct behind Caddy - see DEPLOYMENT.md

app.use(
  helmet({
    // Keep CSP disabled for now - the dashboard loads Google Fonts and
    // inline event handlers are not used, but a strict CSP needs its own
    // pass with the actual asset list to avoid breaking the UI silently.
    // Tracked as follow-up work, not shipped half-configured.
    contentSecurityPolicy: false,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(sessionParser);
app.use(issueCsrfCookie);
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
// Routes
// =====================================================================
// Auth routes are exempt from the CSRF check (there's no session yet to
// tie a token to at login time) but everything past this point that
// mutates state requires both a session (requireLogin) and a matching
// CSRF token (verifyCsrfToken).
app.use("/api", authRoutes);

app.get("/", requireLogin, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use("/api", requireLogin, verifyCsrfToken);
app.use("/api", createAgentRoutes({ liveAgents }));
app.use("/api", alertRoutes);
app.use("/api", createScriptRoutes({ liveAgents }));

// =====================================================================
// Alert evaluation (unchanged behavior, just relocated)
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
  console.log(`SentraCore RMM server listening on http://localhost:${PORT}`);
  console.log(`  Dashboard:    http://localhost:${PORT}  (login required)`);
  console.log(`  Agent WS:     ws://localhost:${PORT}/ws/agent`);
  console.log(`  Dashboard WS: ws://localhost:${PORT}/ws/dashboard`);
  console.log(`If this is your first run: npm run seed  (creates an org, admin login, and agent token)`);
});
