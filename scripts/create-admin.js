// Usage: npm run create-admin -- admin@example.com
// Prompts for a password and creates the admin (or resets the password if the email exists).
require('dotenv').config();
const readline = require('readline');
const { pool } = require('../src/db');
const { hashPassword, isEmail } = require('../src/util');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!isEmail(email)) {
    console.error('Usage: npm run create-admin -- admin@example.com');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || await askHidden('Password (min 8 chars): ');
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  await pool.query(
    'INSERT INTO admins (email, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
    [email, await hashPassword(password)]
  );
  console.log(`Admin ${email} is ready.`);
  await pool.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
