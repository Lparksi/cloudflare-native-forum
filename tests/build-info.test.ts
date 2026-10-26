import { expect, it } from 'vitest';
import { resolveBuildInfo } from '../scripts/build-info.mjs';
it('supports no-Git environments without inventing a hash', () => {
  expect(
    resolveBuildInfo({}, () => {
      throw new Error('no git');
    }),
  ).toMatchObject({ commitSha: 'dev', shortCommitSha: 'dev' });
});
it('uses CI commit and repository metadata consistently', () => {
  const sha = 'a'.repeat(40);
  expect(
    resolveBuildInfo({
      GITHUB_SHA: sha,
      PUBLIC_REPOSITORY_URL: 'https://github.com/owner/forum',
    }),
  ).toMatchObject({
    commitSha: sha,
    shortCommitSha: 'aaaaaaaaa',
    repositoryUrl: 'https://github.com/owner/forum',
  });
  expect(() => resolveBuildInfo({ GITHUB_SHA: 'latest' })).toThrow();
  expect(() =>
    resolveBuildInfo({ PUBLIC_REPOSITORY_URL: 'javascript:alert(1)' }),
  ).toThrow();
});
