// Run once (`npm run seed`) to bootstrap a default org + admin login.
// Safe to re-run: it skips creation if the org/user already exist.

const crypto = require("crypto");
const { db, uid, now, getOrgByToken, getUserByUsername } = require("./db");
const { hashPassword } = require("./auth");

async function main() {
  const existingOrg = db.prepare("SELECT * FROM orgs WHERE name = ?").get("Default Org");
  let org = existingOrg;

  if (!org) {
    org = {
      id: uid(),
      name: "Default Org",
      agent_token: crypto.randomBytes(24).toString("hex"),
      created_at: now(),
    };
    db.prepare("INSERT INTO orgs (id, name, agent_token, created_at) VALUES (@id, @name, @agent_token, @created_at)").run(org);
    console.log("Created org:", org.name);
  } else {
    console.log("Org already exists:", org.name);
  }

  const username = process.env.SEED_ADMIN_USER || "admin";
  const password = process.env.SEED_ADMIN_PASS || "changeme123";

  const existingUser = getUserByUsername(username);
  if (!existingUser) {
    const hash = await hashPassword(password);
    db.prepare(`
      INSERT INTO users (id, org_id, username, password_hash, role, created_at)
      VALUES (@id, @org_id, @username, @password_hash, 'admin', @created_at)
    `).run({ id: uid(), org_id: org.id, username, password_hash: hash, created_at: now() });
    console.log("Created admin user:", username);
  } else {
    console.log("User already exists:", username);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(" Dashboard login:");
  console.log("   username:", username);
  console.log("   password:", existingUser ? "(unchanged - already existed)" : password);
  console.log("\n Agent token (set as AGENT_TOKEN when starting an agent):");
  console.log("  ", org.agent_token);
  console.log("──────────────────────────────────────────────\n");
  console.log("Change the admin password after first login in a real deployment.");
}

main().then(() => process.exit(0));
