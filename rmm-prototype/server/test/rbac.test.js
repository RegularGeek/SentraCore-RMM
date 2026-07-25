require("./env");

const test = require("node:test");
const assert = require("node:assert/strict");

const { requireRole } = require("../middleware/requireRole");
const { validatePassword, hashPassword, verifyPassword } = require("../auth/password");

function runMiddleware(middleware, role) {
  const calls = { next: 0, status: null, body: null };
  const res = {
    status(code) { calls.status = code; return this; },
    json(body) { calls.body = body; return this; },
  };
  middleware({ session: { role } }, res, () => { calls.next += 1; });
  return calls;
}

test("requireRole allows the named role and everything above it", () => {
  const middleware = requireRole("technician");
  for (const role of ["technician", "admin", "superadmin"]) {
    assert.equal(runMiddleware(middleware, role).next, 1, role);
  }
});

test("requireRole blocks weaker and unknown roles", () => {
  const middleware = requireRole("technician");
  assert.equal(runMiddleware(middleware, "readonly").status, 403);
  assert.equal(runMiddleware(middleware, "intern").status, 403);
  assert.equal(runMiddleware(middleware, undefined).status, 403);
});

test("requireRole refuses to be configured with an unknown role", () => {
  assert.throws(() => requireRole("wizard"), /unknown role/);
});

test("password policy rejects short and obvious passwords", () => {
  assert.equal(validatePassword("a-perfectly-fine-password"), null);
  assert.match(validatePassword("short"), /at least/);
  assert.match(validatePassword("changeme123"), /too common/);
  assert.match(validatePassword(undefined), /at least/);
});

test("hashes are salted and verifiable", async () => {
  const hash = await hashPassword("a-perfectly-fine-password");
  assert.notEqual(hash, "a-perfectly-fine-password");
  assert.equal(await verifyPassword("a-perfectly-fine-password", hash), true);
  assert.equal(await verifyPassword("something-else", hash), false);
  assert.notEqual(hash, await hashPassword("a-perfectly-fine-password"));
});
