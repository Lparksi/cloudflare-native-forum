import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** @param {Record<string, string | undefined>} environment */
export function resolveBuildInfo(
  environment = process.env,
  git = () =>
    execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
) {
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  let commitSha = environment.GITHUB_SHA;
  if (!commitSha) {
    try {
      commitSha = git();
    } catch {
      commitSha = 'dev';
    }
  }
  if (commitSha !== 'dev' && !/^[a-f0-9]{40}$/i.test(commitSha))
    throw new Error('Build SHA must be a full Git commit SHA');
  const repository = environment.PUBLIC_REPOSITORY_URL;
  if (
    repository &&
    !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository)
  )
    throw new Error(
      'Repository URL must be an HTTPS GitHub repository URL without trailing slash',
    );
  return Object.freeze({
    version,
    commitSha,
    shortCommitSha: commitSha === 'dev' ? 'dev' : commitSha.slice(0, 9),
    buildTime: new Date().toISOString(),
    repositoryUrl: repository || null,
  });
}
