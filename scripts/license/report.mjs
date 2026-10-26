import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { json } from './inventory.mjs';

const directory = '.cache/license/reports';
const coverage = json(`${directory}/coverage.json`);
const scan = json(`${directory}/scancode.json`);
const bom = json(`${directory}/sbom.spdx.json`);
assert.equal(
  scan.headers?.[0]?.tool_version,
  '32.4.1',
  'Unexpected ScanCode version',
);
assert.ok(scan.files?.length > 0, 'Empty ScanCode report');
assert.equal(
  bom.packages.length,
  coverage.sbomPackages,
  'SBOM coverage count mismatch',
);
assert.equal(
  bom.packages.length,
  coverage.installedPackages + 1,
  'Missing dependency/vendor coverage',
);
assert.equal(
  new Set(bom.packages.map((pkg) => `${pkg.name}@${pkg.versionInfo}`)).size,
  bom.packages.length,
  'Duplicate SBOM packages',
);
for (const key of [
  ...coverage.installed,
  ...coverage.browser,
  ...coverage.worker,
]) {
  assert.ok(
    bom.packages.some((pkg) => `${pkg.name}@${pkg.versionInfo}` === key),
    `SBOM missing runtime package ${key}`,
  );
}
const files = scan.files.filter((file) => file.type === 'file');
const normalized = (path) => path.replace(/^.*?input\//, '');
const scanned = new Set(files.map((file) => normalized(file.path)));
const missing = coverage.files.filter((file) => !scanned.has(file.path));
const unexpected = [...scanned].filter(
  (path) => !coverage.files.some((file) => file.path === path),
);
const checksumErrors = files
  .filter((file) => {
    const expected = coverage.files.find(
      (entry) => entry.path === normalized(file.path),
    );
    return expected && file.sha256 !== expected.sha256;
  })
  .map((file) => `Checksum mismatch: ${normalized(file.path)}`);
const errors = [
  ...checksumErrors,
  ...(scan.headers || []).flatMap((header) => header.errors || []),
  ...files.flatMap((file) =>
    (file.scan_errors || []).map(
      (error) => `${normalized(file.path)}: ${error}`,
    ),
  ),
];
const findings = files
  .filter(
    (file) =>
      file.detected_license_expression || file.license_detections?.length,
  )
  .map((file) => ({
    path: normalized(file.path),
    expression: file.detected_license_expression || 'unknown',
    status: 'pending-human-review',
  }))
  .sort((a, b) => a.path.localeCompare(b.path, 'en'));
const baselinePath = 'docs/license/scan-baseline.json';
const baseline = existsSync(baselinePath)
  ? json(baselinePath)
  : { findings: [] };
const newFindings = findings.filter(
  (finding) =>
    !baseline.findings.some(
      (old) =>
        old.path === finding.path && old.expression === finding.expression,
    ),
);
const result = {
  scanner: 'ScanCode Toolkit 32.4.1',
  scannedFiles: files.length,
  expectedFiles: coverage.files.length,
  missing,
  unexpected,
  errors,
  findings,
  newFindings,
  disclaimer:
    'Detection report only; all findings require human review. Baseline records observations, not approval. Scanning is not a legal guarantee.',
};
writeFileSync(
  `${directory}/review.json`,
  JSON.stringify(result, null, 2) + '\n',
);
writeFileSync(
  `${directory}/summary.md`,
  `# License review report\n\n${result.disclaimer}\n\n- Files: ${files.length}/${coverage.files.length}\n- Installed npm package versions: ${coverage.installedPackages}; SPDX packages including vendor: ${coverage.sbomPackages}\n- Browser package versions observed: ${coverage.browser.length}; Worker: ${coverage.worker.length}\n- Uninstalled optional platform packages: ${coverage.omittedOptionalPlatforms.length} (not claimed as scanned)\n- Packages without standalone license/notice files: ${coverage.missingLicenseTexts.length} (review coverage.json; metadata alone is insufficient for redistribution)\n- License-bearing files: ${findings.length}; new observations: ${newFindings.length}\n- Missing/unexpected files: ${missing.length}/${unexpected.length}; scan errors: ${errors.length}\n\nSee coverage.json for exact file hashes, excluded paths, bundle attribution and limitations; review.json and scancode.json for findings.\n`,
);
if (process.argv.includes('--record-baseline')) {
  assert.equal(
    errors.length + missing.length + unexpected.length,
    0,
    'Cannot baseline an incomplete scan',
  );
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        scanner: result.scanner,
        status: 'pending-human-review',
        disclaimer: result.disclaimer,
        findings,
      },
      null,
      2,
    ) + '\n',
  );
}
assert.deepEqual(missing, [], 'Scan missed selected files');
assert.deepEqual(unexpected, [], 'Scan included unexpected files');
assert.deepEqual(errors, [], 'ScanCode execution/file errors require repair');
console.log(
  `Scan verified: ${files.length} files, ${findings.length} findings (${newFindings.length} new); human review pending.`,
);
