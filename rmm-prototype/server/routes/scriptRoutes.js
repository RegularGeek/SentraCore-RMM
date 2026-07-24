const express = require("express");
const db = require("../database/db");
const { requireRole } = require("../middleware/requireRole");

const SCRIPT_TIMEOUT_MS = Number(process.env.SCRIPT_TIMEOUT_MS || 30000);

function createScriptRoutes({ liveAgents }) {
  const router = express.Router();

  // Highest-trust surface in the app - gated to technician role or above.
  // readonly users can view everything else but cannot execute scripts.
  router.post("/agents/:id/run", requireRole("technician"), (req, res) => {
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

  router.get("/agents/:id/script-runs", (req, res) => {
    const agent = db.getAgent(req.params.id);
    if (!agent || agent.org_id !== req.session.orgId) return res.status(404).json({ error: "not found" });
    res.json(db.getScriptRunsByAgent(agent.id));
  });

  return router;
}

module.exports = { createScriptRoutes, SCRIPT_TIMEOUT_MS };
