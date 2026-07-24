// Thin model-style wrapper around the users table. The actual queries live
// in database/db.js (better-sqlite3 prepared statements are cheap to keep
// centralized there); this file exists so route/service code can import
// "the User model" the way the requested folder structure implies, without
// a full ORM for a beta this size.
const db = require("../database/db");

const User = {
  findByUsername: db.getUserByUsername,
  findByEmail: db.getUserByEmail,
  findById: db.getUserById,
  create: db.createUser,
  touchLastLogin: db.touchLastLogin,
  ROLES: db.ROLES,
};

module.exports = User;
