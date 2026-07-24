function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not authenticated" });
  return res.redirect("/login.html");
}

module.exports = { requireLogin };
