import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { loadSpec } from '../dist/loader.js';

const maxBytes = 2 * 1024 * 1024;
const base = { openapi: '3.0.3', info: { title: 'Synthetic', version: '1' }, paths: {} };

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'contract-json-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function run(old, next, ...format) {
  return spawnSync(process.execPath, ['--import', './test/network-guard.mjs', 'dist/cli.js', 'compare', old, next, ...format],
    { encoding: 'utf8', timeout: 10000 });
}

test('JSON accepts exactly 2 MiB of UTF-8 and rejects one byte over before parsing', async t => {
  const file = path.join(await setup(t), 'api.json');
  const source = JSON.stringify({ ...base, 'x-value': 'é' });
  const exact = source.padEnd(maxBytes - 1); // é uses two UTF-8 bytes.
  assert.equal(Buffer.byteLength(exact), maxBytes);
  await writeFile(file, exact);
  assert.equal((await loadSpec(file))['x-value'], 'é');

  await writeFile(file, exact + '!'); // Also invalid JSON if passed to the parser.
  await assert.rejects(loadSpec(file), { message: 'JSON exceeds the 2 MiB input limit' });
});

test('JSON depth counts only open containers outside strings, including the root', async t => {
  const file = path.join(await setup(t), 'api.json');
  const key = 'x-' + '{['.repeat(65) + '\\"';
  const value = '\\"' + '{['.repeat(65) + ']}'.repeat(65) + '\\\\';
  let nested = null;
  for (let i = 0; i < 63; i++) nested = i % 2 === 0 ? [nested] : { value: nested };
  const document = { ...base, [key]: value, 'x-nested': nested };
  await writeFile(file, JSON.stringify(document));
  const loaded = await loadSpec(file);
  assert.equal(loaded[key], value);
  assert.deepEqual(loaded['x-nested'], nested);

  document['x-nested'] = [nested];
  await writeFile(file, JSON.stringify(document));
  await assert.rejects(loadSpec(file), { message: 'JSON exceeds the maximum structural depth of 64' });
});

test('JSON CLI errors are concise in both output modes and never echo malformed source', async t => {
  const dir = await setup(t);
  const valid = path.join(dir, 'valid.json'), bad = path.join(dir, 'bad.json');
  await writeFile(valid, JSON.stringify(base));
  const cases = [
    ['malformed', '{"value":SYNTHETIC_SECRET}', 'Invalid JSON'],
    ['truncated', '{"value":"SYNTHETIC_SECRET', 'Invalid JSON'],
    ['mismatched delimiters', '{"value":[}', 'Invalid JSON'],
    ['BOM', '\ufeff' + JSON.stringify(base), 'Invalid JSON'],
    ['invalid UTF-8 inside a string', Buffer.concat([Buffer.from('{"value":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]), 'JSON must be valid UTF-8'],
  ];
  for (const [name, source, message] of cases) {
    await writeFile(bad, source);
    for (const format of [[], ['--format', 'json']]) {
      const result = run(valid, bad, ...format);
      assert.equal(result.status, 2, `${name}: ${result.stderr}`);
      assert.equal(result.stdout, '', name);
      assert.equal(result.stderr, `Error: ${message}\n`, name);
    }
  }
});

test('JSON referenced through YAML receives the same byte, UTF-8 and depth limits', async t => {
  const dir = await setup(t);
  const entry = path.join(dir, 'api.yaml'), target = path.join(dir, 'schema.json');
  await writeFile(entry, stringify({ ...base, components: { schemas: { Value: { $ref: './schema.json' } } } }));
  const schema = JSON.stringify({ type: 'string' });
  await writeFile(target, schema.padEnd(maxBytes));
  assert.equal((await loadSpec(entry)).components.schemas.Value.type, 'string');

  for (const [source, message] of [
    [schema.padEnd(maxBytes + 1), 'JSON exceeds the 2 MiB input limit'],
    ['['.repeat(65) + '0' + ']'.repeat(65), 'JSON exceeds the maximum structural depth of 64'],
    [Buffer.from([0xff]), 'JSON must be valid UTF-8'],
  ]) {
    await writeFile(target, source);
    const result = run(entry, entry, '--format', 'json');
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `Error: ${message}\n`);
  }
});
