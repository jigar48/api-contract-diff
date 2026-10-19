import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { loadSpec } from '../dist/loader.js';
import { compareSpecs } from '../dist/compare.js';

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'contract-yaml-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const base = { openapi: '3.0.3', info: { title: 'Synthetic', version: '1' }, paths: {} };
const run = (...args) => spawnSync(process.execPath, ['--import', './test/network-guard.mjs', 'dist/cli.js', ...args], { encoding: 'utf8', timeout: 10000 });

test('all format combinations retain identical findings, all four categories, ordering, and CLI output', async t => {
  const dir = await setup(t);
  for (const name of ['old', 'new']) {
    const json = await readFile(`test/fixtures/${name}.json`, 'utf8');
    await writeFile(path.join(dir, `${name}.json`), json);
    for (const ext of ['yaml', 'yml']) await writeFile(path.join(dir, `${name}.${ext}`), stringify(JSON.parse(json)));
  }
  const expected = compareSpecs(await loadSpec(path.join(dir, 'old.json')), await loadSpec(path.join(dir, 'new.json')));
  assert.deepEqual(new Set(expected.map(c => c.kind)), new Set(['path-removed', 'operation-removed', 'property-removed', 'property-type-changed']));
  const jsonReport = run('compare', path.join(dir, 'old.json'), path.join(dir, 'new.json'), '--format', 'json').stdout;
  const humanReport = run('compare', path.join(dir, 'old.json'), path.join(dir, 'new.json')).stdout;
  for (const a of ['json', 'yaml', 'yml']) for (const b of ['json', 'yaml', 'yml']) {
    const old = path.join(dir, `old.${a}`), next = path.join(dir, `new.${b}`);
    assert.deepEqual(compareSpecs(await loadSpec(old), await loadSpec(next)), expected);
    for (const format of [[], ['--format', 'json']]) {
      const result = run('compare', old, next, ...format);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, format.length ? jsonReport : humanReport);
    }
    assert.equal(run('compare', old, old).status, 0);
  }
});

test('local YAML references and mixed reference chains use the existing resolver', async t => {
  const dir = await setup(t);
  for (const formats of [['yaml', 'yml', 'yaml'], ['json', 'yaml', 'json'], ['yaml', 'json', 'yml']]) {
    const [entry, middle, leaf] = formats.map((ext, i) => path.join(dir, `${i}.${ext}`));
    const document = { ...base, components: { schemas: { Value: { $ref: `./${path.basename(middle)}#/Value` } } } };
    const data = [document, { Value: { $ref: `./${path.basename(leaf)}#/Value` } }, { Value: { type: 'object', properties: { id: { type: 'string' } } } }];
    for (const [i, file] of [entry, middle, leaf].entries()) await writeFile(file, file.endsWith('.json') ? JSON.stringify(data[i]) : stringify(data[i]));
    const loaded = await loadSpec(entry);
    assert.equal(loaded.components.schemas.Value.properties.id.type, 'string');
    assert.equal(run('compare', entry, entry).status, 0);
  }
});

test('strict YAML rejects invalid and unsafe inputs with bounded diagnostics', async t => {
  const dir = await setup(t), file = path.join(dir, 'api.yaml');
  const prefix = stringify(base);
  const cases = [
    ['syntax', 'paths: ['], ['duplicate', prefix + 'paths: {}\n'],
    ['documents', prefix + '---\n' + prefix], ['custom tag', prefix + 'x-value: !custom value\n'],
    ['known non-core tag', prefix + 'x-value: !!timestamp 2020-01-01\n'],
    ['alias', prefix + 'x-value: *missing\n'], ['anchor and alias', prefix + 'x-one: &a {}\nx-two: *a\n'],
    ['non-string key', prefix + 'x-map: {200: value}\n'], ['complex key', prefix + 'x-map: {? [a, b]: value}\n'],
    ['merge', prefix + 'x-map: {<<: {a: b}}\n'], ['non-finite', prefix + 'x-value: .nan\n'],
    ['unsafe integer', prefix + 'x-value: 9007199254740993\n'],
    ['old YAML', '%YAML 1.1\n---\n' + prefix],
    ['oversized', '#'.repeat(2 * 1024 * 1024 + 1)],
    ['deep flow', 'x: ' + '['.repeat(10000) + '0' + ']'.repeat(10000)],
    ['deep block', Array.from({ length: 100 }, (_, i) => '  '.repeat(i) + 'x:').join('\n')],
    ['UTF-8', Buffer.from([0xff])],
  ];
  for (const [name, text] of cases) await t.test(name, async () => {
    await writeFile(file, text);
    const result = run('compare', file, file, '--format', 'json');
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Error:/);
    assert.ok(result.stderr.length < 250, result.stderr);
    assert.doesNotMatch(result.stderr, /RangeError|at .*loader|Network access attempted/);
  });
});

test('YAML 1.2 scalars and prototype-like keys remain plain own data', async t => {
  const dir = await setup(t), file = path.join(dir, 'api.yaml');
  await writeFile(file, stringify(base) + 'x-values: {yes: no, date: 2020-01-01, __proto__: {polluted: true}, constructor: text}\n');
  const loaded = await loadSpec(file);
  assert.equal(loaded['x-values'].yes, 'no');
  assert.equal(loaded['x-values'].date, '2020-01-01');
  assert.ok(Object.hasOwn(loaded['x-values'], '__proto__'));
  assert.equal({}.polluted, undefined);
});

test('YAML reference security covers traversal, schemes, and symlink escapes', async t => {
  const dir = await setup(t), child = path.join(dir, 'child');
  await mkdir(child);
  const file = path.join(child, 'api.yml');
  for (const ref of ['../outside.yaml', '%2e%2e/outside.yaml', 'https://example.invalid/a.yml', 'http://example.invalid/a.yml', 'file:///outside.yml', 'ftp://example.invalid/a', '//server/a', 'a\\b.yml']) {
    await writeFile(file, stringify({ ...base, components: { schemas: { Bad: { $ref: ref } } } }));
    const result = run('compare', file, file);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Only relative local references|escapes/);
    assert.doesNotMatch(result.stderr, /Network access attempted/);
  }
  await mkdir(path.join(dir, 'outside'));
  await writeFile(path.join(dir, 'outside', 'schema.yaml'), 'type: string\n');
  try { await symlink(path.join(dir, 'outside'), path.join(child, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable'); throw error; }
  await writeFile(file, stringify({ ...base, components: { schemas: { Bad: { $ref: './link/schema.yaml' } } } }));
  await assert.rejects(loadSpec(file), /escapes/);
});

test('referenced YAML receives the same strict parsing and resource limits', async t => {
  const dir = await setup(t), entry = path.join(dir, 'api.json'), target = path.join(dir, 'schema.yaml');
  await writeFile(entry, JSON.stringify({ ...base, components: { schemas: { Value: { $ref: './schema.yaml' } } } }));
  for (const [source, pattern] of [
    ['type: string\ntype: integer\n', /Invalid YAML/],
    ['#'.repeat(2 * 1024 * 1024 + 1), /2 MiB/],
    ['['.repeat(1000) + '0' + ']'.repeat(1000), /depth/],
    ['type: string\n---\ntype: integer\n', /Multiple YAML/],
  ]) {
    await writeFile(target, source);
    await assert.rejects(loadSpec(entry), pattern);
  }
});

test('YAML resource-limit boundaries accept exactly 2 MiB and depth 64', async t => {
  const dir = await setup(t), file = path.join(dir, 'api.yaml');
  const prefix = stringify(base);
  await writeFile(file, prefix + '#' + 'x'.repeat(2 * 1024 * 1024 - Buffer.byteLength(prefix) - 1));
  await loadSpec(file);
  await writeFile(file, prefix + 'x-value: ' + '['.repeat(63) + '0' + ']'.repeat(63));
  await loadSpec(file);
  await writeFile(file, prefix + 'x-value: ' + '['.repeat(64) + '0' + ']'.repeat(64));
  await assert.rejects(loadSpec(file), /depth/);
});

test('collection width boundaries apply to block/flow mappings and sequences', async t => {
  const dir = await setup(t), file = path.join(dir, 'api.yaml');
  for (const kind of ['block map', 'flow map', 'block seq', 'flow seq']) {
    for (const count of [1023, 1024, 1025]) {
      const entries = Array.from({ length: count }, (_, i) => `k${i}: 0`);
      const value = kind === 'block map' ? '\n' + entries.map(s => '  ' + s).join('\n')
        : kind === 'flow map' ? '{' + entries.join(', ') + '}'
        : kind === 'block seq' ? '\n' + entries.map(() => '  - 0').join('\n')
        : '[' + entries.map(() => '0').join(', ') + ']';
      await writeFile(file, stringify(base) + 'x-values: ' + value + '\n');
      if (count <= 1024) await loadSpec(file);
      else await assert.rejects(loadSpec(file), /collection limit of 1024 items/, kind);
    }
  }
});

test('total collection-item budget accepts 9999/10000 and rejects 10001 across small collections', async t => {
  const dir = await setup(t), file = path.join(dir, 'api.yaml');
  for (const budget of [9999, 10000, 10001]) {
    // Root: 4 pairs; info: 2 pairs; outer sequence: 10 items.
    let remaining = budget - 16;
    const groups = Array.from({ length: 10 }, () => {
      const count = Math.min(1000, remaining); remaining -= count;
      return Array(count).fill(0);
    });
    await writeFile(file, stringify({ ...base, 'x-values': groups }));
    if (budget <= 10000) await loadSpec(file);
    else await assert.rejects(loadSpec(file), /total collection limit of 10000 items/);
  }
});

test('wide sub-2-MiB mapping is rejected before Composer, including referenced YAML', async t => {
  const { Composer } = await import('yaml');
  const dir = await setup(t), file = path.join(dir, 'wide.yaml'), entry = path.join(dir, 'api.json');
  const source = stringify(base) + 'x-values:\n' + Array.from({ length: 40000 }, (_, i) => `  k${i}: 0\n`).join('');
  assert.ok(Buffer.byteLength(source) < 2 * 1024 * 1024);
  await writeFile(file, source);
  await writeFile(entry, JSON.stringify({ ...base, components: { schemas: { Value: { $ref: './wide.yaml' } } } }));
  const compose = t.mock.method(Composer.prototype, 'next', function* () { throw new Error('Composer must not run'); });
  for (const input of [file, entry]) await assert.rejects(loadSpec(input), /collection limit of 1024 items/);
  assert.equal(compose.mock.callCount(), 0);
});

test('duplicate keys still fail at the allowed collection-width boundary', async t => {
  const dir = await setup(t), file = path.join(dir, 'api.yaml');
  const entries = Array.from({ length: 1023 }, (_, i) => `  k${i}: 0\n`).join('');
  await writeFile(file, stringify(base) + 'x-values:\n' + entries + '  k0: 1\n');
  await assert.rejects(loadSpec(file), /Invalid YAML \(DUPLICATE_KEY\)/);
});

test('uppercase extensions and allowed symlinks use the canonical filename format', async t => {
  const dir = await setup(t);
  for (const ext of ['YAML', 'YML']) {
    const file = path.join(dir, `api.${ext}`);
    await writeFile(file, stringify(base));
    assert.deepEqual(compareSpecs(await loadSpec(file), await loadSpec(file)), []);
  }
  const yaml = path.join(dir, 'api.YAML'), json = path.join(dir, 'api.json');
  await writeFile(json, JSON.stringify(base));
  try {
    await symlink(yaml, path.join(dir, 'yaml-target.json'), 'file');
    await symlink(json, path.join(dir, 'json-target.yaml'), 'file');
  } catch (error) { if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable'); throw error; }
  for (const file of ['yaml-target.json', 'json-target.yaml']) await loadSpec(path.join(dir, file));
  // The same canonical selection is used for references.
  await writeFile(path.join(dir, 'schema.YML'), 'type: string\n');
  await symlink(path.join(dir, 'schema.YML'), path.join(dir, 'schema-link.json'), 'file');
  await writeFile(json, JSON.stringify({ ...base, components: { schemas: { Value: { $ref: './schema-link.json' } } } }));
  assert.equal((await loadSpec(json)).components.schemas.Value.type, 'string');
});

test('OpenAPI 3.1 recursive local references retain JSON/YAML comparison parity', async t => {
  const dir = await setup(t), fixture = JSON.parse(await readFile('test/fixtures/reference.json', 'utf8'));
  const node = JSON.parse(await readFile('test/fixtures/schemas/node.json', 'utf8'));
  const baseline = await loadSpec('test/fixtures/reference.json');
  const target = { ...base, openapi: '3.1.0', paths: { '/nodes': { get: { responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: {} } } } } } } } } };
  const expected = compareSpecs(baseline, target);
  for (const [entryExt, schemaExt] of [['yaml', 'yml'], ['json', 'YAML'], ['YML', 'json']]) {
    const document = structuredClone(fixture);
    document.paths['/nodes'].get.responses['200'].content['application/json'].schema.$ref = `./node.${schemaExt}`;
    await writeFile(path.join(dir, `node.${schemaExt}`), schemaExt === 'json' ? JSON.stringify(node) : stringify(node));
    const file = path.join(dir, `api.${entryExt}`);
    await writeFile(file, entryExt === 'json' ? JSON.stringify(document) : stringify(document));
    const loaded = await loadSpec(file);
    assert.deepEqual(compareSpecs(baseline, loaded), []);
    assert.deepEqual(compareSpecs(loaded, baseline), []);
    assert.deepEqual(compareSpecs(loaded, target), expected);
    assert.equal(run('compare', file, file, '--format', 'json').status, 0);
  }
});

test('canonical filename format selection is platform independent', async t => {
  const fs = await import('node:fs/promises');
  const { syncBuiltinESMExports } = await import('node:module');
  const dir = await setup(t), yaml = path.join(dir, 'api.YAML'), json = path.join(dir, 'api.json');
  await writeFile(yaml, stringify(base));
  await writeFile(json, JSON.stringify(base));
  const aliases = new Map([[path.join(dir, 'yaml-link.json'), yaml], [path.join(dir, 'json-link.yaml'), json]]);
  const original = fs.default.realpath;
  t.mock.method(fs.default, 'realpath', async file => original(aliases.get(file) ?? file));
  syncBuiltinESMExports();
  try {
    for (const input of aliases.keys()) await loadSpec(input);
    // An ordinary JSON file exceeding YAML's width limit still follows JSON.parse.
    await writeFile(json, JSON.stringify({ ...base, 'x-wide': Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`k${i}`, 0])) }));
    await loadSpec(path.join(dir, 'json-link.yaml'));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('total item budget rejects before AST composition in local references', async t => {
  const { Composer } = await import('yaml');
  const dir = await setup(t), target = path.join(dir, 'many.yml'), entry = path.join(dir, 'api.json');
  await writeFile(target, stringify({ ...base, 'x-values': Array.from({ length: 11 }, () => Array(1000).fill(0)) }));
  await writeFile(entry, JSON.stringify({ ...base, components: { schemas: { Value: { $ref: './many.yml' } } } }));
  const compose = t.mock.method(Composer.prototype, 'next', function* () { throw new Error('Composer must not run'); });
  await assert.rejects(loadSpec(entry), /total collection limit of 10000 items/);
  assert.equal(compose.mock.callCount(), 0);
});

test('allowed directory symlinks preserve canonical YAML loading and relative references', async t => {
  const dir = await setup(t), actual = path.join(dir, 'actual'), alias = path.join(dir, 'alias');
  await mkdir(actual);
  const document = { ...base, components: { schemas: { Value: { $ref: './schema.YML' } } } };
  await writeFile(path.join(actual, 'api.YAML'), stringify(document));
  await writeFile(path.join(actual, 'schema.YML'), 'type: string\n');
  try { await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable'); throw error; }
  const loaded = await loadSpec(path.join(alias, 'api.YAML'));
  assert.equal(loaded.components.schemas.Value.type, 'string');
});
