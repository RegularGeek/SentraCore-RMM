const db = require("../database/db");
const { verifyPassword, hashPassword, validatePassword } = require("../auth/password");

// Thin service layer so the route file stays about HTTP, not business logic.
async function attemptLogin({ username, password, ip }) {
  const identifier = (username || "").toLowerCase();
  const user = db.getUserByUsername(username || "");
  const passwordOk = user ? await verifyPassword(password || "", user.password_hash) : false;
  // A deactivated account fails the same way a wrong password does, so the
  // login response can't be used to enumerate which accounts still exist.
  const ok = passwordOk && user.active !== 0;

  db.recordLoginAttempt(identifier, ip, ok);

  if (!ok) return { ok: false };

  db.touchLastLogin(user.id);
  return { ok: true, user };
}

async function changePassword({ userId, currentPassword, newPassword }) {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, status: 404, error: "user not found" };

  const currentOk = await verifyPassword(currentPassword || "", user.password_hash);
  if (!currentOk) return { ok: false, status: 403, error: "current password is incorrect" };

  const invalid = validatePassword(newPassword);
  if (invalid) return { ok: false, status: 400, error: invalid };

  if (await verifyPassword(newPassword, user.password_hash)) {
    return { ok: false, status: 400, error: "new password must differ from the current one" };
  }

  db.updateUserPassword(user.id, await hashPassword(newPassword));
  return { ok: true };
}

module.exports = { attemptLogin, changePassword };
