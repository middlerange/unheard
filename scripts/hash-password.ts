// ABOUTME: CLI utility to hash a password for the ADMIN_PASSWORD_HASH env var.
// ABOUTME: Usage: npx tsx scripts/hash-password.ts <password>

import { scrypt, randomBytes } from 'crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: npx tsx scripts/hash-password.ts <password>');
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
scrypt(password, salt, 64, (err, key) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`${salt}:${key.toString('hex')}`);
});
