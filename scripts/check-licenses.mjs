import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(pkg.license, 'MIT');
const license = readFileSync('LICENSE', 'utf8');
for (const part of [
  'Permission is hereby granted, free of charge',
  'THE SOFTWARE IS PROVIDED "AS IS"',
  'Copyright (c) 2026',
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
// Astro's native image compiler and Tailwind's CSS compiler are build tools;
// no libvips or Lightning CSS binary is included in the deployed Worker.
const buildOnly = {
  'LGPL-3.0-or-later': /^@img\/sharp-libvips-/,
  'MPL-2.0': /^lightningcss(?:-|$)/,
};
const rejected = Object.entries(licenses)
  .filter(
    ([license, packages]) =>
      !allowed.has(license) &&
      !packages.every((pkg) => buildOnly[license]?.test(pkg.name)),
  )
  .map(([license]) => license);
assert.deepEqual(
  rejected,
  [],
  `Review new dependency licenses: ${rejected.join(', ')}`,
);
console.log(
  `MIT license and ${Object.values(licenses).flat().length} dependency license records checked.`,
);
