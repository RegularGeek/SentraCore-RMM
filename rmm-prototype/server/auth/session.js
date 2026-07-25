const session = require("express-session");
const { SqliteSessionStore } = require("./sessionStore");

const DEV_SECRET = "dev-secret-change-me";
const SESSION_SECRET = process.env.SESSION_SECRET || DEV_SECRET;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 1000 * 60 * 60 * 12; // 12h

// A guessable signing key in production means forgeable session cookies, so
// this is a hard failure rather than a warning.
if (process.env.NODE_ENV === "production" && SESSION_SECRET === DEV_SECRET) {
  console.error(
    "[auth] SESSION_SECRET must be set in production. Add it to your .env / systemd EnvironmentFile."
  );
  process.exit(1);
}

// Sessions are persisted in SQLite (see sessionStore.js) so a restart or a
// second server process doesn't sign everyone out — this replaces the
// express-session default MemoryStore the earlier betas shipped with.
const store = new SqliteSessionStore({ ttlMs: SESSION_TTL_MS });

const sessionParser = session({
  name: "sentracore.sid",
  secret: SESSION_SECRET,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: true, // sliding expiry: an active user isn't logged out mid-shift
  cookie: {
    maxAge: SESSION_TTL_MS,
    httpOnly: true,
    sameSite: "lax", // "lax" (not "strict") so the login redirect flow still works cleanly
    secure: process.env.NODE_ENV === "production", // requires HTTPS in prod — see DEPLOYMENT.md
  },
});

module.exports = { sessionParser, sessionStore: store, SESSION_SECRET, SESSION_TTL_MS };
