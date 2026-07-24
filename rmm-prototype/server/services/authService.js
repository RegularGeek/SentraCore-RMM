const db = require("../database/db");
const { verifyPassword } = require("../auth/password");

// Thin service layer so the route file stays about HTTP, not business logic.
async function attemptLogin({ username, password, ip }) {
  const identifier = (username || "").toLowerCase();
  const user = db.getUserByUsername(username || "");
  const ok = user ? await verifyPassword(password || "", user.password_hash) : false;

  db.recordLoginAttempt(identifier, ip, ok);

  if (!ok) return { ok: false };

  db.touchLastLogin(user.id);
  return { ok: true, user };
}

module.exports = { attemptLogin };
