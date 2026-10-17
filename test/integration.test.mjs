import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSpec } from '../dist/loader.js';

const run = (...args) => spawnSync(process.execPath, ['--import', './test/network-guard.mjs', 'dist/cli.js', ...args], { encoding: 'utf8' });
const base = () => ({ openapi: '3.0.3', info: { title: 'Test', version: '1' }, paths: {}, components: { schemas: {} } });
test('CLI returns 1 for breaking changes and writes readable stdout', () => {
  const result = run('compare', 'test/fixtures/old.json', 'test/fixtures/new.json');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /5 breaking change/);
  assert.equal(result.stderr, '');
});
test('CLI returns 0 for identical 3.0 and recursive 3.1 inputs', () => {
  for (const name of ['old', 'reference']) {
    const file = `test/fixtures/${name}.json`;
    const result = run('compare', file, file);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No breaking changes/);
  }
});
test('CLI returns 2 for usage and missing files', () => {
  assert.equal(run().status, 2);
  assert.equal(run('compare', 'missing.json', 'missing.json').status, 2);
});

test('JSON stdout preserves all four categories, details, and deterministic ordering', async () => {
  const args = ['compare', 'test/fixtures/old.json', 'test/fixtures/new.json', '--format', 'json'];
  const result = run(...args);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, { schemaVersion: 1, count: 5, findings: [
    { kind: 'property-type-changed', path: '/pets', method: 'get', response: '200', mediaType: 'application/json', property: '/age', before: 'integer', after: 'string' },
    { kind: 'property-removed', path: '/pets', method: 'get', response: '200', mediaType: 'application/json', property: '/name' },
    { kind: 'property-removed', path: '/pets', method: 'get', response: '200', mediaType: 'application/json', property: '/tags/*/label' },
    { kind: 'operation-removed', path: '/pets', method: 'delete' },
    { kind: 'path-removed', path: '/retired' },
  ] });
  assert.equal(run(...args).stdout, result.stdout);
  const absolute = run('compare', path.resolve(args[1]), path.resolve(args[2]), '--format', 'json');
  assert.equal(absolute.stdout, result.stdout);
});

test('JSON zero findings is a versioned empty report', () => {
  const result = run('compare', 'test/fixtures/reference.json', 'test/fixtures/reference.json', '--format', 'json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { schemaVersion: 1, count: 0, findings: [] });
});

test('invalid CLI options fail clearly on stderr before loading files', () => {
  for (const args of [
    [], ['compare'], ['diff', 'old.json', 'new.json'],
    ['compare', 'old.json', 'new.json', '--format'],
    ['compare', 'old.json', 'new.json', '--format', 'xml'],
    ['compare', 'old.json', 'new.json', '--unknown', 'json'],
    ['compare', 'old.json', 'new.json', '--format=json'],
    ['compare', 'old.json', 'new.json', '--format', 'json', '--format', 'json'],
    ['compare', '--unknown', 'new.json'],
    ['compare', 'old.json', 'new.json', 'extra'],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage:.*\[--format json\]/);
  }
});

test('JSON errors retain exit 2 and empty stdout', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'contract-json-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'api.json');
  const remote = base(); remote.components.schemas.Bad = { $ref: 'https://example.invalid/schema' };
  const escape = base(); escape.components.schemas.Bad = { $ref: '../outside.json' };
  for (const content of ['{', JSON.stringify({ openapi: '3.0.3', paths: {} }), JSON.stringify(remote), JSON.stringify(escape)]) {
    await writeFile(file, content);
    const result = run('compare', file, file, '--format', 'json');
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Error:/);
    assert.doesNotMatch(result.stderr, /Network access attempted/);
  }
  for (const input of ['missing.json', 'https://example.invalid/api.json', '//server/share/api.json']) {
    const result = run('compare', input, file, '--format', 'json');
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Error:/);
  }
});
test('validation and reference safety failures produce errors', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'contract-diff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'api.json');
  const cases = [
    ['malformed JSON', '{'],
    ['missing info', JSON.stringify({ openapi: '3.0.3', paths: {} })],
    ['unsupported version', JSON.stringify({ ...base(), openapi: '2.0' })],
    ...['https://example.com/schema', '//example.com/schema', 'file:///etc/passwd', '../outside.json', '%2e%2e/outside.json', '#/missing', '#anchor'].map(ref => {
      const doc = base(); doc.components.schemas.Bad = { $ref: ref };
      return [ref, JSON.stringify(doc)];
    }),
    ['invalid schema type', JSON.stringify({ ...base(), components: { schemas: { Bad: { type: 'bogus' } } } })],
    ['invalid 3.1 schema type', JSON.stringify({ ...base(), openapi: '3.1.0', components: { schemas: { Bad: { type: 'bogus' } } } })],
    ['invalid 3.1 nested schema', JSON.stringify({ ...base(), openapi: '3.1.0', components: { schemas: { Bad: { type: 'object', properties: { value: { type: 'bogus' } } } } } })],
    ['unsupported resource scope', JSON.stringify({ ...base(), openapi: '3.1.0', components: { schemas: { Bad: { $id: 'https://example.com/schema', type: 'string' } } } })],
  ];
  for (const [name, content] of cases) {
    await t.test(name, async () => {
      await writeFile(file, content);
      const result = run('compare', file, file);
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stderr, /Error:/);
      assert.doesNotMatch(result.stderr, /Network access attempted/);
      assert.equal(result.stdout, '');
    });
  }
  await t.test('symlinks cannot escape the specification directory', async t => {
    const child = path.join(directory, 'child');
    await mkdir(child);
    const outside = path.join(directory, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'schema.json'), '{}');
    try { await symlink(outside, path.join(child, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (error.code === 'EPERM') return t.skip('Windows requires symlink privilege'); throw error; }
    const doc = base(); doc.components.schemas.Bad = { $ref: './link/schema.json' };
    const entry = path.join(child, 'api.json'); await writeFile(entry, JSON.stringify(doc));
    await assert.rejects(loadSpec(entry), /escapes/);
  });
  await t.test('encoded pointer names and external 3.1 schemas validate offline', async () => {
    const schemaFile = path.join(directory, 'schema.json');
    await writeFile(schemaFile, JSON.stringify({ 'a/b~ %': { type: 'string' } }));
    const doc = { ...base(), openapi: '3.1.0' };
    doc.components.schemas.Value = { $ref: './schema.json#/a~1b~0%20%25' };
    await writeFile(file, JSON.stringify(doc));
    const result = run('compare', file, file);
    assert.equal(result.status, 0, result.stderr);
    await writeFile(schemaFile, JSON.stringify({ 'a/b~ %': { type: 'bogus' } }));
    assert.equal(run('compare', file, file).status, 2);
  });
});
