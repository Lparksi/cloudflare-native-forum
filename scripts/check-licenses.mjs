import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// Vendored runtime binary is outside the npm dependency tree; keep its provenance checked.
assert.equal(
  createHash('sha256')
    .update(readFileSync('src/vendor/webp/codec.wasm'))
    .digest('hex'),
  '164cd9583a3e4d081f767d3b41ff0a730443dc7535fcc5caff83561463384b79',
);
assert.ok(
  readFileSync('src/vendor/webp/LICENSE.playwright', 'utf8').includes(
    'Apache License',
  ),
);
const codecNotice = readFileSync(
  'src/vendor/webp/LICENSE.libwebp-emscripten',
  'utf8',
);
assert.ok(
  codecNotice.includes('Redistribution and use in source and binary forms'),
);
assert.ok(codecNotice.includes('Emscripten'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(pkg.license, 'MIT');
const license = readFileSync('LICENSE', 'utf8');
for (const part of [
  'Permission is hereby granted, free of charge',
  'THE SOFTWARE IS PROVIDED "AS IS"',
  'Copyright (c) 2026 Lparksi <parksi@lparksi.com>',
])
  assert.ok(license.includes(part));
const licenses = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }),
);
// Explicit commercially compatible SPDX expressions used by the locked dependency tree.
const allowed = new Set([
  'MIT',
  'MIT OR Apache-2.0',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
  '(MIT OR CC0-1.0)',
  '(MIT OR Apache-2.0)',
  '(Apache-2.0 OR MIT)',
  '(MIT AND CC-BY-3.0)',
  'CC-BY-4.0',
  'BlueOak-1.0.0',
]);
// Exceptions are exact package/version/license/purpose records, never name patterns.
const exceptions = JSON.parse(
  readFileSync('docs/license/exceptions.json', 'utf8'),
);
const rejected = [];
for (const [license, packages] of Object.entries(licenses)) {
  if (allowed.has(license)) continue;
  for (const pkg of packages)
    for (const version of pkg.versions) {
      if (
        !exceptions.some(
          (entry) =>
            entry.name === pkg.name &&
            entry.version === version &&
            entry.license === license &&
            entry.purpose === 'build-only',
        )
      ) {
        rejected.push(`${pkg.name}@${version}: ${license}`);
      }
    }
}
assert.deepEqual(
  rejected,
  [],
  `Review new dependency licenses: ${rejected.join(', ')}`,
);
console.log(
  `MIT license and ${Object.values(licenses).flat().length} dependency license records checked.`,
);
