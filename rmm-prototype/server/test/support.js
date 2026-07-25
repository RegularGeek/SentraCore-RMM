require("./env");

const crypto = require("crypto");
const request = require("supertest");

const db = require("../database/db");
const { createApp } = require("../app");
const { hashPassword } = require("../auth/password");

const CSRF_COOKIE = "sentracore.csrf";
const PASSWORD = "correct-horse-battery";

function buildApp(liveAgents = new Map()) {
  return createApp({ liveAgents });
}

function createOrg(name = `org-${crypto.randomUUID()}`) {
  const org = { id: db.uid(), name, agent_token: crypto.randomBytes(8).toString("hex"), created_at: db.now() };
  db.db
    .prepare("INSERT INTO orgs (id, name, agent_token, created_at) VALUES (@id, @name, @agent_token, @created_at)")
    .run(org);
  return org;
}

async function createUser({ orgId, role = "admin", password = PASSWORD, active = true, username, email }) {
  const name = username || `user-${crypto.randomUUID().slice(0, 8)}`;
  const user = {
    id: db.uid(),
    org_id: orgId,
    email: email || `${name}@example.test`,
    username: name,
    password_hash: await hashPassword(password),
    role,
    created_at: db.now(),
  };
  db.createUser(user);
  if (!active) db.setUserActive(user.id, orgId, false);
  return { ...user, password };
}

// supertest's agent keeps the cookie jar; the CSRF header has to be echoed
// back by hand the same way the dashboard client does.
async function signIn(app, user) {
  const agent = request.agent(app);
  const primer = await agent.get("/healthz");
  const csrf = extractCookie(primer.headers["set-cookie"], CSRF_COOKIE);
  const res = await agent
    .post("/api/login")
    .set("x-csrf-token", csrf)
    .send({ username: user.username, password: user.password });
  return { agent, csrf, res };
}

function extractCookie(setCookieHeader, name) {
  const header = [].concat(setCookieHeader || []).find((c) => c.startsWith(`${name}=`));
  return header ? decodeURIComponent(header.split(";")[0].split("=")[1]) : "";
}

// Thin wrappers so tests don't repeat the CSRF header on every call.
const send = (method) => (session, url, body) =>
  session.agent[method](url).set("x-csrf-token", session.csrf).send(body);

module.exports = {
  buildApp,
  createOrg,
  createUser,
  signIn,
  extractCookie,
  db,
  PASSWORD,
  CSRF_COOKIE,
  post: send("post"),
  patch: send("patch"),
  del: send("delete"),
};
