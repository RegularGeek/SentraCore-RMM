const rateLimit = require("express-rate-limit");
const db = require("../database/db");

const WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000); // 15 min
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_MAX || 10);

// Two layers, deliberately simple (per the "don't overcomplicate the MVP"
// instruction):
//   1. express-rate-limit: coarse per-IP request throttle, resets on process
//      restart, cheap, catches basic scripted brute force immediately.
//   2. loginAttemptGuard: persisted in SQLite (login_attempts table), keyed
//      by username+IP, survives restarts, and is what actually blocks a
//      slow/distributed brute force against one account.
const ipThrottle = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many login attempts, try again later" },
});

function loginAttemptGuard(req, res, next) {
  const identifier = (req.body && req.body.username || "").toLowerCase();
  const ip = req.ip;
  const failedCount = db.countRecentFailedLogins(identifier, ip, Date.now() - WINDOW_MS);
  if (failedCount >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: "too many failed attempts, try again later" });
  }
  next();
}

module.exports = { ipThrottle, loginAttemptGuard };
