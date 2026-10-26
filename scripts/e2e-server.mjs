import { execFileSync, spawn } from 'node:child_process';
if (!process.env.FORUM_STATE_PATH)
  throw new Error('E2E requires an isolated FORUM_STATE_PATH');
const options = {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_LOG_PATH: '.wrangler/logs' },
};
execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--persist-to',
    process.env.FORUM_STATE_PATH,
  ],
  options,
);
execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--local',
    '--persist-to',
    process.env.FORUM_STATE_PATH,
    '--file',
    'db/seed.sql',
  ],
  options,
);
const child = spawn(
  'pnpm',
  ['preview', '--port', '4321', '--ignore-lock'],
  options,
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
