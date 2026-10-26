import { sources } from './sources.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { inventory, omittedOptional, hash, json } from './inventory.mjs';

const base = '.cache/license';
rmSync(base, { recursive: true, force: true });
mkdirSync(`${base}/reports`, { recursive: true });
const records = inventory();
execFileSync('node', ['scripts/third-party-notices.mjs'], { stdio: 'inherit' });
const selected = [];
const exclusions = [];
const secret =
  /(^|\/)(?:\.env[^/]*|\.dev\.vars[^/]*|\.wrangler|\.cache|node_modules|\.git|.*\.(?:sqlite|db|sql|pem|key))(\/|$)/i;
function copy(file, scope, relative = file) {
  assert.ok(!secret.test(file), `Forbidden scan input: ${file}`);
  assert.ok(
    lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(),
    `Not a regular file: ${file}`,
  );
  const target = `${base}/input/${scope}/${relative}`;
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
  selected.push({
    path: `${scope}/${relative}`,
    sha256: hash(readFileSync(file)),
    bytes: lstatSync(file).size,
  });
}
const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
for (const file of tracked) {
  assert.ok(
    /\.(?:ts|tsx|js|mjs|astro|css|wasm|md)$/.test(file) ||
      /\/LICENSE\./.test(file),
    `Review new source file type: ${file}`,
  );
  copy(file, 'source');
}
for (const file of [
  'LICENSE',
  'package.json',
  'pnpm-lock.yaml',
  'THIRD_PARTY_NOTICES.txt',
])
  copy(file, 'source');
const runtime = { browser: new Set(), worker: new Set() };
const usedVendor = new Set();
function walk(directory, scope) {
  assert.ok(existsSync(directory), `Missing build directory: ${directory}`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Build symlink rejected: ${file}`);
    if (entry.isDirectory()) {
      assert.ok(!secret.test(file), `Forbidden build directory: ${file}`);
      walk(file, scope);
      continue;
    }
    if (file === 'dist/server/wrangler.json') {
      exclusions.push({
        path: file,
        reason: 'generated binding/environment configuration excluded',
      });
      continue;
    }
    if (entry.name.endsWith('.map')) {
      const map = json(file);
      for (const source of map.sources || []) {
        const absolute = resolve(dirname(file), map.sourceRoot || '', source);
        if (source.includes('node_modules/')) {
          let cursor = dirname(absolute);
          while (
            cursor.startsWith(resolve('node_modules')) &&
            (!existsSync(join(cursor, 'package.json')) ||
              !json(join(cursor, 'package.json')).name)
          )
            cursor = dirname(cursor);
          assert.ok(
            existsSync(join(cursor, 'package.json')),
            `Unresolved bundled source: ${source}`,
          );
          const manifest = json(join(cursor, 'package.json'));
          const key = `${manifest.name}@${manifest.version}`;
          assert.ok(
            records.some((record) => record.key === key),
            `Bundled package missing from NOTICE/SBOM: ${key}`,
          );
          runtime[scope].add(key);
        } else if (source.includes('vendor/webp')) usedVendor.add(scope);
      }
      exclusions.push({
        path: file,
        reason:
          'source map used locally for package attribution; not scanned/uploaded',
      });
      continue;
    }
    if (secret.test(file)) {
      exclusions.push({
        path: file,
        reason: 'sensitive/local configuration excluded',
      });
      continue;
    }
    if (
      ['.js', '.mjs', '.css', '.wasm'].includes(extname(file)) ||
      ['_headers', '.assetsignore'].includes(entry.name)
    ) {
      copy(
        file,
        scope,
        file.slice(`dist/${scope === 'browser' ? 'client' : 'server'}/`.length),
      );
      if (extname(file) === '.wasm') {
        assert.equal(
          hash(readFileSync(file)),
          hash(readFileSync('src/vendor/webp/codec.wasm')),
          `Unknown WASM: ${file}`,
        );
        usedVendor.add(scope);
      }
    } else throw new Error(`Unreviewed release file: ${file}`);
  }
}
// Wrangler output is configuration, not executable payload; never copy bindings/env.
// Keep this exact exclusion explicit rather than uploading all of dist/server.
const wranglerPath = 'dist/server/wrangler.json';
assert.ok(existsSync(wranglerPath), 'Missing Worker build configuration');
// Walk skips this one known generated config below.
walk('dist/client', 'browser');
walk('dist/server', 'worker');
for (const scope of ['browser', 'worker']) {
  assert.ok(
    runtime[scope].size > 0,
    `No ${scope} attribution: build with LICENSE_AUDIT=1`,
  );
  assert.ok(
    selected.some((file) => file.path.startsWith(`${scope}/`)),
    `Empty ${scope} payload`,
  );
}
assert.ok(usedVendor.has('worker'), 'Vendor WASM missing from Worker release');
const exceptions = json('docs/license/exceptions.json');
for (const [scope, keys] of Object.entries(runtime))
  for (const key of keys) {
    assert.ok(
      !exceptions.some((entry) => `${entry.name}@${entry.version}` === key),
      `Build-only exception bundled in ${scope}: ${key}`,
    );
  }
const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const packages = records.map((record, i) => ({
  SPDXID: `SPDXRef-Package-${i}`,
  name: record.name,
  versionInfo: record.version,
  downloadLocation: 'NOASSERTION',
  filesAnalyzed: false,
  licenseConcluded: 'NOASSERTION',
  licenseDeclared: record.license || 'NOASSERTION',
  copyrightText: 'NOASSERTION',
  externalRefs: [
    {
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: `pkg:npm/${record.name.replace('@', '%40')}@${record.version}`,
    },
  ],
  comment:
    ['browser', 'worker']
      .filter((scope) => runtime[scope].has(record.key))
      .join(', ') ||
    'Installed tooling or runtime candidate; not observed in emitted source maps.',
}));
packages.push({
  SPDXID: 'SPDXRef-Vendor-WebP',
  name: 'Playwright-libwebp-WASM',
  versionInfo: '1.64.1',
  downloadLocation: 'https://github.com/microsoft/playwright/tree/v1.64.1',
  filesAnalyzed: false,
  licenseDeclared: 'NOASSERTION',
  comment:
    'Preserved Apache/libwebp/Emscripten notices include additional license and patent terms; see ScanCode report and vendor notices for human review.',
  licenseConcluded: 'NOASSERTION',
  copyrightText: 'NOASSERTION',
  checksums: [
    {
      algorithm: 'SHA256',
      checksumValue: hash(readFileSync('src/vendor/webp/codec.wasm')),
    },
  ],
});
const bom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'cloudflare-native-forum-installed-inventory',
  documentNamespace: `https://spdx.org/spdxdocs/cloudflare-native-forum-${hash(JSON.stringify(selected))}`,
  creationInfo: {
    created: timestamp,
    creators: ['Tool: forum-license-inventory-1'],
  },
  documentComment:
    'Installed dependency inventory plus vendored WASM. Includes build tools; not a minimal runtime dependency graph. Uninstalled optional platforms are listed in coverage.json. Declared licenses are metadata, not legal conclusions.',
  packages,
  relationships: packages.map((pkg) => ({
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: pkg.SPDXID,
  })),
};
assert.equal(
  new Set(packages.map((pkg) => `${pkg.name}@${pkg.versionInfo}`)).size,
  records.length + 1,
  'SBOM coverage mismatch',
);
const coverage = {
  installedPackages: records.length,
  installed: records.map((record) => record.key),
  supplementalSourceReview: sources().map(({ key, status, reason }) => ({
    key,
    status,
    reason,
  })),
  missingLicenseTexts: records
    .filter((record) => !record.texts.length)
    .map((record) => record.key),
  sbomPackages: packages.length,
  browser: [...runtime.browser].sort(),
  worker: [...runtime.worker].sort(),
  vendorScopes: [...usedVendor],
  notObservedInBundles: records
    .filter((r) => !runtime.browser.has(r.key) && !runtime.worker.has(r.key))
    .map((r) => r.key),
  omittedOptionalPlatforms: [...omittedOptional].sort(),
  files: selected,
  exclusions,
  limitations: [
    'Source map attribution is conservative, not proof of complete binary provenance.',
    'Minified code and WASM detections require human review; a scan is not a legal guarantee.',
    'No uninstalled optional-platform dependency claims; no vulnerability scan.',
  ],
};
writeFileSync(
  `${base}/reports/sbom.spdx.json`,
  JSON.stringify(bom, null, 2) + '\n',
);
writeFileSync(
  `${base}/reports/coverage.json`,
  JSON.stringify(coverage, null, 2) + '\n',
);
console.log(
  `Prepared ${selected.length} files; SPDX covers ${records.length} installed packages + vendor.`,
);
