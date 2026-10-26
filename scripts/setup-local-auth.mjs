import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.dev.vars')) {
  console.log(
    'Existing .dev.vars preserved. Ensure BETTER_AUTH_SECRET has at least 32 random characters.',
  );
} else {
  writeFileSync(
    '.dev.vars',
    `BETTER_AUTH_SECRET="${randomBytes(48).toString('base64url')}"\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Created ignored .dev.vars with a random local-only auth secret.',
  );
}
