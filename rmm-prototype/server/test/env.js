// Must be required before anything that pulls in database/db.js: the SQLite
// connection is opened at require-time from DB_PATH, so each test process
// gets its own throwaway database file.
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const DB_PATH = path.join(os.tmpdir(), `sentracore-test-${crypto.randomUUID()}.db`);

process.env.DB_PATH = DB_PATH;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret";
// Keep the login throttle out of the way of tests that log in repeatedly.
process.env.LOGIN_RATE_MAX = "1000";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }
}

process.on("exit", cleanup);

module.exports = { DB_PATH, cleanup };
