import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { validateSources } from '../scripts/license/sources.mjs';

const bytes = Buffer.from('upstream license text');
const checksum = createHash('sha256').update(bytes).digest('hex');
const integrity = 'sha512-' + Buffer.from('digest').toString('base64');
const commit = 'a'.repeat(40);
const fixture = () => ({
  key: 'example@1.0.0',
  integrity,
  commit,
  status: 'text-collected',
  texts: [
    {
      file: `docs/license/texts/${checksum}.txt`,
      sha256: checksum,
      url: `https://raw.githubusercontent.com/owner/repo/${commit}/LICENSE`,
    },
  ],
  provenance: [
    {
      subject: [{ digest: { sha512: Buffer.from('digest').toString('hex') } }],
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: {
        buildDefinition: {
          resolvedDependencies: [{ digest: { gitCommit: commit } }],
        },
      },
    },
  ],
});
const lock = `  example@1.0.0:\n    resolution: {integrity: ${integrity}}`;
describe('supplemental license evidence', () => {
  it('accepts version, provenance and original text bound to the lock', () => {
    expect(() => validateSources([fixture()], lock, () => bytes)).not.toThrow();
  });
  it('rejects changed upstream text', () => {
    expect(() =>
      validateSources([fixture()], lock, () => Buffer.from('altered')),
    ).toThrow('Source text altered');
  });
  it('rejects stale package versions and changed lock integrity', () => {
    expect(() =>
      validateSources([fixture()], lock.replace('1.0.0', '2.0.0')),
    ).toThrow('absent from lock');
    expect(() =>
      validateSources([fixture()], lock.replace(integrity, 'sha512-other')),
    ).toThrow('integrity differs');
  });
  it('rejects a different publication source or artifact digest', () => {
    const source = fixture();
    source.commit = 'b'.repeat(40);
    expect(() => validateSources([source], lock)).toThrow(
      'Provenance commit differs',
    );
    const artifact = fixture();
    artifact.provenance[0].subject[0].digest.sha512 = 'bad';
    expect(() => validateSources([artifact], lock)).toThrow(
      'Provenance subject differs',
    );
  });
  it('rejects duplicate evidence and false collection status', () => {
    expect(() =>
      validateSources([fixture(), fixture()], lock, () => bytes),
    ).toThrow('Duplicate source');
    const pending = fixture();
    pending.status = 'pending-source-review';
    expect(() => validateSources([pending], lock, () => bytes)).toThrow();
  });
});
