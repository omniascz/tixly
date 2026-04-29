#!/usr/bin/env node

/**
 * Generate a bcryptjs password hash for use in seed-owner.sql
 *
 * Usage:
 *   node scripts/generate-password-hash.js "your-password"
 *
 * Output:
 *   $2b$12$...hash...
 *
 * Copy the hash and paste it into the password_hash field in seed-owner.sql
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Usage: node generate-password-hash.js "your-password"');
  process.exit(1);
}

bcrypt
  .hash(password, 12)
  .then((hash) => {
    console.log(hash);
  })
  .catch((err) => {
    console.error('Error generating hash:', err.message);
    process.exit(1);
  });
