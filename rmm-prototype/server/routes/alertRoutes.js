const express = require("express");
const db = require("../database/db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();

const METRICS = ["cpuLoad", "memUsedPct", "diskUsedPct"];
const COMPARATORS = [">", ">=", "<", "<="];

function validWebhook(url) {
  if (!url) return true;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

router.get("/alert-rules", (req, res) => res.json(db.getRulesByOrg(req.session.orgId)));

router.post("/alert-rules", requireRole("technician"), (req, res) => {
  const { metric, comparator, threshold, webhookUrl } = req.body || {};
  if (!METRICS.includes(metric)) return res.status(400).json({ error: "invalid metric" });
  if (!COMPARATORS.includes(comparator)) return res.status(400).json({ error: "invalid comparator" });
  const numericThreshold = Number(threshold);
  if (!Number.isFinite(numericThreshold)) return res.status(400).json({ error: "threshold must be a number" });
  if (!validWebhook(webhookUrl)) return res.status(400).json({ error: "webhook URL must be http(s)" });

  const rule = {
    id: db.uid(),
    org_id: req.session.orgId,
    metric,
    comparator,
    threshold: numericThreshold,
    webhook_url: webhookUrl || null,
    created_at: db.now(),
  };
  db.createRule(rule);
  res.status(201).json({ ...rule, enabled: 1 });
});

// Pausing a rule during planned maintenance shouldn't mean deleting and
// re-creating it — the `enabled` column existed but nothing could flip it.
router.patch("/alert-rules/:id", requireRole("technician"), (req, res) => {
  const rule = db.getRule(req.params.id, req.session.orgId);
  if (!rule) return res.status(404).json({ error: "not found" });

  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });

  db.setRuleEnabled(rule.id, req.session.orgId, enabled);
  res.json(db.getRule(rule.id, req.session.orgId));
});

router.delete("/alert-rules/:id", requireRole("admin"), (req, res) => {
  const rule = db.getRule(req.params.id, req.session.orgId);
  if (!rule) return res.status(404).json({ error: "not found" });
  db.deleteRule(rule.id, req.session.orgId);
  res.json({ ok: true });
});

router.get("/alerts", (req, res) => res.json(db.getEventsByOrg(req.session.orgId)));

router.post("/alerts/:id/ack", requireRole("technician"), (req, res) => {
  db.acknowledgeEvent(req.params.id, req.session.orgId);
  res.json({ ok: true });
});

module.exports = router;
