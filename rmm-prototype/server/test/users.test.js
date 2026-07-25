require("./env");

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildApp, createOrg, createUser, signIn, post, patch, db } = require("./support");

const app = buildApp();

async function adminSession(orgId) {
  const admin = await createUser({ orgId, role: "admin" });
  return { admin, session: await signIn(app, admin) };
}

test("admins can create users, and the new user can sign in", async () => {
  const org = createOrg();
  const { session } = await adminSession(org.id);

  const created = await post(session, "/api/users", {
    username: "new.tech",
    email: "new.tech@example.test",
    password: "a-long-enough-password",
    role: "technician",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.role, "technician");
  assert.equal(created.body.active, true);

  const asNewUser = await signIn(app, { username: "new.tech", password: "a-long-enough-password" });
  assert.equal(asNewUser.res.status, 200);
});

test("user creation validates username, email, role and password", async () => {
  const org = createOrg();
  const { session } = await adminSession(org.id);
  const base = { username: "valid.name", email: "valid@example.test", password: "a-long-enough-password", role: "technician" };

  const cases = [
    [{ username: "no" }, "username"],
    [{ email: "not-an-email" }, "email"],
    [{ role: "wizard" }, "role"],
    [{ password: "short" }, "password"],
  ];

  for (const [override] of cases) {
    const res = await post(session, "/api/users", { ...base, ...override });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(override)}`);
  }
});

test("duplicate usernames and emails are rejected", async () => {
  const org = createOrg();
  const { session } = await adminSession(org.id);
  const body = { username: "dupe", email: "dupe@example.test", password: "a-long-enough-password", role: "readonly" };

  assert.equal((await post(session, "/api/users", body)).status, 201);
  assert.equal((await post(session, "/api/users", body)).status, 409);
  assert.equal(
    (await post(session, "/api/users", { ...body, username: "dupe2" })).status,
    409
  );
});

test("non-admins cannot list or create users", async () => {
  const org = createOrg();
  const tech = await createUser({ orgId: org.id, role: "technician" });
  const session = await signIn(app, tech);

  assert.equal((await session.agent.get("/api/users")).status, 403);
  assert.equal(
    (await post(session, "/api/users", { username: "x.y", email: "x@y.test", password: "a-long-enough-password", role: "readonly" })).status,
    403
  );
});

test("an admin cannot grant a role above their own", async () => {
  const org = createOrg();
  const { session } = await adminSession(org.id);

  const res = await post(session, "/api/users", {
    username: "escalate",
    email: "escalate@example.test",
    password: "a-long-enough-password",
    role: "superadmin",
  });
  assert.equal(res.status, 403);
});

test("role and activation changes apply, but not to yourself", async () => {
  const org = createOrg();
  const { admin, session } = await adminSession(org.id);
  const target = await createUser({ orgId: org.id, role: "readonly" });

  const promoted = await patch(session, `/api/users/${target.id}`, { role: "technician" });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.role, "technician");

  const deactivated = await patch(session, `/api/users/${target.id}`, { active: false });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.active, false);

  assert.equal((await patch(session, `/api/users/${admin.id}`, { role: "readonly" })).status, 400);
  assert.equal((await patch(session, `/api/users/${admin.id}`, { active: false })).status, 400);
});

test("the last active admin cannot be demoted or deactivated", async () => {
  const org = createOrg();
  const superuser = await createUser({ orgId: org.id, role: "superadmin" });
  const session = await signIn(app, superuser);
  const onlyAdmin = await createUser({ orgId: org.id, role: "admin" });

  // Two admins exist (superadmin + admin), so demoting one is allowed...
  assert.equal((await patch(session, `/api/users/${onlyAdmin.id}`, { role: "readonly" })).status, 200);
  // ...and now the superadmin is the last one standing.
  assert.equal(db.countActiveAdmins(org.id), 1);
  assert.equal((await patch(session, `/api/users/${superuser.id}`, { active: false })).status, 400);
});

test("users from another org are invisible", async () => {
  const orgA = createOrg();
  const orgB = createOrg();
  const { session } = await adminSession(orgA.id);
  const outsider = await createUser({ orgId: orgB.id, role: "readonly" });

  const list = await session.agent.get("/api/users");
  assert.equal(list.status, 200);
  assert.ok(!list.body.some((u) => u.id === outsider.id));
  assert.equal((await patch(session, `/api/users/${outsider.id}`, { role: "admin" })).status, 404);
});

test("an admin can reset another user's password", async () => {
  const org = createOrg();
  const { session } = await adminSession(org.id);
  const target = await createUser({ orgId: org.id, role: "technician" });

  assert.equal(
    (await post(session, `/api/users/${target.id}/reset-password`, { newPassword: "short" })).status,
    400
  );
  assert.equal(
    (await post(session, `/api/users/${target.id}/reset-password`, { newPassword: "reset-by-the-admin" })).status,
    200
  );

  const reSignIn = await signIn(app, { username: target.username, password: "reset-by-the-admin" });
  assert.equal(reSignIn.res.status, 200);
});
