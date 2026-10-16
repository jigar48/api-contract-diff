import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { npm, scanFile, success } from './release-utils.mjs';

const root = process.cwd();
// The clean consumer deliberately has a space in its path to exercise bin quoting.
const temporary = await mkdtemp(path.join(tmpdir(), 'api-contract-diff package-'));
try {
  const pack = JSON.parse(success(npm(['pack', '--json', '--silent', '--pack-destination', temporary]), 'npm pack'))[0];
  const expected = ['package.json', 'README.md', 'LICENSE', 'SECURITY.md',
    ...['cli', 'compare', 'loader', 'report'].flatMap(name => [`dist/${name}.js`, `dist/${name}.d.ts`])].sort();
  assert.deepEqual(pack.files.map(file => file.path).sort(), expected, 'Unexpected files in npm package');
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pack.version, manifest.version);
  const consumer = path.join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'clean-package-check', private: true, version: '1.0.0' }));
  success(npm(['install', path.join(temporary, pack.filename), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: consumer }), 'Clean production install');
  const installed = path.join(consumer, 'node_modules', manifest.name);
  const installedManifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(installedManifest.version, manifest.version);
  assert.deepEqual(installedManifest.bin, manifest.bin);
  async function inventory(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) files.push(...await inventory(path.join(directory, entry.name), `${relative}/`));
      else files.push(relative);
    }
    return files;
  }
  assert.deepEqual((await inventory(installed)).sort(), expected);
  for (const file of expected) await scanFile(path.join(installed, file), file);
  assert.ok((await readFile(path.join(installed, manifest.bin[manifest.name]), 'utf8')).startsWith('#!/usr/bin/env node\n'));
  await access(path.join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'api-contract-diff.cmd' : 'api-contract-diff'));
  await assert.rejects(access(path.join(consumer, 'node_modules', 'typescript')));
  for (const name of ['old', 'new']) await writeFile(path.join(consumer, `${name}.json`), await readFile(path.join(root, 'test', 'fixtures', `${name}.json`)));
  await writeFile(path.join(consumer, 'invalid.json'), '{');
  const remote = JSON.parse(await readFile(path.join(consumer, 'old.json'), 'utf8'));
  remote.components = { schemas: { Remote: { $ref: 'https://example.invalid/schema.json' } } };
  await writeFile(path.join(consumer, 'remote.json'), JSON.stringify(remote));
  const guard = path.join(consumer, 'network-guard.mjs');
  await writeFile(guard, await readFile(path.join(root, 'test', 'network-guard.mjs')));
  const cases = [
    ['unchanged', 0, ['compare', 'old.json', 'old.json'], /No breaking changes/],
    ['breaking', 1, ['compare', 'old.json', 'new.json'], /5 breaking change/],
    ['invalid JSON', 2, ['compare', 'invalid.json', 'new.json'], /Error:/],
    ['remote reference', 2, ['compare', 'remote.json', 'new.json'], /Only relative local references/],
    ['usage', 2, [], /Usage:/],
  ];
  for (const [name, status, args, pattern] of cases) {
    const result = npm(['exec', '--offline', '--yes=false', '--', manifest.name, ...args], {
      cwd: consumer,
      env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`, npm_config_audit: 'false', npm_config_fund: 'false' },
    });
    assert.equal(result.status, status, `${name}: ${result.stderr}`);
    assert.match(status === 2 ? result.stderr : result.stdout, pattern, name);
    assert.equal(status === 2 ? result.stdout : result.stderr, '', `${name}: unexpected output stream`);
    assert.doesNotMatch(result.stderr, /Network access attempted/);
    console.log(`Installed CLI ${name}: exit ${status} PASS`);
  }
  console.log(`Package ${manifest.version}: ${expected.length} allowlisted files; clean production install, bin shim, credential/path scan, and 5 offline CLI smoke checks PASS.`);
} finally {
  // Only the exact directory returned by mkdtemp is removed; never the workspace.
  await rm(temporary, { recursive: true, force: true });
}
