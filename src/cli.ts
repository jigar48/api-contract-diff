#!/usr/bin/env node
import { loadSpec } from './loader.js';
import { compareSpecs } from './compare.js';
import { formatReport, formatJsonReport } from './report.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] !== 'compare' || ![3, 5].includes(args.length) ||
      args.slice(1, 3).some(arg => arg.startsWith('-')) ||
      (args.length === 5 && (args[3] !== '--format' || args[4] !== 'json'))) {
    console.error('Usage: api-contract-diff compare <old.json> <new.json> [--format json]');
    console.error('Expected two local input files and, optionally, --format json.');
    return 2;
  }
  try {
    const oldSpec = await loadSpec(args[1]);
    const newSpec = await loadSpec(args[2]);
    const changes = compareSpecs(oldSpec, newSpec);
    console.log(args.length === 5 ? formatJsonReport(changes) : formatReport(changes));
    return changes.length ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')}`);
    return 2;
  }
}
process.exitCode = await main();
