import { isObject, type ObjectNode } from './loader.js';

export interface Change {
  kind: 'path-removed' | 'operation-removed' | 'property-removed' | 'property-type-changed' | 'query-parameter-newly-required';
  path: string;
  method?: string;
  response?: string;
  mediaType?: string;
  property?: string;
  parameter?: string;
  before?: string;
  after?: string;
}
const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Inputs are validated and dereferenced by loadSpec. Only query identities matter here. */
function queryParameters(pathItem: ObjectNode, operation: ObjectNode): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const parameters of [pathItem.parameters, operation.parameters]) {
    for (const parameter of parameters ?? []) {
      if (parameter.in === 'query') result.set(parameter.name, parameter.required === true);
    }
  }
  return result;
}

function parts(schema: unknown, seen = new Set<unknown>()): ObjectNode[] {
  if (!isObject(schema) || seen.has(schema)) return [];
  seen.add(schema);
  return [schema, ...(schema.allOf ?? []).flatMap((part: unknown) => parts(part, seen))];
}

function types(schema: unknown, nullableEnabled: boolean): string {
  const schemas = parts(schema);
  let intersection: Set<string> | undefined;
  for (const part of schemas) {
    const declared: string[] = Array.isArray(part.type) ? part.type : part.type ? [part.type] : [];
    if (!declared.length) continue;
    const values = new Set(declared);
    if (values.has('number')) values.add('integer');
    if (nullableEnabled && part.nullable) values.add('null');
    intersection = intersection ? new Set([...intersection].filter(type => values.has(type))) : values;
  }
  if (!intersection) {
    if (schemas.some(part => part.properties)) return 'object';
    if (schemas.some(part => part.items)) return 'array';
    return 'unspecified';
  }
  if (intersection.has('number')) intersection.delete('integer');
  return [...intersection].sort().join(' | ') || 'never';
}

export function compareSpecs(oldSpec: ObjectNode, newSpec: ObjectNode): Change[] {
  const changes: Change[] = [];
  const oldNullable = !oldSpec.openapi?.startsWith('3.1.');
  const newNullable = !newSpec.openapi?.startsWith('3.1.');
  // Keep conjunction identities stable so recursive composed schemas terminate.
  const merged = new WeakMap<object, WeakMap<object, ObjectNode>>();
  function conjunction(a: any, b: any): any {
    if (a === undefined) return b;
    if (a === b || b === undefined) return a;
    if (a === false || b === false) return false;
    if (a === true) return b;
    if (b === true) return a;
    let cache = merged.get(a);
    if (!cache) merged.set(a, cache = new WeakMap());
    let result = cache.get(b);
    if (!result) cache.set(b, result = { allOf: [a, b] });
    return result;
  }
  function properties(schema: unknown): ObjectNode {
    const result: ObjectNode = Object.create(null);
    for (const part of parts(schema)) {
      for (const [name, child] of Object.entries(part.properties ?? {})) result[name] = conjunction(result[name], child);
    }
    return result;
  }
  function keyword(schema: unknown, name: string): unknown {
    return parts(schema).reduce((result, part) => conjunction(result, part[name]), undefined);
  }
  function walk(before: unknown, after: unknown, context: Omit<Change, 'kind'>, property: string, ancestors: Array<[unknown, unknown]>): void {
    if (!isObject(before) || ancestors.some(([a, b]) => a === before && b === after)) return;
    const next = [...ancestors, [before, after] as [unknown, unknown]];
    if (property && types(before, oldNullable) !== types(after, newNullable)) {
      changes.push({ ...context, kind: 'property-type-changed', property, before: types(before, oldNullable), after: types(after, newNullable) });
    }
    const oldProps = properties(before);
    const newProps = properties(after);
    for (const name of Object.keys(oldProps).sort()) {
      const location = `${property}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (!Object.hasOwn(newProps, name)) changes.push({ ...context, kind: 'property-removed', property: location });
      else walk(oldProps[name], newProps[name], context, location, next);
    }
    const items = keyword(before, 'items');
    if (isObject(items)) walk(items, keyword(after, 'items'), context, `${property}/*`, next);
    const map = keyword(before, 'additionalProperties');
    if (isObject(map)) {
      walk(map, keyword(after, 'additionalProperties'), context, `${property}/{key}`, next);
    }
  }
  for (const apiPath of Object.keys(oldSpec.paths ?? {}).filter(key => key.startsWith('/')).sort()) {
    if (!Object.hasOwn(newSpec.paths ?? {}, apiPath)) {
      changes.push({ kind: 'path-removed', path: apiPath });
      continue;
    }
    for (const method of methods) {
      const oldOperation = oldSpec.paths[apiPath][method];
      if (!oldOperation) continue;
      const newOperation = newSpec.paths[apiPath][method];
      if (!newOperation) {
        changes.push({ kind: 'operation-removed', path: apiPath, method });
        continue;
      }
      const oldQuery = queryParameters(oldSpec.paths[apiPath], oldOperation);
      const newQuery = queryParameters(newSpec.paths[apiPath], newOperation);
      for (const name of [...newQuery.keys()].sort()) {
        if (newQuery.get(name) && oldQuery.get(name) !== true) {
          changes.push({ kind: 'query-parameter-newly-required', path: apiPath, method, parameter: name });
        }
      }
      for (const status of Object.keys(oldOperation.responses ?? {}).filter(key => key === 'default' || /^[1-5](?:\d{2}|XX)$/.test(key)).sort()) {
        const response = oldOperation.responses[status];
        for (const mediaType of Object.keys(response.content ?? {}).sort()) {
          const oldSchema = response.content[mediaType].schema;
          const newSchema = newOperation.responses?.[status]?.content?.[mediaType]?.schema;
          walk(oldSchema, newSchema, { path: apiPath, method, response: status, mediaType }, '', []);
        }
      }
    }
  }
  return changes;
}
