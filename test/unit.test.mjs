import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSpecs } from '../dist/compare.js';
import { pointer, loadSpec } from '../dist/loader.js';
import { formatReport, formatJsonReport } from '../dist/report.js';

const spec = schema => ({ paths: { '/pets': { get: { responses: { 200: { content: { 'application/json': { schema } } } } } } } });
const object = properties => ({ type: 'object', properties });

test('detects four change categories with deterministic contextual report', async () => {
  const changes = compareSpecs(await loadSpec('test/fixtures/old.json'), await loadSpec('test/fixtures/new.json'));
  assert.equal(changes.length, 5);
  assert.deepEqual(new Set(changes.map(c => c.kind)), new Set(['path-removed', 'operation-removed', 'property-removed', 'property-type-changed']));
  assert.match(formatReport(changes), /\/tags\/\*\/label/);
  assert.match(formatReport(changes), /integer → string/);
});
test('additions and identical contracts are compatible', () => {
  const old = spec(object({ a: { type: 'string' } }));
  assert.deepEqual(compareSpecs(old, spec(object({ a: { type: 'string' }, b: { type: 'number' } }))), []);
  assert.deepEqual(compareSpecs(old, old), []);
});
test('type sets are normalized and nullable is included', () => {
  assert.deepEqual(compareSpecs(spec(object({ a: { type: ['string', 'null'] } })), spec(object({ a: { type: ['null', 'string'] } }))), []);
  assert.equal(compareSpecs(spec(object({ a: { type: 'string', nullable: true } })), spec(object({ a: { type: 'string' } })))[0].kind, 'property-type-changed');
});
test('allOf properties and array item types are compared', () => {
  const before = { allOf: [object({ a: { type: 'string' } })] };
  assert.equal(compareSpecs(spec(before), spec(object({})))[0].property, '/a');
  assert.equal(compareSpecs(spec(object({ a: { type: 'array', items: { type: 'string' } } })), spec(object({ a: { type: 'array', items: { type: 'integer' } } })))[0].property, '/a/*');
});
test('recursive local reference graph terminates', async () => {
  const document = await loadSpec('test/fixtures/reference.json');
  assert.deepEqual(compareSpecs(document, document), []);
  const changes = compareSpecs(document, spec(object({})));
  assert.ok(changes.length > 0);
});
test('removed response or content detects removed properties', () => {
  const before = spec(object({ a: { type: 'string' } }));
  const after = spec({});
  delete after.paths['/pets'].get.responses[200].content;
  assert.equal(compareSpecs(before, after)[0].kind, 'property-removed');
});
test('JSON Pointers support escaped and encoded names but exclude prototypes', () => {
  assert.equal(pointer({ 'a/b': { '~ %': 7 } }, '/a~1b/~0%20%25'), 7);
  assert.throws(() => pointer({}, '/toString'), /Unresolved/);
  assert.throws(() => pointer({}, '/bad~2'), /Invalid/);
});
test('terminal control characters are escaped', () => {
  assert.ok(!formatReport([{ kind: 'path-removed', path: '/\u001b[31m' }]).includes('\u001b'));
});

test('JSON escapes untrusted strings and serializes only finding fields', () => {
  const finding = { kind: 'path-removed', path: '/quote"/slash\\/line\n/\u001b' };
  const output = formatJsonReport([{ ...finding, filename: 'private-input.json', credentials: 'private-marker', specification: { info: 'private-description' } }]);
  assert.deepEqual(JSON.parse(output), { schemaVersion: 1, count: 1, findings: [finding] });
  assert.doesNotMatch(output, /private-|[\u0000-\u001f]/);
});

test('JSON comparison order is independent of object key insertion order', () => {
  const before = spec(object({ z: { type: 'string' }, a: { type: 'integer' } }));
  const reordered = spec(object({ a: { type: 'integer' }, z: { type: 'string' } }));
  const after = spec(object({}));
  assert.equal(formatJsonReport(compareSpecs(before, after)), formatJsonReport(compareSpecs(reordered, after)));
});
test('Paths Object extensions are not API paths', () => {
  assert.deepEqual(compareSpecs({ paths: { 'x-note': 'old' } }, { paths: {} }), []);
});
