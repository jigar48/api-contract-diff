# OpenAPI pull-request guard

Copy [pr-contract-check.yml](../examples/github-actions/pr-contract-check.yml) to
`.github/workflows/pr-contract-check.yml` in the repository containing your API.
Commit that workflow through your normal review process. In repository branch
protection or a ruleset, require the `contract` job after its first successful run.
The example is not automatically enabled in this tool's own CI.

## Installation and configuration

No published npm package is assumed. The workflow checks out this tool at an
immutable source commit, installs its committed lockfile with `npm ci
--ignore-scripts`, then builds the CLI. It pins checkout and setup-node by full
commit SHA and Node.js to 22.22.0. Review and update those pins deliberately;
the runner image and registry availability are external dependencies, so this
does not promise bit-for-bit reproducible infrastructure.

Set the job's `BASE_SPEC` and `HEAD_SPEC` to repository-relative entry filenames:

```yaml
env:
  BASE_SPEC: contracts/public/openapi.json
  HEAD_SPEC: contracts/public/openapi.json
```

Use `.json`, `.yaml`, or `.yml`, including mixed formats. For a rename or format
migration, configure different old and new paths. Use plain relative paths without
`..`, an absolute prefix, or shell expressions. Values are quoted environment
variables, not shell source. A missing entry on either side fails closed; a newly
introduced API needs an explicitly reviewed baseline rather than silently skipping.

Both complete trees are checked out at the PR event's exact base and head SHAs.
This compares the proposed head directly against the target branch snapshot,
not the merge base or GitHub's synthetic merge commit. Rerunning an old workflow
uses that event's original SHAs. To compare against an updated base, update the PR
branch so a fresh `synchronize` event captures it. Fork PRs use the fork's head
repository and the target's base.
No fetch-depth expansion or extraction of just one specification is needed.

Keep each reference graph under its entry file's directory, for example:

```text
contracts/public/openapi.yaml
contracts/public/schemas/order.json
contracts/public/schemas/common.yaml
```

An entry `$ref: './schemas/order.json#/Order'` resolves within its own checkout;
nested references resolve relative to their containing files. Dependency-only
changes are checked because there is no paths filter. A reference such as
`../shared.json` outside the entry directory is rejected even if it stays within
the repository. Reorganize the source graph rather than flattening or rewriting
references in CI. Submodules and Git LFS materialization are disabled; specification
graphs requiring those features are not supported by this example.

For local installation and the identical comparison command:

```sh
git clone https://github.com/jigar48/api-contract-diff.git contract-tool
git -C contract-tool checkout --detach 3ba71a75ebbdf246f3faeb0dce6925fccc7544d9
cd contract-tool
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node dist/cli.js compare /path/to/base/api/openapi.yaml /path/to/head/api/openapi.yaml --format json
```

Installation downloads code/dependencies; the comparison reads only local files
and never fetches remote specifications. The final workflow command returns the
CLI status directly, without `continue-on-error`, a pipeline, or `|| true`:

| Exit | CLI result | Job result |
| --- | --- | --- |
| 0 | No supported breaking changes | Pass |
| 1 | Supported breaking changes | Fail |
| 2 | Invalid input, rejected reference, or execution error | Fail |

Installation, checkout, and runner failures also fail the job, but are not CLI
exit-2 reports. Inspect the failed step and its logs to distinguish them.

## Synthetic demonstration

After building a source checkout, run:

```sh
node dist/cli.js compare examples/orders-before.json examples/orders-before.json --format json
node dist/cli.js compare examples/orders-before.json examples/orders-after.json --format json
node dist/cli.js compare examples/orders-before.yaml examples/orders-after.yaml --format json
node dist/cli.js compare examples/orders-before.json examples/orders-after.yaml --format json
node dist/cli.js compare examples/does-not-exist.json examples/orders-after.json --format json
```

Run each command separately: the expected exits are `0`, `1`, `1`, `1`, `2`.
The three breaking comparisons report five findings: removed `/legacy-orders`,
removed `DELETE /orders/{orderId}`, removed `/customer/email`, and changed types
for `/total` and `/items/*/quantity`. These are synthetic specifications with no
customer data. To demonstrate in a disposable API repository, add the before
specification at the configured path on the target branch, then propose the after
version in a PR. Keeping the before version passes; substituting malformed JSON
or YAML fails with exit 2. No credentials or remote API are needed.

## Security

The event is `pull_request`, never `pull_request_target`. The only token permission
is `contents: read`; all checkouts disable credential persistence. No secrets are
referenced. PR scripts, package manifests, lifecycle hooks, build files, and local
actions are not executed. Only the separately pinned trusted tool is installed
and built; PR specifications are parsed as data. Do not change the tool ref to a
PR-controlled revision or run installation inside either specification checkout.
Do not add a write token, secret, or privileged follow-up that executes PR code.

Use disposable GitHub-hosted runners as shown, not a persistent self-hosted runner
with credentials or sensitive files. Workflow changes themselves remain untrusted
PR code: repository approval policies and review of workflow changes still matter.
The guard is not protection against a contributor altering their own workflow.
Logs may contain API paths and property names, so use only specifications suitable
for that repository's Actions log visibility. No PR comments or artifacts are posted.

Parsing hostile documents still has resource risks. The timeout bounds job duration;
the loader is not an OS sandbox. JSON has no size/depth budget, and neither format
has aggregate reference-count or comparison-work limits. YAML has strict per-file
limits and rejects anchors, aliases, merge keys, duplicate keys, and custom tags.
Quote numeric YAML response keys, for example `'200'`. Local references cannot
escape the entry directory, including through symlinks; URI, absolute, remote,
and non-pointer references are rejected. See the [README](../README.md#supported-formats-and-yaml-security).

## Detection limits

Exit 0 means only that no supported breaking change was detected, not that the API
is compatible. The tool detects removed paths/operations, removed named response
properties, and changed response property types, including nested objects, arrays,
maps, local references, and structural `allOf` declarations. It also detects newly
required query parameters on existing operations, with path inheritance and
operation overrides.

It does not compare request bodies, other parameter locations, query schemas or
serialization, headers, callbacks, or webhooks. It does
not generally analyze `oneOf`/`anyOf`, tuple `prefixItems`, enums, formats,
constraints, response-property requiredness-only changes, discriminators, or schema satisfiability.
Root response type changes and map removal have no separate finding category.
Status codes and media types match literally; removal of a bodyless response or
one without named properties may go undetected. Optional-property removals and
some compatible type changes are conservatively reported. Unsupported schema
scopes, anchors, dynamic references, or dialects fail validation.

Use API review and integration tests alongside this guard. The full
[known limitations](../README.md#known-limitations) apply unchanged.
