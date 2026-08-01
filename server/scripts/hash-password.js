#!/usr/bin/env node
// Generates a bcrypt password hash for ADMIN_PASSWORD_HASH.
// Usage: node server/scripts/hash-password.js "your-secure-password"
import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node server/scripts/hash-password.js "<password>"');
  process.exit(1);
}
if (Buffer.byteLength(password, 'utf8') > 72) {
  console.error('Error: password must be 72 bytes or fewer (bcrypt limit).');
  process.exit(1);
}
const hash = await bcrypt.hash(password, 12);
console.log(hash);
