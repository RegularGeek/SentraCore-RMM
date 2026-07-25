// SQLite-backed express-session store.
//
// express-session's default MemoryStore drops every session when the process
// restarts (and can't be shared between instances). Rather than pull in a
// Redis dependency for a deployment that already has a SQLite file open,
// sessions live in the `sessions` table alongside the rest of the data.
//
// Implements the three methods express-session requires (get/set/destroy)
// plus the optional touch/length/clear.

const { Store } = require("express-session");
const db = require("../database/db");

const PRUNE_INTERVAL_MS = 15 * 60 * 1000;

class SqliteSessionStore extends Store {
  constructor({ ttlMs, pruneIntervalMs = PRUNE_INTERVAL_MS } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.pruneTimer = setInterval(() => db.deleteExpiredSessions(), pruneIntervalMs);
    // Don't hold the event loop open just to prune expired sessions.
    if (typeof this.pruneTimer.unref === "function") this.pruneTimer.unref();
  }

  expiryFor(session) {
    const cookieExpires = session && session.cookie && session.cookie.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + this.ttlMs;
  }

  get(sid, callback) {
    try {
      const row = db.getSession(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        db.deleteSession(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, session, callback = () => {}) {
    try {
      db.upsertSession(sid, JSON.stringify(session), this.expiryFor(session));
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  touch(sid, session, callback = () => {}) {
    return this.set(sid, session, callback);
  }

  destroy(sid, callback = () => {}) {
    try {
      db.deleteSession(sid);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  length(callback) {
    try {
      return callback(null, db.countSessions());
    } catch (err) {
      return callback(err);
    }
  }

  clear(callback = () => {}) {
    try {
      db.deleteExpiredSessions(Number.MAX_SAFE_INTEGER);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  stopPruning() {
    clearInterval(this.pruneTimer);
  }
}

module.exports = { SqliteSessionStore };
