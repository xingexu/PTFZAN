// Read a password from stdin; only the salted hash is written to stdout.
import { randomBytes, scrypt } from 'node:crypto';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks).toString().replace(/\r?\n$/, '');
if (!password || password.length > 256) throw new Error('Supply a password of 1–256 characters on stdin.');
const salt = randomBytes(16).toString('hex');
scrypt(password, salt, 64, { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 }, (error, key) => {
  if (error) throw error;
  process.stdout.write(`scrypt:${salt}:${key.toString('hex')}\n`);
});
