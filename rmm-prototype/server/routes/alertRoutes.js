const express = require("express");
const db = require("../database/db");

const router = express.Router();

router.get("/alert-rules", (req, res) => res.json(db.getRulesByOrg(req.session.orgId)));

router.post("/alert-rules", (req, res) => {
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

router.delete("/alert-rules/:id", (req, res) => {
  db.deleteRule(req.params.id, req.session.orgId);
  res.json({ ok: true });
});

router.get("/alerts", (req, res) => res.json(db.getEventsByOrg(req.session.orgId)));

router.post("/alerts/:id/ack", (req, res) => {
  db.acknowledgeEvent(req.params.id, req.session.orgId);
  res.json({ ok: true });
});

module.exports = router;
