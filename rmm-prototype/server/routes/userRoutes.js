// User management — the "invite/create/deactivate users and assign roles from
// the dashboard" gap the earlier betas listed under Roadmap. Admin+ only, and
// every route is scoped to the caller's org.

const express = require("express");
const db = require("../database/db");
const { requireRole } = require("../middleware/requireRole");
const { hashPassword, validatePassword } = require("../auth/password");

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A user can never grant a role above their own — otherwise an admin could
// bootstrap themselves a superadmin and the tiers would be decorative.
function canAssign(actorRole, targetRole) {
  return db.ROLES.indexOf(targetRole) <= db.ROLES.indexOf(actorRole);
}

function serialize(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    active: u.active !== 0,
    createdAt: u.created_at,
    lastLogin: u.last_login,
  };
}

router.get("/users", requireRole("admin"), (req, res) => {
  res.json(db.getUsersByOrg(req.session.orgId).map(serialize));
});

router.post("/users", requireRole("admin"), async (req, res) => {
  const { username, email, password, role } = req.body || {};

  if (!USERNAME_RE.test(username || "")) {
    return res.status(400).json({ error: "username must be 3-32 chars (letters, digits, . _ -)" });
  }
  if (!EMAIL_RE.test(email || "")) return res.status(400).json({ error: "a valid email is required" });
  if (!db.ROLES.includes(role)) return res.status(400).json({ error: "invalid role" });
  if (!canAssign(req.session.role, role)) {
    return res.status(403).json({ error: "cannot assign a role above your own" });
  }
  const invalidPassword = validatePassword(password);
  if (invalidPassword) return res.status(400).json({ error: invalidPassword });

  if (db.getUserByUsername(username)) return res.status(409).json({ error: "username is taken" });
  if (db.getUserByEmail(email)) return res.status(409).json({ error: "email is already in use" });

  const user = {
    id: db.uid(),
    org_id: req.session.orgId,
    email,
    username,
    password_hash: await hashPassword(password),
    role,
    created_at: db.now(),
  };
  db.createUser(user);
  res.status(201).json(serialize({ ...user, active: 1 }));
});

router.patch("/users/:id", requireRole("admin"), (req, res) => {
  const target = db.getUserById(req.params.id);
  if (!target || target.org_id !== req.session.orgId) return res.status(404).json({ error: "not found" });

  const { role, active } = req.body || {};

  if (role !== undefined) {
    if (!db.ROLES.includes(role)) return res.status(400).json({ error: "invalid role" });
    if (!canAssign(req.session.role, role) || !canAssign(req.session.role, target.role)) {
      return res.status(403).json({ error: "cannot change a role above your own" });
    }
    if (target.id === req.session.userId && role !== target.role) {
      return res.status(400).json({ error: "you cannot change your own role" });
    }
  }

  if (active !== undefined) {
    if (typeof active !== "boolean") return res.status(400).json({ error: "active must be a boolean" });
    if (target.id === req.session.userId && !active) {
      return res.status(400).json({ error: "you cannot deactivate your own account" });
    }
    if (!canAssign(req.session.role, target.role)) {
      return res.status(403).json({ error: "cannot modify a user above your own role" });
    }
  }

  // Locking everyone out of user management is unrecoverable without shell
  // access to the SQLite file, so the last active admin can't be removed.
  const losingAdmin =
    (active === false && ["admin", "superadmin"].includes(target.role)) ||
    (role !== undefined && ["admin", "superadmin"].includes(target.role) && !["admin", "superadmin"].includes(role));
  if (losingAdmin && db.countActiveAdmins(req.session.orgId) <= 1) {
    return res.status(400).json({ error: "the last active admin cannot be demoted or deactivated" });
  }

  if (role !== undefined) db.updateUserRole(target.id, req.session.orgId, role);
  if (active !== undefined) db.setUserActive(target.id, req.session.orgId, active);

  res.json(serialize(db.getUserById(target.id)));
});

// Admin-initiated reset (for a locked-out user). Self-service change, which
// requires knowing the current password, lives in authRoutes.
router.post("/users/:id/reset-password", requireRole("admin"), async (req, res) => {
  const target = db.getUserById(req.params.id);
  if (!target || target.org_id !== req.session.orgId) return res.status(404).json({ error: "not found" });
  if (!canAssign(req.session.role, target.role)) {
    return res.status(403).json({ error: "cannot reset the password of a user above your own role" });
  }

  const { newPassword } = req.body || {};
  const invalid = validatePassword(newPassword);
  if (invalid) return res.status(400).json({ error: invalid });

  db.updateUserPassword(target.id, await hashPassword(newPassword));
  res.json({ ok: true });
});

module.exports = router;
