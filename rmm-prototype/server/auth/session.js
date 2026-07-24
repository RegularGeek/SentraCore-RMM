const session = require("express-session");

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

if (process.env.NODE_ENV === "production" && SESSION_SECRET === "dev-secret-change-me") {
  console.warn(
    "[auth] WARNING: SESSION_SECRET is unset in production. Set it in your .env / systemd EnvironmentFile."
  );
}

// NOTE: MemoryStore (the express-session default) is fine for a single-process
// prototype but loses sessions on restart and won't work across multiple
// server instances. Swap in a real store (Redis, connect-sqlite3, etc.)
// before running this anywhere beyond your own machine — this is still
// true after this refactor and is tracked in the README's "before real
// machines" section.
const sessionParser = session({
  name: "sentracore.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12, // 12h
    httpOnly: true,
    sameSite: "lax", // "lax" (not "strict") so the login redirect flow still works cleanly
    secure: process.env.NODE_ENV === "production", // requires HTTPS in prod — see DEPLOYMENT.md
  },
});

module.exports = { sessionParser, SESSION_SECRET };
