// Run once (`npm run seed`) to bootstrap a default org + superadmin login.
// Safe to re-run: it skips creation if the org/user already exist.

const crypto = require("crypto");
const { db, uid, now, getUserByUsername } = require("./database/db");
const { hashPassword, validatePassword } = require("./auth/password");

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
  const email = process.env.SEED_ADMIN_EMAIL || `${username}@local`;
  const password = process.env.SEED_ADMIN_PASS;

  if (!password && !getUserByUsername(username)) {
    console.error(
      "\nSEED_ADMIN_PASS is not set. Refusing to seed a default/guessable password.\n" +
      "Run again with, e.g.:\n" +
      "  SEED_ADMIN_PASS='a strong password' npm run seed\n"
    );
    process.exit(1);
  }

  const existingUser = getUserByUsername(username);
  if (!existingUser) {
    const invalid = validatePassword(password);
    if (invalid) {
      console.error(`\nSEED_ADMIN_PASS rejected: ${invalid}.\n`);
      process.exit(1);
    }
    const hash = await hashPassword(password);
    db.prepare(`
      INSERT INTO users (id, org_id, email, username, password_hash, role, created_at, updated_at)
      VALUES (@id, @org_id, @email, @username, @password_hash, 'superadmin', @created_at, @created_at)
    `).run({ id: uid(), org_id: org.id, email, username, password_hash: hash, created_at: now() });
    console.log("Created superadmin user:", username);
  } else {
    console.log("User already exists:", username);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(" Dashboard login:");
  console.log("   username:", username);
  console.log("   password:", existingUser ? "(unchanged - already existed)" : "(the SEED_ADMIN_PASS value you set)");
  console.log("   role:    ", existingUser ? existingUser.role : "superadmin");
  console.log("\n Agent token (set as AGENT_TOKEN when starting an agent):");
  console.log("  ", org.agent_token);
  console.log("──────────────────────────────────────────────\n");
  console.log("Sign in, then use Account → Change your password to rotate it, and Account → Users to invite the rest of your team.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed:", err.message);
    process.exit(1);
  });
