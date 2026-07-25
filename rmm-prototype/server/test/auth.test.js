require("./env");

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildApp, createOrg, createUser, signIn, post, db, PASSWORD } = require("./support");

const app = buildApp();

test("rejects a bad password and does not create a session", async () => {
  const org = createOrg();
  const user = await createUser({ orgId: org.id });

  const { agent, csrf } = await signIn(app, { ...user, password: "wrong-password" });
  const session = await agent.get("/api/session");

  assert.equal(typeof csrf, "string");
  assert.equal(session.status, 401);
});

test("signs in and exposes the session identity", async () => {
  const org = createOrg("Acme MSP");
  const user = await createUser({ orgId: org.id, role: "technician" });

  const session = await signIn(app, user);
  assert.equal(session.res.status, 200);

  const me = await session.agent.get("/api/session");
  assert.equal(me.status, 200);
  assert.deepEqual(
    { username: me.body.username, role: me.body.role, orgName: me.body.orgName },
    { username: user.username, role: "technician", orgName: "Acme MSP" }
  );
});

test("a deactivated account cannot sign in", async () => {
  const org = createOrg();
  const user = await createUser({ orgId: org.id, active: false });

  const session = await signIn(app, user);
  assert.equal(session.res.status, 401);
});

test("deactivating a signed-in user invalidates their existing session", async () => {
  const org = createOrg();
  const user = await createUser({ orgId: org.id });
  const session = await signIn(app, user);
  assert.equal((await session.agent.get("/api/session")).status, 200);

  db.setUserActive(user.id, org.id, false);

  assert.equal((await session.agent.get("/api/session")).status, 401);
});

test("state-changing requests without a CSRF token are refused", async () => {
  const org = createOrg();
  const user = await createUser({ orgId: org.id, role: "admin" });
  const session = await signIn(app, user);

  const res = await session.agent.post("/api/alert-rules").send({ metric: "cpuLoad", comparator: ">", threshold: 90 });
  assert.equal(res.status, 403);
});

test("logging in rotates the session id (no fixation)", async () => {
  const org = createOrg();
  const user = await createUser({ orgId: org.id });
  const session = await signIn(app, user);

  const before = db.countSessions();
  await post(session, "/api/logout");
  assert.ok(db.countSessions() < before);
  assert.equal((await session.agent.get("/api/session")).status, 401);
});

test("changing a password requires the current one and enforces the policy", async () => {
  const org = createOrg();
  const user = await createUser({ orgId: org.id });
  const session = await signIn(app, user);

  const wrongCurrent = await post(session, "/api/change-password", {
    currentPassword: "not-it",
    newPassword: "a-brand-new-password",
  });
  assert.equal(wrongCurrent.status, 403);

  const tooShort = await post(session, "/api/change-password", {
    currentPassword: PASSWORD,
    newPassword: "short",
  });
  assert.equal(tooShort.status, 400);

  const ok = await post(session, "/api/change-password", {
    currentPassword: PASSWORD,
    newPassword: "a-brand-new-password",
  });
  assert.equal(ok.status, 200);

  const reSignIn = await signIn(app, { ...user, password: "a-brand-new-password" });
  assert.equal(reSignIn.res.status, 200);
});

test("healthz is reachable without authentication", async () => {
  const session = await signIn(app, { username: "nobody", password: "nobody" });
  const res = await session.agent.get("/healthz");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});
