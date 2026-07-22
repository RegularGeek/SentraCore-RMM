const session = require("express-session");
const bcrypt = require("bcryptjs");

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

// NOTE: MemoryStore (the express-session default) is fine for a single-process
// prototype but loses sessions on restart and won't work across multiple
// server instances. Swap in a real store (Redis, connect-sqlite3, etc.)
// before running this anywhere beyond your own machine.
const sessionParser = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12h
});

function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not authenticated" });
  return res.redirect("/login.html");
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

module.exports = { sessionParser, requireLogin, verifyPassword, hashPassword };
