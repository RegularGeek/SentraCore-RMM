// Express app wiring, separated from the HTTP/WebSocket server so tests can
// exercise the API without opening a socket (see test/).

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { sessionParser } = require("./auth/session");
const { requireLogin } = require("./middleware/requireAuth");
const { issueCsrfCookie, verifyCsrfToken } = require("./middleware/csrf");

const authRoutes = require("./routes/authRoutes");
const createAgentRoutes = require("./routes/agentRoutes");
const alertRoutes = require("./routes/alertRoutes");
const userRoutes = require("./routes/userRoutes");
const { createScriptRoutes } = require("./routes/scriptRoutes");

// The dashboard pulls Inter/IBM Plex Mono from Google Fonts and the Lucide
// icon bundle from unpkg; everything else is same-origin. No inline scripts
// or inline styles are used, so neither 'unsafe-inline' nor 'unsafe-eval'
// is needed here — keep it that way when adding UI.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "https://unpkg.com"],
  styleSrc: ["'self'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:"],
  connectSrc: ["'self'", "ws:", "wss:"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

function createApp({ liveAgents }) {
  const app = express();
  app.set("trust proxy", 1); // needed for req.ip to be correct behind Caddy - see DEPLOYMENT.md

  app.use(helmet({ contentSecurityPolicy: { directives: CSP_DIRECTIVES } }));
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use(sessionParser);
  app.use(issueCsrfCookie);
  app.use(express.static(path.join(__dirname, "public"), { index: false }));

  // Unauthenticated on purpose: load balancers, systemd and `docker compose`
  // healthchecks need it before anyone signs in. Exposes no org data.
  app.get("/healthz", (_req, res) => res.json({ status: "ok", uptimeSec: Math.round(process.uptime()) }));

  // Auth routes are exempt from the blanket CSRF check below (there's no
  // session yet to tie a token to at login time); /change-password opts back
  // in explicitly. Everything past this point that mutates state requires
  // both a session (requireLogin) and a matching CSRF token.
  app.use("/api", authRoutes);

  app.get("/", requireLogin, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

  app.use("/api", requireLogin, verifyCsrfToken);
  app.use("/api", createAgentRoutes({ liveAgents }));
  app.use("/api", alertRoutes);
  app.use("/api", userRoutes);
  app.use("/api", createScriptRoutes({ liveAgents }));

  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

  // Anything an unhandled route throws would otherwise return express's HTML
  // error page to a client that only ever parses JSON.
  app.use((err, _req, res, _next) => {
    console.error("[server] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

module.exports = { createApp, CSP_DIRECTIVES };
