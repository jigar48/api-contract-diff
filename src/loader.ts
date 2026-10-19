import { open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Composer, Lexer, Parser, isAlias, isMap, isSeq, isScalar, type CST } from 'yaml';

const YAML_MAX_BYTES = 2 * 1024 * 1024;
const YAML_MAX_DEPTH = 64;
const YAML_MAX_COLLECTION_ITEMS = 1024;
const YAML_MAX_TOTAL_ITEMS = 10_000;

/** Bound reads before parsing; never expand aliases or coerce mapping keys. */
async function readDocument(file: string): Promise<unknown> {
  if (!/\.ya?ml$/i.test(file)) return JSON.parse(await readFile(file, 'utf8'));
  const handle = await open(file, 'r');
  let source: string;
  try {
    const buffer = Buffer.alloc(YAML_MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > YAML_MAX_BYTES) throw new Error('YAML exceeds the 2 MiB input limit');
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)); }
    catch { throw new Error('YAML must be valid UTF-8'); }
  } finally { await handle.close(); }
  // Parser builds syntax only; Composer performs duplicate-key comparisons.
  // Check each completed CST exactly once before handing any tokens to Composer.
  const parser = new Parser();
  const tokens: CST.Token[] = [];
  let documents = 0;
  let totalItems = 0;
  function checkToken(token: CST.Token): void {
    if (token.type === 'document' && ++documents > 1) throw new Error('Multiple YAML documents are not supported');
    const pending = [token];
    while (pending.length) {
      const current = pending.pop()!;
      if (current.type === 'document') {
        if (current.value) pending.push(current.value);
      } else if (current.type === 'block-map' || current.type === 'block-seq' || current.type === 'flow-collection') {
        if (current.items.length > YAML_MAX_COLLECTION_ITEMS) throw new Error('YAML exceeds the collection limit of 1024 items');
        totalItems += current.items.length;
        if (totalItems > YAML_MAX_TOTAL_ITEMS) throw new Error('YAML exceeds the total collection limit of 10000 items');
        for (const item of current.items) {
          if (item.key) pending.push(item.key);
          if (item.value) pending.push(item.value);
        }
      }
    }
    tokens.push(token);
  }
  for (const lexeme of new Lexer().lex(source)) {
    for (const token of parser.next(lexeme)) checkToken(token);
    if (parser.stack.length > YAML_MAX_DEPTH + 1) throw new Error('YAML exceeds the maximum structural depth of 64');
  }
  for (const token of parser.end()) checkToken(token);
  const composer = new Composer({
    version: '1.2', schema: 'core', strict: true, uniqueKeys: true,
    merge: false, resolveKnownTags: false, prettyErrors: false, logLevel: 'silent',
  });
  const [doc] = composer.compose(tokens, true, source.length);
  const issue = doc.errors[0] ?? doc.warnings[0];
  if (issue) throw new Error(`Invalid YAML (${issue.code})`);
  if (doc.directives?.yaml.version !== '1.2') throw new Error('Only YAML 1.2 is supported');
  function convert(node: unknown, depth: number): unknown {
    if (depth > YAML_MAX_DEPTH) throw new Error('YAML exceeds the maximum structural depth of 64');
    if (node === null) return null;
    if (isAlias(node)) throw new Error('YAML aliases are not supported');
    if (!isScalar(node) && !isMap(node) && !isSeq(node)) throw new Error('Unsupported YAML node');
    if (node.anchor) throw new Error('YAML anchors are not supported');
    const allowedTags = ['str', 'null', 'bool', 'int', 'float', 'map', 'seq'].map(tag => `tag:yaml.org,2002:${tag}`);
    if (node.tag && !allowedTags.includes(node.tag)) throw new Error('Unsupported YAML tag');
    if (isMap(node)) {
      const result: ObjectNode = {};
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('YAML mapping keys must be strings; quote numeric response codes');
        const key = convert(pair.key, depth + 1) as string;
        if (key === '<<') throw new Error('YAML merge keys are not supported');
        if (Object.hasOwn(result, key)) throw new Error('Duplicate YAML mapping key');
        Object.defineProperty(result, key, { value: convert(pair.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    if (isSeq(node)) return node.items.map(item => convert(item, depth + 1));
    const value = node.value;
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('YAML numbers must be finite and integers must be safe');
    return value;
  }
  return convert(doc.contents, 0);
}

export type ObjectNode = Record<string, any>;
export const isObject = (value: unknown): value is ObjectNode =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** JSON Pointer lookup deliberately excludes inherited properties. */
export function pointer(document: unknown, fragment: string): unknown {
  const decoded = decodeURIComponent(fragment);
  if (decoded === '') return document;
  if (!decoded.startsWith('/')) throw new Error(`Unsupported reference fragment: #${fragment}`);
  let current = document;
  for (const part of decoded.slice(1).split('/')) {
    if (/~(?![01])/u.test(part)) throw new Error(`Invalid JSON Pointer: #${fragment}`);
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      throw new Error(`Unresolved reference: #${fragment}`);
    }
    current = (current as ObjectNode)[key];
  }
  return current;
}

/** Read and bundle references ourselves; no URL resolver is ever enabled. */
export async function loadSpec(filename: string): Promise<ObjectNode> {
  // Reject network/device paths before the filesystem can attempt UNC access.
  if (/^[\\/]{2}/.test(filename) || (/^[a-z][a-z\d+.-]*:/i.test(filename) && !/^[a-z]:[\\/]/i.test(filename))) {
    throw new Error('Input must be a local filesystem path');
  }
  const entry = await realpath(path.resolve(filename));
  const boundary = path.dirname(entry);
  const documents = new Map<string, { id: string; value: unknown }>();
  const refs: string[] = [];

  async function load(file: string): Promise<string> {
    const canonical = await realpath(file);
    const relative = path.relative(boundary, canonical);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Reference escapes specification directory: ${file}`);
    }
    const cached = documents.get(canonical);
    if (cached) return cached.id;
    const value: unknown = await readDocument(canonical);
    const id = `d${documents.size}`;
    documents.set(canonical, { id, value });
    async function visit(node: unknown): Promise<void> {
      if (node === null || typeof node !== 'object') return;
      if (isObject(node)) {
        // Resource scopes and dynamic anchors require JSON Schema URI resolution.
        for (const key of ['$id', '$anchor', '$dynamicRef', '$dynamicAnchor']) {
          if (Object.hasOwn(node, key)) throw new Error(`Unsupported JSON Schema keyword: ${key}`);
        }
        if (Object.hasOwn(node, '$ref')) {
          if (typeof node.$ref !== 'string') throw new Error('$ref must be a string');
          const ref = node.$ref as string;
          const hash = ref.indexOf('#');
          const location = hash < 0 ? ref : ref.slice(0, hash);
          const fragment = hash < 0 ? '' : ref.slice(hash + 1);
          const local = decodeURIComponent(location);
          if (/^[a-z][a-z\d+.-]*:/i.test(local) || local.startsWith('/') || local.includes('\\') || local.includes('?') || local.includes('\0')) {
            throw new Error(`Only relative local references are allowed: ${ref}`);
          }
          const targetPath = path.resolve(path.dirname(canonical), local);
          const relativeTarget = path.relative(boundary, targetPath);
          if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
            throw new Error(`Reference escapes specification directory: ${ref}`);
          }
          const target = local ? await load(targetPath) : id;
          // Validate fragment syntax now, and existence after the graph is loaded.
          const decoded = decodeURIComponent(fragment);
          if (decoded && !decoded.startsWith('/')) throw new Error(`Only JSON Pointer fragments are supported: ${ref}`);
          node.$ref = `#/x-contract-documents/${target}${fragment}`;
          refs.push(node.$ref);
        }
      }
      for (const child of Object.values(node)) await visit(child);
    }
    await visit(value);
    return id;
  }

  await load(entry);
  const root = documents.get(entry)!.value;
  if (!isObject(root) || typeof root.openapi !== 'string' || !/^3\.[01]\.\d+$/.test(root.openapi)) {
    throw new Error('Expected an OpenAPI 3.0 or 3.1 JSON or YAML document');
  }
  const is30 = root.openapi.startsWith('3.0.');
  if (Object.hasOwn(root, 'x-contract-documents')) throw new Error('Reserved extension: x-contract-documents');
  if (root.jsonSchemaDialect && ![
    'https://spec.openapis.org/oas/3.1/dialect/base',
    'https://json-schema.org/draft/2020-12/schema',
  ].includes(root.jsonSchemaDialect)) throw new Error(`Unsupported JSON Schema dialect: ${root.jsonSchemaDialect}`);
  const bundled = { ...root, 'x-contract-documents': Object.fromEntries([...documents.values()].map(d => [d.id, d.value])) };
  for (const ref of refs) pointer(bundled, ref.slice(1));
  const schemaRoots: unknown[] = [];
  function findSchemas(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (isObject(node)) {
      if (Object.hasOwn(node, 'schema')) schemaRoots.push(node.schema);
      if (isObject(node.components?.schemas)) schemaRoots.push(...Object.values(node.components.schemas));
    }
    for (const child of Object.values(node)) findSchemas(child);
  }
  findSchemas(bundled);
  if (root.openapi.startsWith('3.1.')) {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    const checked = new Set<unknown>();
    function validateSchema(schema: unknown): void {
      if (checked.has(schema)) return;
      checked.add(schema);
      if (isObject(schema) && schema.$schema && ![
        'https://spec.openapis.org/oas/3.1/dialect/base',
        'https://json-schema.org/draft/2020-12/schema',
      ].includes(schema.$schema)) throw new Error(`Unsupported JSON Schema dialect: ${schema.$schema}`);
      const candidate = isObject(schema) ? { ...schema, $schema: 'https://json-schema.org/draft/2020-12/schema' } : schema;
      if (!ajv.validateSchema(candidate as any)) throw new Error(`Invalid response/component schema: ${ajv.errorsText()}`);
      if (!isObject(schema)) return;
      if (schema.$ref) validateSchema(pointer(bundled, schema.$ref.slice(1)));
      for (const key of ['properties', 'patternProperties', '$defs', 'dependentSchemas']) {
        for (const child of Object.values(schema[key] ?? {})) validateSchema(child);
      }
      for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
        for (const child of schema[key] ?? []) validateSchema(child);
      }
      for (const key of ['items', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'contentSchema']) {
        if (Object.hasOwn(schema, key)) validateSchema(schema[key]);
      }
    }
    for (const schema of schemaRoots) validateSchema(schema);
  }
  // The generic dereferencer shallow-merges siblings, which is incorrect for
  // Schema Objects: 3.0 ignores them, while 3.1 applies them conjunctively.
  const normalized = new Set<unknown>();
  function normalizeSchema(schema: unknown): void {
    if (!isObject(schema) || normalized.has(schema)) return;
    normalized.add(schema);
    const ref = schema.$ref;
    if (typeof ref === 'string') normalizeSchema(pointer(bundled, ref.slice(1)));
    for (const key of ['properties', 'patternProperties', '$defs', 'dependentSchemas']) {
      for (const child of Object.values(schema[key] ?? {})) normalizeSchema(child);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
      if (Array.isArray(schema[key])) for (const child of schema[key]) normalizeSchema(child);
    }
    for (const key of ['items', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'contentSchema']) {
      normalizeSchema(schema[key]);
    }
    if (typeof ref === 'string' && Object.keys(schema).length > 1) {
      const { $ref: _, ...siblings } = schema;
      for (const key of Object.keys(schema)) delete schema[key];
      if (is30) schema.$ref = ref;
      else schema.allOf = [{ $ref: ref }, siblings];
    }
  }
  for (const schema of schemaRoots) normalizeSchema(schema);
  // The parser receives an in-memory graph with internal references only.
  return await SwaggerParser.validate(bundled as any, {
    resolve: { external: false, file: false, http: false },
    dereference: { circular: true },
  }) as unknown as ObjectNode;
}
