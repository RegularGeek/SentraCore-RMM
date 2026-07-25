const db = require("../database/db");

// Session cookie alone isn't enough: the user row is re-checked on every
// request so deactivating an account (or changing its role) takes effect
// immediately instead of at the next login.
function requireLogin(req, res, next) {
  const unauthenticated = () => {
    if (req.path.startsWith("/api/") || req.originalUrl.startsWith("/api/")) {
      return res.status(401).json({ error: "not authenticated" });
    }
    return res.redirect("/login.html");
  };

  if (!req.session || !req.session.userId) return unauthenticated();

  const user = db.getUserById(req.session.userId);
  if (!user || user.active === 0) {
    return req.session.destroy(() => unauthenticated());
  }

  req.session.role = user.role;
  req.user = user;
  return next();
}

module.exports = { requireLogin };
