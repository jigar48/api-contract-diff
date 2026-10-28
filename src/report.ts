import type { Change } from './compare.js';

/** Version 1 permits additive finding kinds and details, never input metadata. */
export function formatJsonReport(changes: Change[]): string {
  return JSON.stringify({ schemaVersion: 1, count: changes.length, findings: changes.map(change => ({
    kind: change.kind,
    path: change.path,
    method: change.method,
    response: change.response,
    mediaType: change.mediaType,
    property: change.property,
    parameter: change.parameter,
    before: change.before,
    after: change.after,
  })) });
}

// Escape terminal controls from untrusted specification strings.
const safe = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
export function formatReport(changes: Change[]): string {
  if (!changes.length) return 'No breaking changes detected.';
  const lines = changes.map(change => {
    if (change.kind === 'path-removed') return `- Removed path: ${change.path}`;
    const operation = `${change.method!.toUpperCase()} ${change.path}`;
    if (change.kind === 'operation-removed') return `- Removed operation: ${operation}`;
    if (change.kind === 'query-parameter-newly-required') return `- Newly required query parameter: ${operation} parameter ${JSON.stringify(change.parameter)}`;
    if (change.kind === 'request-body-newly-required') return `- Newly required request body: ${operation}`;
    const context = `${operation} → ${change.response} (${change.mediaType}) ${change.property}`;
    return change.kind === 'property-removed' ? `- Removed response property: ${context}` : `- Changed response property type: ${context}: ${change.before} → ${change.after}`;
  });
  return [`${changes.length} breaking change(s) detected:`, ...lines.map(safe)].join('\n');
}
