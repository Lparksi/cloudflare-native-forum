import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sources, verifyWebpSources } from './sources.mjs';

const digest = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);
async function download(url) {
  const parsed = new URL(url);
  assert.ok(
    parsed.protocol === 'https:' &&
      ['registry.npmjs.org', 'raw.githubusercontent.com'].includes(
        parsed.hostname,
      ),
    `Unexpected evidence host: ${url}`,
  );
  const response = await globalThis.fetch(url, {
    signal: globalThis.AbortSignal.timeout(120000),
  });
  assert.ok(response.ok, `Evidence fetch failed: ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const records = sources();
verifyWebpSources();
if (process.argv.includes('--fetch')) {
  const directory = mkdtempSync(join(tmpdir(), 'forum-license-source-'));
  try {
    for (let offset = 0; offset < records.length; offset += 4) {
      await Promise.all(
        records.slice(offset, offset + 4).map(async (record, i) => {
          const metadata = JSON.parse(await download(record.metadataUrl));
          assert.equal(`${metadata.name}@${metadata.version}`, record.key);
          assert.equal(metadata.dist.integrity, record.integrity);
          if (!record.provenance && !record.tag && record.commit)
            assert.equal(metadata.gitHead, record.commit);
          if (record.tag) {
            const refs = execFileSync(
              'git',
              [
                'ls-remote',
                '--tags',
                record.repository,
                `refs/tags/${record.tag}`,
                `refs/tags/${record.tag}^{}`,
              ],
              { encoding: 'utf8' },
            )
              .trim()
              .split('\n');
            const peeled = refs.find((ref) => ref.endsWith('^{}')) || refs[0];
            assert.equal(
              peeled.split('\t')[0],
              record.commit,
              `Version tag changed: ${record.key}`,
            );
          }
          const archive = await download(record.tarball);
          assert.equal(
            `sha512-${digest(archive, 'sha512', 'base64')}`,
            record.integrity,
          );
          assert.equal(digest(archive), record.tarballSha256);
          const path = join(directory, `${offset + i}.tgz`);
          writeFileSync(path, archive);
          if (record.attestation) {
            const evidence = JSON.parse(await download(record.attestation));
            const statements = evidence.attestations
              .map((entry) => entry.bundle?.dsseEnvelope?.payload)
              .filter(Boolean)
              .map((payload) => JSON.parse(Buffer.from(payload, 'base64')));
            // This verifies the registry-served payload, not Sigstore signatures.
            assert.deepEqual(
              statements,
              record.provenance,
              `Published provenance changed: ${record.key}`,
            );
          }
          for (const text of record.texts) {
            const bytes = text.archivePath
              ? execFileSync('tar', ['-xzOf', path, text.archivePath])
              : await download(text.url);
            assert.equal(
              digest(bytes),
              text.sha256,
              `Upstream text differs: ${record.key}/${text.name}`,
            );
          }
        }),
      );
    }
    for (const file of JSON.parse(
      readFileSync('docs/license/webp-evidence.json', 'utf8'),
    ).files) {
      assert.equal(
        digest(await download(file.url)),
        file.sha256,
        `WebP evidence changed: ${file.url}`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
console.log(
  `Sources: ${records.length} exact versions, ${records.filter((record) => record.texts.length).length} with supplemental text; ${records.filter((record) => !record.texts.length).length} unresolved. ${process.argv.includes('--fetch') ? 'Official sources downloaded and hashes verified.' : 'Offline lock/provenance/text validation only.'}`,
);
