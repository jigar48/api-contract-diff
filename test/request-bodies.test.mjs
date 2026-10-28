import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { compareSpecs } from '../dist/compare.js';
import { loadSpec } from '../dist/loader.js';
import { formatReport, formatJsonReport } from '../dist/report.js';

const body = required => ({ ...(required === undefined ? {} : { required }), content: { 'application/json': { schema: { type: 'object' } } } });
const operation = requestBody => ({ ...(requestBody ? { requestBody } : {}), responses: { 200: { description: 'OK' } } });
const spec = requestBody => ({ openapi: '3.0.3', info: { title: 'Synthetic order API', version: '1' }, paths: { '/orders': { post: operation(requestBody) } } });
const finding = (method = 'post', apiPath = '/orders') => ({ kind: 'request-body-newly-required', path: apiPath, method });
for (const [name, before, after, expected] of [
  ['missing to required', undefined, body(true), [finding()]],
  ['optional to required', body(false), body(true), [finding()]],
  ['omitted required to true', body(), body(true), [finding()]],
  ['required to required', body(true), body(true), []],
  ['required to optional', body(true), body(false), []],
  ['required to omitted', body(true), body(), []],
  ['required to absent', body(true), undefined, []],
  ['missing to optional', undefined, body(false), []],
]) test(`request body: ${name}`, () => assert.deepEqual(compareSpecs(spec(before), spec(after)), expected));

test('request bodies: new operations ignored and removals suppress descendants', () => {
  const before = spec(body());
  before.paths['/removed'] = { post: operation(body(true)) };
  before.paths['/orders'].delete = operation(body(true));
  const after = spec(body(true));
  after.paths['/new'] = { post: operation(body(true)) };
  after.paths['/orders'].get = operation(body(true));
  assert.deepEqual(compareSpecs(before, after), [finding(), { kind: 'operation-removed', path: '/orders', method: 'delete' }, { kind: 'path-removed', path: '/removed' }]);
});

test('request bodies: stable path/method order and query/response coexistence', async () => {
  const before = await loadSpec('test/fixtures/old.json');
  const after = await loadSpec('test/fixtures/new.json');
  const regression = compareSpecs(before, after);
  after.paths['/pets'].get.requestBody = body(true);
  after.paths['/pets'].get.parameters = [{ name: 'region', in: 'query', required: true, schema: { type: 'string' } }];
  assert.deepEqual(compareSpecs(before, after), [{ kind: 'query-parameter-newly-required', path: '/pets', method: 'get', parameter: 'region' }, finding('get', '/pets'), ...regression]);
  const old = spec();
  old.paths['/a'] = { post: operation(), get: operation() };
  const next = structuredClone(old);
  for (const item of Object.values(next.paths)) for (const op of Object.values(item)) op.requestBody = body(true);
  const expected = [finding('get', '/a'), finding('post', '/a'), finding()];
  assert.deepEqual(compareSpecs(old, next), expected);
  old.paths = Object.fromEntries(Object.entries(old.paths).reverse());
  next.paths = Object.fromEntries(Object.entries(next.paths).reverse());
  assert.deepEqual(compareSpecs(old, next), expected);
});

test('request bodies: schema and content-type changes alone are ignored', () => {
  const before = spec(body(true));
  const after = spec({ required: true, content: { 'text/plain': { schema: { type: 'string' } } } });
  assert.deepEqual(compareSpecs(before, after), []);
});

test('request body reports escape terminal controls and preserve JSON data', () => {
  const changes = [finding('post', '/orders\u001b[31m\u009b')];
  assert.doesNotMatch(formatReport(changes), /[\u001b\u009b]/);
  assert.deepEqual(JSON.parse(formatJsonReport(changes)), { schemaVersion: 1, count: 1, findings: changes });
});

for (const version of ['3.0.3', '3.1.0']) for (const extension of ['json', 'yaml']) {
  test(`request bodies ${version} ${extension}: dereferenced local chains, mixed formats and offline CLI`, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'contract-body-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const encode = value => extension === 'json' ? JSON.stringify(value) : stringify(value);
    const other = extension === 'json' ? 'yaml' : 'json';
    const before = spec({ $ref: '#/components/requestBodies/Order' });
    const after = spec({ $ref: '#/components/requestBodies/Order' });
    before.openapi = after.openapi = version;
    before.components = { requestBodies: { Order: body() } };
    after.components = { requestBodies: { Order: { $ref: `./body.${other}#/Order` } } };
    // Circular schemas are loaded but never traversed by this rule.
    const referenced = { Order: body(true), Node: { type: 'object', properties: { next: { $ref: '#/Node' } } } };
    referenced.Order.content['application/json'].schema = { $ref: '#/Node' };
    await writeFile(path.join(directory, `body.${other}`), other === 'json' ? JSON.stringify(referenced) : stringify(referenced));
    const oldFile = path.join(directory, `old.${extension}`);
    const newFile = path.join(directory, `new.${extension}`);
    await writeFile(oldFile, encode(before));
    await writeFile(newFile, encode(after));
    assert.deepEqual(compareSpecs(await loadSpec(oldFile), await loadSpec(newFile)), [finding()]);
    const run = (...args) => spawnSync(process.execPath, ['--import', './test/network-guard.mjs', 'dist/cli.js', 'compare', ...args], { encoding: 'utf8' });
    for (const format of [[], ['--format', 'json']]) {
      const result = run(oldFile, newFile, ...format);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout.trim(), format.length ? formatJsonReport([finding()]) : formatReport([finding()]));
      const unchanged = run(newFile, newFile, ...format);
      assert.equal(unchanged.status, 0, unchanged.stderr);
      assert.equal(unchanged.stdout.trim(), format.length ? formatJsonReport([]) : formatReport([]));
    }
    const mixed = path.join(directory, `mixed.${other}`);
    await writeFile(mixed, other === 'json' ? JSON.stringify(before) : stringify(before));
    assert.equal(run(mixed, newFile, '--format', 'json').stdout.trim(), formatJsonReport([finding()]));
    for (const ref of ['https://example.invalid/body.json', '//example.invalid/body.json', '../outside.json', '%2e%2e/outside.json', '#/components/requestBodies/toString', '#/bad~2pointer', '#/%ZZ']) {
      const invalid = spec({ $ref: ref });
      invalid.components = { requestBodies: {} };
      await writeFile(oldFile, encode(invalid));
      const result = run(oldFile, newFile, '--format', 'json');
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Error:/);
      assert.doesNotMatch(result.stderr, /Network access attempted/);
    }
    await writeFile(oldFile, encode(spec({ ...body(), required: 'true' })));
    assert.equal(run(oldFile, newFile).status, 2);
  });
}

test('synthetic order request body demo', async () => {
  assert.deepEqual(compareSpecs(await loadSpec('examples/order-body-before.json'), await loadSpec('examples/order-body-after.yaml')), [finding()]);
});
