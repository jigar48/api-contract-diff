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

const parameter = (name = 'region', required = true, location = 'query') => ({ name, in: location, required, schema: { type: 'string' } });
const operation = parameters => ({ parameters, responses: { 200: { description: 'OK' } } });
const spec = (parameters = [], inherited = []) => ({ openapi: '3.0.3', info: { title: 'Synthetic query example', version: '1' }, paths: { '/orders': { parameters: inherited, get: operation(parameters) } } });
const finding = (name = 'region', method = 'get', apiPath = '/orders') => ({ kind: 'query-parameter-newly-required', path: apiPath, method, parameter: name });

for (const [name, before, after, expected] of [
  ['new required query', spec(), spec([parameter()]), [finding()]],
  ['optional becomes required', spec([parameter('region', false)]), spec([parameter()]), [finding()]],
  ['omitted required becomes true', spec([{ name: 'region', in: 'query', schema: { type: 'string' } }]), spec([parameter()]), [finding()]],
  ['new optional query', spec(), spec([parameter('region', false)]), []],
  ['unchanged required query', spec([parameter()]), spec([parameter()]), []],
  ['required becomes optional', spec([parameter()]), spec([parameter('region', false)]), []],
  ['removed query', spec([parameter()]), spec(), []],
  ['path declaration', spec(), spec([], [parameter()]), [finding()]],
  ['optional operation overrides required path', spec(), spec([parameter('region', false)], [parameter()]), []],
  ['required operation overrides optional path', spec([], [parameter('region', false)]), spec([parameter()], [parameter('region', false)]), [finding()]],
  ['old optional override matters', spec([parameter('region', false)], [parameter()]), spec([], [parameter()]), [finding()]],
  ['old required override matters', spec([parameter()], [parameter('region', false)]), spec([], [parameter()]), []],
  ['same name in header does not override query', spec(), spec([parameter('region', false, 'header')], [parameter()]), [finding()]],
  ['header only ignored', spec(), spec([parameter('region', true, 'header')]), []],
  ['matching inherited and operation identity reported once', spec(), spec([parameter()], [parameter()]), [finding()]],
  ['case sensitive identities', spec([parameter('Region')]), spec([parameter('region')]), [finding()]],
]) test(name, () => assert.deepEqual(compareSpecs(before, after), expected));

test('existing operations only and parent removals suppress descendants', () => {
  const before = spec();
  before.paths['/removed'] = { get: operation([]) };
  before.paths['/orders'].delete = operation([]);
  const after = spec([parameter()]);
  after.paths['/orders'].post = operation([parameter()]);
  after.paths['/new'] = { get: operation([parameter()]) };
  assert.deepEqual(compareSpecs(before, after), [finding(), { kind: 'operation-removed', path: '/orders', method: 'delete' }, { kind: 'path-removed', path: '/removed' }]);
});

test('multiple parameters, paths and operations have deterministic order', () => {
  const before = spec();
  before.paths['/a'] = { post: operation([]), get: operation([]) };
  const after = structuredClone(before);
  for (const item of Object.values(after.paths)) for (const method of ['post', 'get']) {
    if (item[method]) item[method].parameters = [parameter('z'), parameter('a')];
  }
  const expected = [finding('a', 'get', '/a'), finding('z', 'get', '/a'), finding('a', 'post', '/a'), finding('z', 'post', '/a'), finding('a'), finding('z')];
  assert.deepEqual(compareSpecs(before, after), expected);
  after.paths = Object.fromEntries(Object.entries(after.paths).reverse());
  for (const item of Object.values(after.paths)) for (const method of ['post', 'get']) item[method]?.parameters.reverse();
  assert.deepEqual(compareSpecs(before, after), expected);
});

test('untrusted parameter names remain data and terminal controls are escaped', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'quote"\\\n\u001b[31m\u009b']) {
    const changes = compareSpecs(spec(), spec([parameter(name)]));
    assert.deepEqual(changes, [finding(name)]);
    const human = formatReport(changes);
    assert.match(human, /Newly required query parameter: GET \/orders parameter/);
    assert.doesNotMatch(human, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    assert.deepEqual(JSON.parse(formatJsonReport(changes)), { schemaVersion: 1, count: 1, findings: [finding(name)] });
  }
  assert.equal({}.polluted, undefined);
});

test('query findings precede existing response rules without suppressing them', async () => {
  const before = await loadSpec('test/fixtures/old.json');
  const after = await loadSpec('test/fixtures/new.json');
  const regression = compareSpecs(before, after);
  after.paths['/pets'].get.parameters = [parameter()];
  assert.deepEqual(compareSpecs(before, after), [finding('region', 'get', '/pets'), ...regression]);
});

test('documented synthetic example detects exactly the documented finding', async () => {
  assert.deepEqual(compareSpecs(await loadSpec('examples/query-before.yaml'), await loadSpec('examples/query-after.yaml')), [finding()]);
});

test('parameter references cannot enable remote fetching or directory traversal', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'contract-query-security-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'api.json');
  for (const ref of ['https://example.invalid/parameter.json', '//example.invalid/parameter.json', '../outside.json', '%2e%2e/outside.json', '#/components/parameters/toString']) {
    const document = spec([{ $ref: ref }]);
    document.components = { parameters: {} };
    await writeFile(file, JSON.stringify(document));
    const result = spawnSync(process.execPath, ['--import', './test/network-guard.mjs', 'dist/cli.js', 'compare', file, file, '--format', 'json'], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /Network access attempted/);
    assert.match(result.stderr, /Only relative local references|escapes specification directory|Unresolved reference/);
  }
});

for (const version of ['3.0.3', '3.1.0']) for (const extension of ['json', 'yaml']) {
  test(`${version} ${extension}: local parameter refs, CLI reports and exit codes offline`, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'contract-query-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const encode = value => extension === 'json' ? JSON.stringify(value) : stringify(value);
    const before = spec([], [parameter('region', false)]);
    const after = spec([{ $ref: '#/components/parameters/Region' }], [{ $ref: `./parameters.${extension}#/Shared` }]);
    before.openapi = after.openapi = version;
    const hostile = 'region"\n\u001b[31m\u009b';
    after.components = { parameters: { Region: parameter(), Hostile: parameter(hostile) } };
    // Parameter comparison must not descend into recursive schemas.
    after.components.schemas = { Recursive: { type: 'object', properties: { next: { $ref: '#/components/schemas/Recursive' } } } };
    after.components.parameters.Region.schema = { $ref: '#/components/schemas/Recursive' };
    after.paths['/orders'].get.parameters.push({ $ref: '#/components/parameters/Hostile' });
    await writeFile(path.join(directory, `parameters.${extension}`), encode({ Shared: parameter('shared') }));
    const oldFile = path.join(directory, `old.${extension}`);
    const newFile = path.join(directory, `new.${extension}`);
    await writeFile(oldFile, encode(before));
    await writeFile(newFile, encode(after));
    const expected = [finding(), finding(hostile), finding('shared')];
    assert.deepEqual(compareSpecs(await loadSpec(oldFile), await loadSpec(newFile)), expected);
    const run = (...args) => spawnSync(process.execPath, ['--import', './test/network-guard.mjs', 'dist/cli.js', 'compare', ...args], { encoding: 'utf8' });
    const human = run(oldFile, newFile);
    assert.equal(human.status, 1, human.stderr);
    assert.equal(human.stdout.trim(), formatReport(expected));
    assert.equal(human.stderr, '');
    const json = run(oldFile, newFile, '--format', 'json');
    assert.equal(json.status, 1, json.stderr);
    assert.equal(json.stdout.trim(), formatJsonReport(expected));
    assert.equal(json.stderr, '');
    const mixedFile = path.join(directory, extension === 'json' ? 'mixed.yaml' : 'mixed.json');
    await writeFile(mixedFile, extension === 'json' ? stringify(before) : JSON.stringify(before));
    assert.equal(run(mixedFile, newFile, '--format', 'json').stdout, json.stdout);
    assert.equal(run(newFile, newFile).status, 0);
    assert.equal(run(oldFile, 'missing.json', '--format', 'json').status, 2);
  });
}
