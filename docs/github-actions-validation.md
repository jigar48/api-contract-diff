# PR guard validation report

Date: 2026-10-21. Branch: `codex/github-actions-pr-guard`.
Starting commit: `3ba71a75ebbdf246f3faeb0dce6925fccc7544d9`.

## Recommendation

**GO for integration of the example with the documented detection limits.**
This report records the final pre-push checks. The follow-up authorization permits
one reviewed commit, a fast-forward push to main, and hosted CI verification;
hosted results and the final commit SHA are reported separately after the push.
A successful run in the consuming repository is still needed before requiring
the copied guard in branch protection.

## Scope reviewed and delivered

Reviewed the CLI argument handling and exit codes, loader/reference restrictions,
comparison/reporting code, README, all existing test files, package/release
checks, TypeScript configuration, and the existing six-job CI matrix.

Added the example workflow, installation/configuration/security documentation,
README link, and tests executing the workflow's actual Bash comparison step.
No runtime source, dependencies, lockfile, package contents, or existing CI
configuration changed. The example is intentionally not an active workflow here.

## Results

| Check | Result |
| --- | --- |
| Clean lockfile installation, lifecycle scripts disabled | PASS |
| `npm test`, Node.js 24.19.0 / Windows | 93 tests: 92 pass, 0 fail, 1 skip |
| `npm test`, pinned Node.js 22.22.0 / Windows | 93 tests: 92 pass, 0 fail, 1 skip |
| New workflow tests (included above) | 14 pass, 0 fail, 0 skip |
| TypeScript `tsc --noEmit` | PASS |
| Build (`npm test` and package prepack) | PASS |
| actionlint 1.7.12, existing CI and new example | PASS; ShellCheck integration disabled (not installed) |
| Bash syntax validation of comparison command | PASS |
| `node --check` on test modules | PASS |
| `git diff --check` | PASS |
| `npm run check:release` | PASS: metadata, license, ignore rules, heuristic credential/path scan |
| `npm run check:package` | PASS: exact 12-file allowlist, clean production install, bin shim, 16 installed-CLI smoke cases |
| Action SHA verification | Both pinned SHAs match upstream `v7` tags via `git ls-remote` |
| Trusted tool SHA availability | Reviewed source commit exists in the fetched main history |
| Synthetic mixed JSON/YAML demonstration | Exit 1; expected five findings |

There is no repository-wide lint script or ESLint configuration. Lint validation
here consists of actionlint for the changed workflow plus JavaScript/Bash syntax
and whitespace checks; it is not a claim of an ESLint or ShellCheck run.
Temporary npm 11.6.2 and actionlint installations were outside the repository.
No project dependencies were added.

The one skipped test is the existing uppercase-extension/file-symlink case,
because file-symlink privilege is unavailable on this Windows host. Existing
directory-symlink confinement and canonical-loading cases passed.

## Required behavior exercised

For both JSON and YAML entry files, the actual comparison step was executed with
isolated base/head directory trees, paths containing spaces, and a local JSON
schema dependency. Network APIs were blocked in the CLI process during tests.

| Scenario | Expected and observed status |
| --- | --- |
| Unchanged specification and dependencies | 0 |
| Removed endpoint | 1 |
| Removed response property in head dependency only | 1 |
| Changed response property type in head dependency only | 1 |
| Invalid OpenAPI document | 2 |
| Missing local dependency | 2 |

Existing tests additionally cover mixed JSON/YAML input and nested reference
chains, recursive schemas, malformed formats, rejected remote references,
directory traversal, symlink escape, strict YAML resource limits, and deterministic
text/JSON output. Installed-package checks verify both CLI report formats and
all three exit statuses without comparison network access.

## Security and remaining limits

The workflow uses only `pull_request`, `contents: read`, immutable action/tool
pins, exact event base/head SHAs, disabled checkout credential persistence, and
no secrets. Only the trusted tool checkout is installed/built, with dependency
lifecycle scripts disabled. Neither PR checkout executes code. Full separate
trees preserve each version's reference graph. No remote spec fetching occurs.

The runner image can change; external downloads must remain available. This is
not a bit-for-bit infrastructure guarantee. The workflow was linted and its
comparison command tested locally, but hosted checkout, fork permissions,
approval policies, and branch protection have not been exercised by this task.
Tests on this host do not establish new Linux/macOS compatibility claims.

A disposable public demonstration was attempted in
[`jigar48/api-contract-diff-pr-guard-demo-20261021-sppeww`](https://github.com/jigar48/api-contract-diff-pr-guard-demo-20261021-sppeww).
GitHub refused the initial push because the authenticated CLI credential lacks
the `workflow` scope required to create workflow files. The repository remains
empty; no PR or Actions run was created, and credential scopes were not changed.
The copied-workflow hosted PR demonstration therefore remains **unverified**.
No secret, customer data, paid service, or destructive cleanup was involved.

Use disposable runners and review workflow modifications. Parsing untrusted input
still has resource risks; this is not a sandbox or a comprehensive API
compatibility gate. Exit 0 does not prove compatibility. The exclusions and
conservative findings in [the guide](github-actions.md#detection-limits) and
[README](../README.md#known-limitations) remain applicable.
