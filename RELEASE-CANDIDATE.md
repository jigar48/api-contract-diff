# Release candidate: 0.1.0-rc.1

Updated for the user-created GitHub repository. The current approval gates and
verified remote state are in [PRIVATE-CI-PREFLIGHT.md](PRIVATE-CI-PREFLIGHT.md).

Prepared locally on 2026-10-16. Comparison behavior was not changed during release
preparation. This candidate detects four structural change categories and is **not
a comprehensive compatibility gate**; exit 0 is not a compatibility guarantee.

## Local verification results

Both local environments are Windows x64. Node 22 was downloaded from nodejs.org
and checked against its published SHA-256 checksum before use.

| Check | Node 22.23.3 / npm 10.9.9 | Node 24.19.0 / npm 11.6.2 |
| --- | --- | --- |
| `npm ci` | PASS; 18 installed, 19 audited, 0 reported vulnerabilities | PASS; 18 installed, 19 audited, 0 reported vulnerabilities |
| `npm run build` | PASS | PASS |
| `npm test` | 40 passed, 0 failed, 0 skipped | 40 passed, 0 failed, 0 skipped |
| `npm run check:release` | PASS | PASS |
| `npm run check:package` | PASS; 5 installed-CLI smoke checks | PASS; 5 installed-CLI smoke checks |

The vulnerability counts above are npm's results at the time of these installs,
not a guarantee that dependencies have no vulnerabilities.

Installed-CLI smoke checks run through the generated local bin shim in a temporary
clean consumer directory containing a space in its name. The install includes
production dependencies only, disables install scripts, and has no TypeScript
package. Network APIs are blocked during CLI execution.

| Packaged CLI case | Expected and observed exit |
| --- | --- |
| Unchanged specification | 0 |
| Breaking fixture, five findings | 1 |
| Invalid JSON | 2 |
| Remote reference | 2 |
| Invalid command/usage | 2 |

Workflow YAML and all six matrix combinations were checked locally. Checksum-
verified actionlint 1.7.12 also passed with no diagnostics. GitHub Actions itself
has not been run.

## Configured CI coverage

| GitHub runner | Node 22 | Node 24 |
| --- | --- | --- |
| `ubuntu-latest` | Configured; remote run pending | Configured; remote run pending |
| `windows-latest` | Configured; remote run pending | Configured; remote run pending |
| `macos-latest` | Configured; remote run pending | Configured; remote run pending |

Every combination runs `npm ci`, build, tests, release checks, and package checks.
The workflow uses SHA-pinned checkout/setup actions, `contents: read`, disabled
credential persistence, no custom secrets, no publishing steps, and a 15-minute
job timeout. No hosted runner was started during this preparation.

## Package and repository hygiene

The current candidate tarball is `api-contract-diff-0.1.0-rc.1.tgz` (11,215 bytes).

SHA-256:

```text
0cd3f0f94c752bd3615546e3a685a038b82aa59e37fcfc26acb13c5969b4d372
```

The allowlist contains exactly 12 files: `package.json`, `README.md`, `LICENSE`,
`SECURITY.md`, and the four compiled modules with their four type declaration
files. It excludes source maps, tests, source files, workflows, audit/release notes,
lockfiles, local configuration, archives, credentials, and bundled dependencies.
Dependencies are obtained by npm at installation time.

Package metadata, matching lockfile version, the CLI shebang/bin mapping, MIT
license text, ignore rules, package file inventory, and installed package inventory
were checked. Public Git candidate files and all 12 package files were scanned
for common tokens, private keys, registry authentication, URL credentials, and
local absolute paths. No matches were found. Heuristic scanning supplements manual
review and is not exhaustive secret detection.

Git was initialized locally on `main`. Build output, dependencies, archives,
environment files, registry configuration, private keys, editor settings, and logs
are ignored. The user created `jigar48/api-contract-diff`; its visibility was
verified public during the private-CI preflight. No local origin, commit, tag,
push, or GitHub release was created by this work. Initial project files are staged
for review. The tarball is a local ignored artifact.

## Blockers before announcing a public candidate

1. Review and commit the initial staged files. No release tag exists yet.
2. Obtain approval to make the existing repository private and push for CI only
   after confirming a no-spend guard. Real repository/homepage/bugs URLs have now
   been added to package metadata; no remote creation is necessary.
3. Run the configured workflow on GitHub and inspect all six job results. Local
   Windows results do not establish Ubuntu/macOS or GitHub-hosted runner success.
4. Follow the private-collaborator disclosure process during private validation.
   Before a later public release, enable private vulnerability reporting and verify
   the option described in `SECURITY.md`. No disclosure email is invented.
5. Include the known limitations and experimental candidate status in any release
   announcement. Requiredness-only changes, response-status fallback equivalence,
   full schema composition/constraints, and filesystem isolation remain limited.

## Readiness

**Local preparation is complete; public release readiness is conditional on the
blockers above.** The six-job CI configuration is ready for review, and the Windows
Node 22/24 build, tests, package checks, and installed CLI checks pass. No remote
repository was created, and nothing was pushed, published, deployed, or purchased.
