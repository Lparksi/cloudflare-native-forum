import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const licenses = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }),
);
let output =
  'THIRD-PARTY NOTICES\nGenerated from installed dependencies, including development tools.\nProject code: MIT. Dependency licenses remain their own.\nSee docs/licenses.md for build-only native dependencies.\n\n';
const seen = new Set();
for (const packages of Object.values(licenses)) {
  for (const pkg of packages) {
    for (const path of pkg.paths) {
      const manifest = JSON.parse(
        readFileSync(join(path, 'package.json'), 'utf8'),
      );
      const key = `${manifest.name}@${manifest.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output += `\n${'='.repeat(72)}\n${key}\nLicense: ${pkg.license}\n${pkg.homepage || ''}\n`;
      for (const file of readdirSync(path, { withFileTypes: true }).filter(
        (entry) =>
          entry.isFile() &&
          /^(licen[cs]e|copying|notice)(?:[.-]|$)/i.test(entry.name),
      )) {
        output += `\n--- ${file.name} ---\n${readFileSync(join(path, file.name), 'utf8')}\n`;
      }
    }
  }
}
writeFileSync('THIRD_PARTY_NOTICES.txt', output);
console.log(`Preserved notices for ${seen.size} installed package versions.`);
