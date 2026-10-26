import { execFileSync } from 'node:child_process';
const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error('Usage: pnpm admin:bootstrap verified-email@example.com');
const quoted = `'${email.replaceAll("'", "''")}'`;
// Deliberately local-only, one-time bootstrap. Subsequent grants must use audited admin API.
const command = `INSERT INTO moderation_logs(id,actor_id,action,target_kind,target_id,reason,created_at)
SELECT lower(hex(randomblob(16))),a.user_id,'bootstrap','user',a.user_id,'Local operator bootstrap',unixepoch()*1000
FROM account_access a INNER JOIN user u ON u.id=a.user_id WHERE u.email=${quoted} AND u.email_verified=1 AND a.banned=0 AND a.role='member'
AND NOT EXISTS(SELECT 1 FROM account_access WHERE role='admin' AND banned=0) RETURNING id;`;
const result = execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--local',
    ...(process.env.FORUM_STATE_PATH
      ? ['--persist-to', process.env.FORUM_STATE_PATH]
      : []),
    '--command',
    command,
    '--json',
  ],
  {
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_LOG_PATH: '.wrangler/logs' },
  },
);
const rows = JSON.parse(result);
if (!rows[0]?.results?.length)
  throw new Error(
    'No account changed: ensure email is verified and no active administrator exists',
  );
console.log(
  'First local administrator granted and audit recorded. No remote database was accessed.',
);
