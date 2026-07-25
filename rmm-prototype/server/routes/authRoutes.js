const express = require("express");
const db = require("../database/db");
const { attemptLogin, changePassword } = require("../services/authService");
const { ipThrottle, loginAttemptGuard } = require("../middleware/loginRateLimit");
const { requireLogin } = require("../middleware/requireAuth");
const { verifyCsrfToken } = require("../middleware/csrf");

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
  // Regenerate before storing anything on the session so a pre-login cookie
  // handed to the browser by an attacker can't be reused (session fixation).
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "could not start session" });
    req.session.userId = user.id;
    req.session.orgId = user.org_id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.save((saveErr) =>
      saveErr ? res.status(500).json({ error: "could not start session" }) : res.json({ ok: true })
    );
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sentracore.sid");
    res.json({ ok: true });
  });
});

router.get("/session", requireLogin, (req, res) => {
  const org = db.getOrgById(req.session.orgId);
  res.json({
    userId: req.session.userId,
    username: req.session.username,
    role: req.session.role,
    orgName: org ? org.name : "unknown",
  });
});

// Self-service password change — any signed-in user, own account only.
router.post("/change-password", requireLogin, verifyCsrfToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const result = await changePassword({
    userId: req.session.userId,
    currentPassword,
    newPassword,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
});

// Lets the dashboard fetch a CSRF token explicitly if it ever needs to
// (the cookie is also set automatically on any page load via issueCsrfCookie).
router.get("/csrf-token", (req, res) => res.json({ csrfToken: req.csrfToken }));

module.exports = router;
