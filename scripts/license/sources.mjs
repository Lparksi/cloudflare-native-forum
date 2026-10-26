import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function validateSources(
  records,
  lock,
  read = (file) => readFileSync(file),
) {
  const keys = new Set();
  const lines = lock.split('\n');
  for (const record of records) {
    assert.ok(!keys.has(record.key), `Duplicate source: ${record.key}`);
    keys.add(record.key);
    const position = lines.findIndex(
      (line) => line === `  '${record.key}':` || line === `  ${record.key}:`,
    );
    assert.ok(position >= 0, `Source version absent from lock: ${record.key}`);
    assert.ok(
      lines[position + 1].includes(`integrity: ${record.integrity}`),
      `Source integrity differs from lock: ${record.key}`,
    );
    assert.ok(
      ['text-collected', 'pending-source-review'].includes(record.status),
      `Invalid collection status: ${record.key}`,
    );
    for (const statement of record.provenance || []) {
      for (const subject of statement.subject || []) {
        assert.equal(
          subject.digest.sha512,
          Buffer.from(
            record.integrity.slice('sha512-'.length),
            'base64',
          ).toString('hex'),
          `Provenance subject differs: ${record.key}`,
        );
      }
      if (statement.predicateType === 'https://slsa.dev/provenance/v1') {
        assert.ok(
          statement.predicate.buildDefinition.resolvedDependencies.some(
            (dep) => dep.digest?.gitCommit === record.commit,
          ),
          `Provenance commit differs: ${record.key}`,
        );
      }
    }
    for (const match of record.sourceMatches || []) {
      assert.ok(match.url.includes(`/${record.commit}/`));
      assert.equal(
        record.packageFiles.find((file) => file.path === match.path)?.sha256,
        match.sha256,
        `Equivalent source differs from package: ${record.key}/${match.path}`,
      );
    }
    for (const text of record.texts) {
      assert.match(text.file, /^docs\/license\/texts\/[a-f0-9]{64}\.txt$/);
      assert.equal(
        sha256(read(text.file)),
        text.sha256,
        `Source text altered: ${record.key}/${text.name}`,
      );
      if (text.linkedFrom) {
        assert.equal(
          record.packageFiles.find((file) => file.path === text.linkedFrom.path)
            ?.sha256,
          text.linkedFrom.sha256,
        );
        assert.equal(text.url, text.linkedFrom.url.replace(/^http:/, 'https:'));
      }
      if (!text.archivePath && !text.linkedFrom)
        assert.ok(
          text.url.includes(`/${record.commit}/`),
          `Unpinned source: ${text.url}`,
        );
    }
    assert.equal(record.status === 'text-collected', record.texts.length > 0);
  }
}
let cached;
export function sources() {
  if (!cached) {
    cached = JSON.parse(readFileSync('docs/license/sources.json', 'utf8'));
    validateSources(cached, readFileSync('pnpm-lock.yaml', 'utf8'));
  }
  return cached;
}
export function supplementalTexts(key, directory) {
  const record = sources().find((record) => record.key === key);
  if (!record) return [];
  // Compare every original tarball file, not just package.json. Postinstall additions
  // are outside this comparison; the upstream archive digest is separately recorded.
  for (const file of record.packageFiles) {
    assert.ok(
      !file.path.split('/').includes('..') && !file.path.startsWith('/'),
    );
    let expected = file.sha256;
    if (file.postinstallReplacement) {
      const replacement = file.postinstallReplacement;
      assert.equal(
        process.platform,
        replacement.platform,
        'Review postinstall binary on this platform',
      );
      assert.equal(
        process.arch,
        replacement.arch,
        'Review postinstall binary on this architecture',
      );
      const name = replacement.package.slice(
        0,
        replacement.package.lastIndexOf('@'),
      );
      const require = createRequire(resolve(directory, 'package.json'));
      const manifest = require(`${name}/package.json`);
      assert.equal(`${manifest.name}@${manifest.version}`, replacement.package);
      assert.equal(
        sha256(readFileSync(require.resolve(`${name}/${replacement.path}`))),
        replacement.sha256,
      );
      expected = replacement.sha256;
    }
    assert.equal(
      sha256(readFileSync(join(directory, file.path))),
      expected,
      `Installed package differs from source archive: ${key}/${file.path}`,
    );
  }
  return record.texts.map((text) => ({
    name: `supplement/${text.name} (source: ${text.url}; sha256: ${text.sha256})`,
    text: readFileSync(text.file, 'utf8'),
  }));
}

export function verifyWebpSources() {
  const evidence = JSON.parse(
    readFileSync('docs/license/webp-evidence.json', 'utf8'),
  );
  for (const file of evidence.files) {
    if (file.local)
      assert.equal(
        sha256(readFileSync(file.local)),
        file.sha256,
        `WebP source material altered: ${file.local}`,
      );
  }
}
