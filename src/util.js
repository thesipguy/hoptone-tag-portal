const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_ROUNDS);
const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

// "1001, 1002,1001 , abc@pbx" -> "1001,1002,abc@pbx"
function normalizeSipDevices(input) {
  const seen = new Set();
  for (const part of String(input || '').split(',')) {
    const d = part.trim();
    if (d) seen.add(d);
  }
  return [...seen].join(',');
}

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (s) => EMAIL_RE.test(String(s || ''));

module.exports = { hashPassword, checkPassword, normalizeSipDevices, slugify, isEmail };
