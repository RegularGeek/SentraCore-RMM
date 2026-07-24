const express = require("express");
const db = require("../database/db");
const { attemptLogin } = require("../services/authService");
const { ipThrottle, loginAttemptGuard } = require("../middleware/loginRateLimit");
const { requireLogin } = require("../middleware/requireAuth");

const router = express.Router();

router.post("/login", ipThrottle, loginAttemptGuard, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const result = await attemptLogin({ username, password, ip: req.ip });
  if (!result.ok) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  const { user } = result;
  req.session.userId = user.id;
  req.session.orgId = user.org_id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/session", requireLogin, (req, res) => {
  const org = db.getOrgById(req.session.orgId);
  res.json({
    username: req.session.username,
    role: req.session.role,
    orgName: org ? org.name : "unknown",
  });
});

// Lets the dashboard fetch a CSRF token explicitly if it ever needs to
// (the cookie is also set automatically on any page load via issueCsrfCookie).
router.get("/csrf-token", (req, res) => res.json({ csrfToken: req.csrfToken }));

module.exports = router;
