import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const hash = (data) => createHash('sha256').update(data).digest('hex');
export const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const omittedOptional = new Set();
export function inventory() {
  const groups = JSON.parse(
    execFileSync('pnpm', ['licenses', 'list', '--json'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const records = new Map();
  for (const [license, packages] of Object.entries(groups)) {
    for (const pkg of packages)
      for (const path of pkg.paths) {
        const manifest = json(join(path, 'package.json'));
        const key = `${manifest.name}@${manifest.version}`;
        const texts = [];
        const collect = (directory, prefix = '') => {
          for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            const relative = prefix + entry.name;
            if (
              entry.isDirectory() &&
              !['node_modules', '.git', '.cache'].includes(entry.name)
            )
              collect(join(directory, entry.name), relative + '/');
            else if (
              entry.isFile() &&
              /^(licen[cs]e|copying|notice)(?:[.-]|$)/i.test(entry.name)
            )
              texts.push({
                name: relative,
                text: readFileSync(join(directory, entry.name), 'utf8'),
              });
          }
        };
        collect(path);
        texts.sort((a, b) => a.name.localeCompare(b.name, 'en'));
        const record = {
          key,
          name: manifest.name,
          version: manifest.version,
          license,
          platform: Boolean(manifest.os?.length || manifest.cpu?.length),
          texts,
        };
        if (records.has(key))
          assert.deepEqual(
            records.get(key),
            record,
            `Conflicting metadata: ${key}`,
          );
        records.set(key, record);
      }
  }
  assert.ok(records.size > 0, 'Empty pnpm license inventory');
  const root = json('package.json');
  for (const name of Object.keys({
    ...root.dependencies,
    ...root.devDependencies,
  })) {
    const manifest = json(join('node_modules', name, 'package.json'));
    assert.ok(
      records.has(`${name}@${manifest.version}`),
      `Missing direct dependency: ${name}`,
    );
  }
  // Independent recursive pnpm tree prevents a partial/empty license result passing.
  const trees = JSON.parse(
    execFileSync('pnpm', ['list', '--depth', 'Infinity', '--json'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  const visit = (node) => {
    const optional =
      node.path && existsSync(join(node.path, 'package.json'))
        ? json(join(node.path, 'package.json')).optionalDependencies || {}
        : {};
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ]) {
      for (const [name, dep] of Object.entries(node[field] || {})) {
        if (dep.path && !existsSync(join(dep.path, 'package.json'))) {
          assert.ok(
            field === 'optionalDependencies' || name in optional,
            `Missing non-optional installation: ${name}`,
          );
          omittedOptional.add(`${name}@${dep.version}`);
          continue;
        }
        assert.ok(
          records.has(`${dep.name || name}@${dep.version}`),
          `License inventory missing ${name}@${dep.version}`,
        );
        visit(dep);
      }
    }
  };
  trees.forEach(visit);
  return [...records.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'));
}
export const section = (record) =>
  `\n${'='.repeat(72)}\n${record.key}\nLicense: ${record.license}\n${record.texts.map(({ name, text }) => `\n--- ${name} ---\n${text}\n`).join('')}`;
export const vendor = () => ({
  key: 'vendor/webp (Playwright 1.64.1)',
  license: 'NOASSERTION; see preserved Apache/libwebp/Emscripten texts',
  texts: ['LICENSE.playwright', 'LICENSE.libwebp-emscripten'].map((name) => ({
    name,
    text: readFileSync(join('src/vendor/webp', name), 'utf8'),
  })),
});
