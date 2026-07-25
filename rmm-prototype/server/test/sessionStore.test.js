require("./env");

const test = require("node:test");
const assert = require("node:assert/strict");
const { promisify } = require("node:util");

const { SqliteSessionStore } = require("../auth/sessionStore");

function promisifiedStore() {
  const store = new SqliteSessionStore({ ttlMs: 60000 });
  return {
    store,
    get: promisify(store.get.bind(store)),
    set: promisify(store.set.bind(store)),
    destroy: promisify(store.destroy.bind(store)),
    length: promisify(store.length.bind(store)),
  };
}

test("round-trips a session through SQLite", async () => {
  const { store, get, set, destroy } = promisifiedStore();

  await set("sid-1", { cookie: { maxAge: 60000 }, userId: "u1" });
  assert.equal((await get("sid-1")).userId, "u1");

  await set("sid-1", { cookie: { maxAge: 60000 }, userId: "u1", role: "admin" });
  assert.equal((await get("sid-1")).role, "admin");

  await destroy("sid-1");
  assert.equal(await get("sid-1"), null);
  store.stopPruning();
});

test("expired sessions are treated as absent and dropped", async () => {
  const { store, get, set, length } = promisifiedStore();

  await set("sid-expired", { cookie: { expires: new Date(Date.now() - 1000) }, userId: "u2" });
  const before = await length();
  assert.equal(await get("sid-expired"), null);
  assert.equal(await length(), before - 1);
  store.stopPruning();
});
