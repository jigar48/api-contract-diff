import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareSpecs } from '../dist/compare.js';
import { loadSpec } from '../dist/loader.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const object = properties => ({ type: 'object', properties });
const spec = schema => ({ openapi: '3.1.0', info: { title: 'Audit', version: '1' }, paths: {
  '/items': { get: { responses: { 200: { description: 'OK', content: { 'application/json': { schema } } } } } },
} });

test('allOf wrappers preserve property type and array item comparisons', () => {
  const before = spec(object({ value: { allOf: [{ type: 'string' }] } }));
  const after = spec(object({ value: { allOf: [{ type: 'integer' }] } }));
  assert.equal(compareSpecs(before, after)[0]?.kind, 'property-type-changed');
  const array = item => spec(object({ list: { allOf: [{ type: 'array', items: object(item) }] } }));
  assert.equal(compareSpecs(array({ id: { type: 'string' } }), array({}))[0]?.property, '/list/*/id');
});
test('allOf duplicate properties preserve nested declarations independent of branch order', () => {
  const schema = parts => ({ allOf: parts.map(properties => object({ detail: object(properties) })) });
  const before = schema([{ a: { type: 'string' } }, { b: { type: 'string' } }]);
  const reordered = schema([{ b: { type: 'string' } }, { a: { type: 'string' } }]);
  assert.deepEqual(compareSpecs(spec(before), spec(reordered)), []);
  assert.equal(compareSpecs(spec(before), spec(schema([{ b: { type: 'string' } }])))[0]?.property, '/detail/a');
});
test('null response extensions are ignored', () => {
  const before = spec(object({}));
  before.paths['/items'].get.responses['x-note'] = null;
  assert.deepEqual(compareSpecs(before, spec(object({}))), []);
});
test('optional and required field removals use the same documented conservative rule', () => {
  for (const required of [[], ['id']]) {
    assert.equal(compareSpecs(spec({ ...object({ id: { type: 'string' } }), required }), spec(object({})))[0]?.kind, 'property-removed');
  }
  assert.deepEqual(compareSpecs(spec({ ...object({ id: { type: 'string' } }), required: ['id'] }), spec(object({ id: { type: 'string' } }))), []);
});
test('nullable is an OpenAPI 3.0 keyword, not a 3.1 type constraint', () => {
  const before = spec(object({ id: { type: 'string', nullable: true } }));
  const after = spec(object({ id: { type: 'string' } }));
  assert.deepEqual(compareSpecs(before, after), []);
  before.openapi = after.openapi = '3.0.3';
  assert.equal(compareSpecs(before, after)[0]?.kind, 'property-type-changed');
});
test('status removal without properties is outside milestone scope', () => {
  const before = spec(object({}));
  const after = structuredClone(before);
  after.paths['/items'].get.responses = { 204: { description: 'No content' } };
  assert.deepEqual(compareSpecs(before, after), []);
});
test('nested map values and every explicit, range, and default response are checked', () => {
  for (const status of ['200', '404', '2XX', 'default']) {
    const before = spec({ type: 'object', additionalProperties: object({ id: { type: 'string' } }) });
    before.paths['/items'].get.responses = { [status]: before.paths['/items'].get.responses[200] };
    const after = structuredClone(before);
    after.paths['/items'].get.responses[status].content['application/json'].schema.additionalProperties = object({});
    const changes = compareSpecs(before, after);
    assert.equal(changes[0]?.property, '/{key}/id');
    assert.equal(changes[0]?.response, status);
  }
});
test('network input paths are rejected before filesystem access', async () => {
  const original = fs.realpath;
  let called = false;
  fs.realpath = async () => { called = true; throw new Error('Unexpected filesystem access'); };
  syncBuiltinESMExports();
  try {
    for (const file of ['//server/share/api.json', '\\\\server\\share\\api.json', 'https://example.com/api.json', 'file:///tmp/api.json']) {
      await assert.rejects(loadSpec(file), /local filesystem path/);
    }
    assert.equal(called, false);
  } finally {
    fs.realpath = original;
    syncBuiltinESMExports();
  }
});
test('composed numeric types intersect and recursive comparisons terminate', () => {
  const numeric = spec(object({ n: { allOf: [{ type: 'number' }, { type: 'integer' }] } }));
  assert.deepEqual(compareSpecs(numeric, spec(object({ n: { type: 'integer' } }))), []);
  const oldNode = object({ id: { type: 'string' } });
  const newNode = object({ id: { type: 'integer' } });
  oldNode.properties.next = oldNode;
  newNode.properties.next = newNode;
  const changes = compareSpecs(spec({ allOf: [oldNode] }), spec({ allOf: [newNode] }));
  assert.ok(changes.some(c => c.property === '/id'));
  assert.ok(changes.length < 5);
});
test('3.1 ref siblings retain referenced and local properties; 3.0 ignores schema ref siblings', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'contract-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'api.json');
  for (const version of ['3.0.3', '3.1.0']) {
    const document = spec({ $ref: '#/components/schemas/Base', properties: { local: { type: 'string' } } });
    document.openapi = version;
    document.components = { schemas: { Base: object({ base: { type: 'string' } }) } };
    await writeFile(file, JSON.stringify(document));
    const loaded = await loadSpec(file);
    const properties = compareSpecs(loaded, spec(object({}))).filter(c => c.kind === 'property-removed').map(c => c.property).sort();
    assert.deepEqual(properties, version.startsWith('3.0') ? ['/base'] : ['/base', '/local']);
    // Exercise real CLI validation, reporting, exit code, and offline execution.
    const result = spawnSync(process.execPath, ['--import', './test/network-guard.mjs', 'dist/cli.js', 'compare', file, file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
test('referenced Path Items and Responses preserve property changes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'contract-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oldFile = path.join(directory, 'old.json');
  const newFile = path.join(directory, 'new.json');
  const before = spec({});
  before.components = { pathItems: { Items: before.paths['/items'] }, responses: { OK: { description: 'OK', content: { 'application/json': { schema: object({ id: { type: 'string' } }) } } } } };
  before.components.pathItems.Items.get.responses[200] = { $ref: '#/components/responses/OK' };
  before.paths['/items'] = { $ref: '#/components/pathItems/Items' };
  const after = structuredClone(before);
  after.components.responses.OK.content['application/json'].schema.properties = {};
  await writeFile(oldFile, JSON.stringify(before));
  await writeFile(newFile, JSON.stringify(after));
  const result = spawnSync(process.execPath, ['--import', './test/network-guard.mjs', 'dist/cli.js', 'compare', oldFile, newFile], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Removed response property: GET \/items.*\/id/);
});
