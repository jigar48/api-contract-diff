import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 180_000, ...options });
  if (result.error) throw result.error;
  return result;
}

export function npm(args, options = {}) {
  if (!process.env.npm_execpath) throw new Error('Run this check through npm run');
  return command(process.execPath, [process.env.npm_execpath, ...args], options);
}

export function success(result, label) {
  if (result.status !== 0) throw new Error(`${label} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

// Heuristics complement manual review; they are not a guarantee that no secret exists.
const patterns = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36,}\b/],
  ['registry authentication', /(?:_authToken|_auth)\s*=\s*[^\s$]+/],
  ['credential in URL', /https?:\/\/[^\s/@:]+:[^\s/@]+@/],
  ['local Windows path', /\b[A-Za-z]:[\\/](?:Users|work)[\\/]/i],
  ['local home path', /\/(?:home|Users)\/[A-Za-z0-9_.-]+\//],
];

export async function scanFile(file, label = file) {
  const content = await readFile(file, 'utf8');
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) throw new Error(`Review required: ${name} in ${label} (value omitted)`);
  }
}
