const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 10;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Deliberately a length/obviousness floor rather than a composition ruleset
// (forced symbol classes push people toward "Passw0rd!"). Returns null when
// the password is acceptable, otherwise the reason it isn't.
const OBVIOUS = new Set(["password", "changeme", "changeme123", "letmein", "admin1234", "sentracore"]);

function validatePassword(plain) {
  if (typeof plain !== "string" || plain.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (OBVIOUS.has(plain.toLowerCase())) return "password is too common";
  return null;
}

module.exports = { hashPassword, verifyPassword, validatePassword, MIN_PASSWORD_LENGTH };
