const express = require("express");
const db = require("../database/db");

// Factory so the route module can see the live in-memory agent registry
// without a circular import back into server.js.
function createAgentRoutes({ liveAgents }) {
  const router = express.Router();

  router.get("/agents", (req, res) => {
    const agents = db.getAgentsByOrg(req.session.orgId).map((a) => ({
      ...a,
      lastMetrics: liveAgents.get(a.id)?.lastMetrics || null,
    }));
    res.json(agents);
  });

  router.get("/agents/:id/history", (req, res) => {
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

  router.get("/agents/:id/inventory", (req, res) => {
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

  return router;
}

module.exports = createAgentRoutes;
