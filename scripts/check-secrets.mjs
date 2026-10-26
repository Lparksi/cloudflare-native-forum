import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bsk_live_[A-Za-z0-9]{16,}\b/,
];
const failures = files.filter((file) =>
  patterns.some((pattern) => pattern.test(readFileSync(file, 'utf8'))),
);
if (failures.length)
  throw new Error(`Potential secrets in: ${failures.join(', ')}`);
console.log(
  `Basic secret pattern scan passed (${files.length} files). CI also runs Gitleaks.`,
);
