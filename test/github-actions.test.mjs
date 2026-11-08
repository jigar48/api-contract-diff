import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { command, success } from '../scripts/release-utils.mjs';

const workflow = parse(await readFile('examples/github-actions/pr-contract-check.yml', 'utf8'));
const job = workflow.jobs.contract;
const comparison = job.steps.find(step => step.name === 'Compare contracts');
const toolPin = job.steps.find(step => step.name === 'Check out trusted comparison tool').with.ref;

test('PR example keeps execution trusted, read-only, and pinned', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job['timeout-minutes'], 10);
  const checkouts = job.steps.filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 3);
  for (const step of job.steps.filter(step => step.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  for (const step of checkouts) {
    assert.equal(step.with['persist-credentials'], false);
    assert.equal(step.with.submodules, false);
    assert.equal(step.with.lfs, false);
  }
  assert.equal(checkouts[0].with.repository, 'jigar48/api-contract-diff');
  assert.match(checkouts[0].with.ref, /^[a-f0-9]{40}$/);
  assert.equal(checkouts[1].with.ref, '${{ github.event.pull_request.base.sha }}');
  assert.equal(checkouts[2].with.ref, '${{ github.event.pull_request.head.sha }}');
  assert.equal(checkouts[2].with.repository, '${{ github.event.pull_request.head.repo.full_name }}');
  const install = job.steps.find(step => step.run?.includes('npm ci'));
  assert.equal(install['working-directory'], 'contract-tool');
  assert.match(install.run, /npm ci --ignore-scripts/);
  assert.equal(comparison.shell, 'bash');
  assert.equal(comparison['continue-on-error'], undefined);
  assert.doesNotMatch(comparison.run, /\$\{\{|secrets\./);
});

// Normal CI uses the current build. A pin review supplies a freshly built detached checkout.
test('PR comparison step preserves CLI status and each tree\'s reference graph', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'contract guard '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tool = path.resolve(process.env.CONTRACT_TOOL_CHECKOUT ?? '.');
  if (process.env.CONTRACT_TOOL_CHECKOUT) {
    const git = args => success(command('git', ['-C', tool, ...args]), 'Inspect pinned tool checkout');
    assert.equal(git(['rev-parse', 'HEAD']).trim(), toolPin);
    assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '');
    t.diagnostic(`Testing workflow tool pin ${toolPin}`);
  }
  await symlink(tool, path.join(root, 'contract-tool'), process.platform === 'win32' ? 'junction' : 'dir');
  const bash = process.platform === 'win32'
    ? path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : 'bash';
  const guard = pathToFileURL(path.resolve('test/network-guard.mjs')).href;
  function compare(extension) {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', comparison.run], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env,
        GITHUB_WORKSPACE: root.replaceAll('\\', '/'),
        BASE_SPEC: `api folder/openapi.${extension}`,
        HEAD_SPEC: `api folder/openapi.${extension}`,
        NODE_OPTIONS: `--import=${guard}`,
      },
    });
    if (result.error) throw result.error;
    assert.doesNotMatch(result.stderr, /Network access attempted/);
    return result;
  }
  for (const extension of ['json', 'yaml']) {
    const encode = value => extension === 'json' ? JSON.stringify(value) : stringify(value);
    const spec = {
      openapi: '3.0.3', info: { title: 'Synthetic guard', version: '1' },
      paths: { '/orders': { get: { responses: { '200': {
        description: 'Synthetic', content: { 'application/json': {
          schema: { $ref: './schemas/order.json#/Order' },
        } },
      } } } } },
    };
    const schema = { Order: { type: 'object', properties: {
      id: { type: 'integer' }, label: { type: 'string' },
    } } };
    for (const tree of ['contract-base', 'contract-head']) {
      await mkdir(path.join(root, tree, 'api folder', 'schemas'), { recursive: true });
      await writeFile(path.join(root, tree, 'api folder', 'schemas', 'order.json'), JSON.stringify(schema));
      await writeFile(path.join(root, tree, 'api folder', `openapi.${extension}`), encode(spec));
    }
    const proposed = path.join(root, 'contract-head', 'api folder', `openapi.${extension}`);
    const dependency = path.join(root, 'contract-head', 'api folder', 'schemas', 'order.json');
    const cases = [
      ['unchanged', 0, undefined, undefined],
      ['removed endpoint', 1, { ...spec, paths: {} }, undefined],
      ['removed response property in dependency', 1, undefined,
        { Order: { type: 'object', properties: { id: { type: 'integer' } } } }],
      ['changed response type in dependency', 1, undefined,
        { Order: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } } } }],
      ['invalid specification', 2, {}, undefined],
      ['missing dependency', 2, undefined, null],
      ['reference at byte limit', 0, undefined, JSON.stringify(schema).padEnd(2 * 1024 * 1024)],
      ['oversized reference', 2, undefined, JSON.stringify(schema).padEnd(2 * 1024 * 1024 + 1),
        'Error: JSON exceeds the 2 MiB input limit\n'],
    ];
    for (const [name, expected, nextSpec, nextSchema, diagnostic] of cases) {
      await t.test(`${extension}: ${name}`, async () => {
        await writeFile(proposed, encode(nextSpec ?? spec));
        if (nextSchema === null) await rm(dependency);
        else await writeFile(dependency, typeof nextSchema === 'string' ? nextSchema : JSON.stringify(nextSchema ?? schema));
        const result = compare(extension);
        assert.equal(result.status, expected, result.stderr);
        if (expected === 2) {
          assert.equal(result.stdout, '');
          if (diagnostic) assert.equal(result.stderr, diagnostic);
          else assert.match(result.stderr, /Error:/);
        } else {
          assert.equal(result.stderr, '');
          const report = JSON.parse(result.stdout);
          assert.equal(report.count, expected);
        }
      });
    }
  }

  await t.test('head entry symlink cannot redirect the comparison into the base checkout', async () => {
    const baseDir = path.join(root, 'contract-base', 'api folder');
    const headDir = path.join(root, 'contract-head', 'api folder');
    await rename(headDir, path.join(root, 'contract-head', 'original api folder'));
    await symlink(baseDir, headDir, process.platform === 'win32' ? 'junction' : 'dir');
    const result = compare('yaml');
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Error: each specification entry must resolve to a regular file inside its own checkout\n');
  });
});
