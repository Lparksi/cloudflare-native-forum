import assert from 'node:assert/strict';
import { resolveBuildInfo } from './build-info.mjs';
const data = resolveBuildInfo();
assert.match(data.version, /^\d+\.\d+\.\d+$/);
assert.ok(data.commitSha === 'dev' || /^[0-9a-f]{40}$/i.test(data.commitSha));
assert.equal(
  resolveBuildInfo({}, () => {
    throw new Error('no git');
  }).commitSha,
  'dev',
);
const ci = resolveBuildInfo({
  GITHUB_SHA: 'a'.repeat(40),
  PUBLIC_REPOSITORY_URL: 'https://github.com/example/forum',
});
assert.equal(
  `${ci.repositoryUrl}/commit/${ci.commitSha}`,
  `https://github.com/example/forum/commit/${'a'.repeat(40)}`,
);
console.log(`Build metadata valid: v${data.version} · ${data.shortCommitSha}`);
