import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const report = resolve('scripts/license/report.mjs');
const checksum = 'a'.repeat(64);
type Fixture = {
  coverage: {
    installedPackages: number;
    missingLicenseTexts: string[];
    installed: string[];
    sbomPackages: number;
    browser: string[];
    worker: string[];
    omittedOptionalPlatforms: string[];
    files: { path: string; sha256: string }[];
  };
  scan: {
    headers: { tool_version: string; errors: string[] }[];
    files: {
      path: string;
      type: string;
      sha256?: string;
      detected_license_expression?: string;
      scan_errors?: string[];
    }[];
  };
  bom: { packages: { name: string; versionInfo: string }[] };
};
function fixture(change: (data: Fixture) => void = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'forum-license-test-'));
  const data: Fixture = {
    coverage: {
      installedPackages: 1,
      missingLicenseTexts: [],
      installed: ['example@1'],
      sbomPackages: 2,
      browser: ['example@1'],
      worker: [],
      omittedOptionalPlatforms: [],
      files: [{ path: 'source/file.js', sha256: checksum }],
    },
    scan: {
      headers: [{ tool_version: '32.4.1', errors: [] }],
      files: [
        {
          path: 'input/source/file.js',
          type: 'file',
          sha256: checksum,
          detected_license_expression: 'unknown-license-reference',
          scan_errors: [],
        },
      ],
    },
    bom: {
      packages: [
        { name: 'example', versionInfo: '1' },
        { name: 'vendor', versionInfo: '1' },
      ],
    },
  };
  change(data);
  const reports = join(directory, '.cache/license/reports');
  mkdirSync(reports, { recursive: true });
  for (const [key, filename] of [
    ['coverage', 'coverage.json'],
    ['scan', 'scancode.json'],
    ['bom', 'sbom.spdx.json'],
  ])
    writeFileSync(
      join(reports, filename),
      JSON.stringify(data[key as keyof typeof data]),
    );
  const result = spawnSync(process.execPath, [report], {
    cwd: directory,
    encoding: 'utf8',
  });
  rmSync(directory, { recursive: true });
  return result;
}

describe('license report integrity', () => {
  it('reports an unreviewed license without treating it as a legal rejection', () => {
    expect(fixture().status).toBe(0);
  });
  it.each(['empty', 'missing', 'extra', 'error', 'checksum', 'sbom'] as const)(
    'fails on %s evidence',
    (failure) => {
      const result = fixture((data) => {
        if (failure === 'empty') data.scan.files = [];
        if (failure === 'missing')
          data.coverage.files.push({
            path: 'source/absent.js',
            sha256: checksum,
          });
        if (failure === 'extra')
          data.scan.files.push({
            path: 'input/source/unselected.js',
            type: 'file',
          });
        if (failure === 'error')
          data.scan.files[0].scan_errors?.push('scanner timeout');
        if (failure === 'checksum') data.scan.files[0].sha256 = 'b'.repeat(64);
        if (failure === 'sbom') data.bom.packages[0].name = 'wrong-package';
      });
      expect(result.status).not.toBe(0);
    },
  );
  it('keeps the new shell entrypoint syntactically executable', () => {
    expect(() =>
      execFileSync('bash', ['-n', 'scripts/license/install-scancode.sh']),
    ).not.toThrow();
  });
});

// Exercise platform retention and stale text checks with a tiny installed tree.
describe('NOTICE platform handling', () => {
  const notices = resolve('scripts/third-party-notices.mjs');
  function runScenario(platform: boolean, tamper = false) {
    const directory = mkdtempSync(join(tmpdir(), 'forum-notice-test-'));
    mkdirSync(join(directory, 'docs/license'), { recursive: true });
    writeFileSync(join(directory, 'docs/license/sources.json'), '[]');
    writeFileSync(join(directory, 'pnpm-lock.yaml'), '');
    const packagePath = join(directory, 'node_modules/example');
    const extraPath = join(directory, 'node_modules/extra');
    for (const path of [
      packagePath,
      extraPath,
      join(directory, 'docs/license'),
      join(directory, 'src/vendor/webp'),
      join(directory, 'bin'),
    ])
      mkdirSync(path, { recursive: true });
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ dependencies: { example: '1' } }),
    );
    writeFileSync(
      join(packagePath, 'package.json'),
      JSON.stringify({ name: 'example', version: '1' }),
    );
    writeFileSync(join(packagePath, 'LICENSE'), 'MIT original license text');
    writeFileSync(
      join(extraPath, 'package.json'),
      JSON.stringify({
        name: 'extra',
        version: '1',
        ...(platform ? { os: ['darwin'] } : {}),
      }),
    );
    writeFileSync(
      join(extraPath, 'LICENSE'),
      'Third-party original license text',
    );
    for (const name of ['LICENSE.playwright', 'LICENSE.libwebp-emscripten'])
      writeFileSync(
        join(directory, 'src/vendor/webp', name),
        'upstream original license',
      );
    const installed = (extra: boolean) => ({
      MIT: [packagePath, ...(extra ? [extraPath] : [])].map((path) => ({
        paths: [path],
      })),
    });
    writeFileSync(
      join(directory, 'licenses.json'),
      JSON.stringify(installed(true)),
    );
    const fakePnpm = join(directory, 'bin/pnpm');
    writeFileSync(
      fakePnpm,
      `#!${process.execPath}\nconst fs=require('fs');console.log(process.argv[2]==='licenses'?fs.readFileSync('licenses.json','utf8'):'[]');\n`,
      { mode: 0o755 },
    );
    const invoke = (...args: string[]) =>
      spawnSync(process.execPath, [notices, ...args], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
        },
        encoding: 'utf8',
      });
    expect(invoke('--write').status).toBe(0);
    writeFileSync(
      join(directory, 'licenses.json'),
      JSON.stringify(installed(false)),
    );
    if (tamper) {
      const path = join(directory, 'THIRD_PARTY_NOTICES.txt');
      const text = readFileSync(path, 'utf8');
      writeFileSync(path, text.replace('Third-party original', 'tampered'));
    }
    const result = invoke();
    rmSync(directory, { recursive: true });
    return result.status;
  }
  it('retains an unchanged notice for a different installed platform', () =>
    expect(runScenario(true)).toBe(0));
  it('rejects a stale non-platform package notice', () =>
    expect(runScenario(false)).not.toBe(0));
  it('rejects tampering with a retained platform notice', () =>
    expect(runScenario(true, true)).not.toBe(0));
});
