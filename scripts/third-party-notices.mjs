import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  inventory,
  section,
  vendor,
  hash,
  json,
} from './license/inventory.mjs';

const outputPath = 'THIRD_PARTY_NOTICES.txt';
const indexPath = 'docs/license/notice-index.json';
const header =
  'THIRD-PARTY NOTICES\nProject code: MIT. Third-party licenses remain their own.\nIncludes installed build tools; platform-only entries may be retained from other installations.\nSee docs/licenses.md for scope and redistribution obligations.\n';
const installed = inventory();
const current = [...installed, vendor()];
const index = existsSync(indexPath) ? json(indexPath) : [];
const old = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
const blocks = old.split(/(?=\n={72}\n)/).slice(1);
const oldBlocks = new Map(blocks.map((block) => [block.split('\n')[2], block]));
const wanted = new Map(current.map((record) => [record.key, section(record)]));
const retained = index.filter(
  (record) => !wanted.has(record.key) && record.platform,
);
for (const record of retained) {
  const block = oldBlocks.get(record.key);
  assert.equal(
    hash(block || ''),
    record.sha256,
    `Invalid retained platform notice: ${record.key}`,
  );
  wanted.set(record.key, block);
}
const entries = [
  ...current.map((record) => ({
    key: record.key,
    platform: record.platform || false,
    sha256: hash(section(record)),
  })),
  ...retained,
].sort((a, b) => a.key.localeCompare(b.key, 'en'));
const output = header + entries.map((entry) => wanted.get(entry.key)).join('');
if (process.argv.includes('--write')) {
  writeFileSync(outputPath, output);
  writeFileSync(indexPath, JSON.stringify(entries, null, 2) + '\n');
} else {
  assert.equal(
    old,
    output,
    'NOTICE is stale: run pnpm notices:write and review changes',
  );
  assert.deepEqual(index, entries, 'NOTICE index is stale');
}
console.log(
  `NOTICE: ${installed.length} installed versions + vendor; ${retained.length} other-platform entries verified.`,
);
