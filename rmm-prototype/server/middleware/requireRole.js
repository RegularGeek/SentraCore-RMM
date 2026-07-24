const { ROLES } = require("../database/db");

// ROLES is ordered weakest -> strongest: readonly, technician, admin, superadmin.
// requireRole("technician") lets technician/admin/superadmin through and
// blocks readonly. This is additive on top of requireLogin (call requireLogin
// first) and org-scoping (still enforced at the query layer, unchanged).
function requireRole(minRole) {
  const minIndex = ROLES.indexOf(minRole);
  if (minIndex === -1) throw new Error(`requireRole: unknown role "${minRole}"`);

  return (req, res, next) => {
    const userRole = req.session && req.session.role;
    const userIndex = ROLES.indexOf(userRole);
    if (userIndex === -1) {
      return res.status(403).json({ error: "unknown role on session" });
    }
    if (userIndex < minIndex) {
      return res.status(403).json({ error: `requires ${minRole} role or higher` });
    }
    next();
  };
}

module.exports = { requireRole };
