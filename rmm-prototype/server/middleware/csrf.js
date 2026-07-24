// Double-submit-cookie CSRF protection. Deliberately not using the `csurf`
// package (deprecated/unmaintained) - this is ~30 lines and does the same
// thing for this app's needs: a non-httpOnly cookie holds a random token,
// the client echoes it back in a header on state-changing requests, and we
// compare. An attacker on another origin can trigger the request but can't
// read the cookie to put its value in the header (same-origin policy).
const crypto = require("crypto");

const COOKIE_NAME = "sentracore.csrf";
const HEADER_NAME = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function issueCsrfCookie(req, res, next) {
  if (!req.cookies || !req.cookies[COOKIE_NAME]) {
    const token = crypto.randomBytes(24).toString("hex");
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false, // must be readable by client JS to echo back in the header
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 12,
    });
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies[COOKIE_NAME];
  }
  next();
}

function verifyCsrfToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
  const headerToken = req.get(HEADER_NAME);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "invalid or missing CSRF token" });
  }
  next();
}

module.exports = { issueCsrfCookie, verifyCsrfToken, COOKIE_NAME, HEADER_NAME };
