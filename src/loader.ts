import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Ajv2020 } from 'ajv/dist/2020.js';

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
    const value: unknown = JSON.parse(await readFile(canonical, 'utf8'));
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
    throw new Error('Expected an OpenAPI 3.0 or 3.1 JSON document');
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
