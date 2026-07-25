require("./env");

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildApp, createOrg, createUser, signIn, post, patch, del } = require("./support");

const app = buildApp();

const RULE = { metric: "cpuLoad", comparator: ">", threshold: 90 };

async function sessionFor(orgId, role) {
  return signIn(app, await createUser({ orgId, role }));
}

test("a technician can create a rule; a readonly user cannot", async () => {
  const org = createOrg();
  const tech = await sessionFor(org.id, "technician");
  const readonly = await sessionFor(org.id, "readonly");

  const created = await post(tech, "/api/alert-rules", RULE);
  assert.equal(created.status, 201);
  assert.equal(created.body.enabled, 1);

  assert.equal((await post(readonly, "/api/alert-rules", RULE)).status, 403);
  // Reading stays open to every role.
  assert.equal((await readonly.agent.get("/api/alert-rules")).status, 200);
});

test("rule input is validated", async () => {
  const org = createOrg();
  const tech = await sessionFor(org.id, "technician");

  const bad = [
    { ...RULE, metric: "temperature" },
    { ...RULE, comparator: "~" },
    { ...RULE, threshold: "hot" },
    { ...RULE, webhookUrl: "javascript:alert(1)" },
  ];
  for (const body of bad) {
    assert.equal((await post(tech, "/api/alert-rules", body)).status, 400, JSON.stringify(body));
  }
});

test("rules can be paused and resumed instead of deleted", async () => {
  const org = createOrg();
  const tech = await sessionFor(org.id, "technician");
  const { body: rule } = await post(tech, "/api/alert-rules", RULE);

  const paused = await patch(tech, `/api/alert-rules/${rule.id}`, { enabled: false });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.enabled, 0);

  const resumed = await patch(tech, `/api/alert-rules/${rule.id}`, { enabled: true });
  assert.equal(resumed.body.enabled, 1);

  assert.equal((await patch(tech, `/api/alert-rules/${rule.id}`, { enabled: "yes" })).status, 400);
});

test("only admins can delete rules", async () => {
  const org = createOrg();
  const tech = await sessionFor(org.id, "technician");
  const admin = await sessionFor(org.id, "admin");
  const { body: rule } = await post(tech, "/api/alert-rules", RULE);

  assert.equal((await del(tech, `/api/alert-rules/${rule.id}`)).status, 403);
  assert.equal((await del(admin, `/api/alert-rules/${rule.id}`)).status, 200);
  assert.equal((await del(admin, `/api/alert-rules/${rule.id}`)).status, 404);
});

test("rules are scoped to the caller's org", async () => {
  const orgA = createOrg();
  const orgB = createOrg();
  const inA = await sessionFor(orgA.id, "admin");
  const inB = await sessionFor(orgB.id, "admin");
  const { body: rule } = await post(inA, "/api/alert-rules", RULE);

  assert.deepEqual((await inB.agent.get("/api/alert-rules")).body, []);
  assert.equal((await patch(inB, `/api/alert-rules/${rule.id}`, { enabled: false })).status, 404);
  assert.equal((await del(inB, `/api/alert-rules/${rule.id}`)).status, 404);
});

test("unknown API routes return JSON, not HTML", async () => {
  const org = createOrg();
  const admin = await sessionFor(org.id, "admin");

  const res = await admin.agent.get("/api/does-not-exist");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "not found");
});
