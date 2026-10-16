# API compatibility and security audit

This records the audit before release preparation. For current repository, CI,
and packaging readiness, see [RELEASE-CANDIDATE.md](RELEASE-CANDIDATE.md).

Reviewed 2026-10-16. Scope: existing Milestone 1 CLI. No new change categories,
network capabilities, publishing, deployment, or UI work were added.

## Findings by severity

### High — fixed: composition could produce a false clean result

An existing property changing from `allOf: [{type: "string"}]` to
`allOf: [{type: "integer"}]` produced no finding. Arrays wrapped in `allOf`
also hid nested property removals. Duplicate property declarations in separate
branches overwrote one another: reordering equivalent branches could report a
removal, while actual removals could disappear.

The comparator now combines named declarations conjunctively, intersects declared
types (including the integer/number relationship), and traverses composed item and
map schemas. It preserves conjunction identities to terminate recursive traversal.
This is a structural projection, not general JSON Schema intersection evaluation.

### High — fixed: schema reference siblings changed the meaning of contracts

The generic dereferencer shallow-merged `$ref` siblings. In a reproduced 3.0 case,
a sibling `properties` map replaced the referenced map and yielded `/local`
instead of `/base`. OpenAPI 3.0 Schema Object reference siblings should be ignored;
3.1 schema siblings apply together with the referenced schema.

Schema references are normalized before dereferencing: ignored siblings in 3.0,
an explicit `allOf` conjunction in 3.1. Regression coverage checks both versions
through the loader and CLI, as well as referenced Path Items and Responses.

### Medium — fixed: valid response extensions caused an error exit

A Responses Object containing `"x-note": null` reached `response.content`,
throwing instead of comparing a valid document. The comparator now iterates
only explicit response codes, uppercase range codes, and `default`.

### Medium — fixed: network filenames reached the filesystem before rejection

Initial filenames had no URI/UNC/device-path guard. On Windows, a UNC filename
could trigger OS network access through `realpath`, independently of disabled HTTP
resolvers. Entry names are now rejected before filesystem access; a regression
test substitutes `realpath` and verifies it is never called for these names.
Reference traversal outside the allowed directory is also rejected lexically
before canonical resolution, then checked again after following symlinks.

This does not guarantee zero OS network traffic: mounted network volumes and
symlink/junction targets can involve network filesystems. There is no OS sandbox.

### Medium — fixed: 3.1 nullable annotations generated false type findings

`nullable` is a 3.0 validation keyword. Previously, removing it in 3.1 changed
the reported type set. Comparison now uses each input's OpenAPI version and
ignores the annotation for 3.1. Explicit JSON Schema `null` types still compare.

### Medium — remaining: response guarantees and status coverage are incomplete

Removing optional and required properties is deliberately treated the same under
Milestone 1's declaration-removal rule. Removing a `required` entry while retaining
the property can weaken a response guarantee and still exit 0. Conversely,
removing an optional declaration is not proof that the server stops sending it;
the report is a conservative potential-break assessment.

Status codes match literally. A replacement `2XX` or `default` definition is not
used as a fallback for a removed explicit code, so equivalent coverage can look
like property removal. A removed bodyless response or property-free response can
exit 0. These behaviors are scope limits, not newly added change categories.
Regression tests explicitly record requiredness-only and property-free status
removal behavior, and check properties under 200, 404, 2XX, and default responses.

### Medium — remaining: arbitrary schemas exceed structural comparison

`oneOf`, `anyOf`, tuple `prefixItems`, conditionals, constraints, enums,
discriminators, and arbitrary boolean-schema satisfiability are not analyzed.
Root response type changes are not a response-property change. `allOf` handling
does not establish whether constraints across branches are satisfiable.
Removing a map is not independently classified, although named properties within
map values are compared. These gaps prevent interpreting exit 0 as proof of
backward compatibility.

### Low — remaining: conservative type and input rules produce false positives

All declared type changes are reported, including narrowing the possible response
values, which can be compatible for consumers. Inference from `properties` or
`items` can also overstate type constraints: these keywords alone do not require
an object/array instance in JSON Schema. Changes in such inferred types can report
a break without a formal incompatibility.

Recursive scanning treats literal `$ref`, `$id`, and `schema` data keys in examples
and extensions as schema syntax. Valid data may therefore be rejected. Resource
scopes, anchors, custom dialects, and YAML are intentionally unsupported. Validation
is OpenAPI structural/schema validation, not a proof of all semantic OAS rules.

### Low — remaining: local untrusted-input resilience has limits

Static traversal and symlink escapes are rejected. The existing Windows junction
regression passes. Filesystem checks are subject to concurrent changes between
resolution and reading. File count, byte size, depth, and comparison work have no
explicit budgets, so hostile local inputs can exhaust resources. Use stable,
trusted local files; this tool is not an isolation boundary.

## Network and exit-code verification

All references are rewritten to internal pointers before Swagger Parser receives
the document. External, HTTP, and file resolvers are disabled. Ajv uses bundled
meta-schemas; it has no asynchronous remote schema loader configured. HTTP, HTTPS,
socket, DNS, datagram, TLS, and fetch entry points are blocked in CLI integration
tests. Rejection tests additionally assert that the network-denial diagnostic did
not occur, so an attempted fetch cannot masquerade as a successful rejection.

Usage, malformed JSON, unsupported versions, invalid schemas, unresolved refs,
missing files, and unsafe references produce exit 2 with no stdout report.
Compatibility reports use stdout; errors use stderr. Terminal control characters
are escaped in reports and removed from error messages.

## Final verification

Environment: Windows, Node.js 24.19.0. The bundled npm CLI was invoked through Node
because npm is not on this shell's PATH.

- Full `npm test` equivalent: **40 passed, 0 failed, 0 skipped**.
- Separate `node --run build`: **passed**, no TypeScript diagnostics.
- End-to-end offline CLI smoke tests: identical fixtures **0**, breaking fixtures
  **1** with five findings, missing file **2** with stderr only.
- `npm pack --dry-run --json`: **passed**, 15 expected package entries; no package
  published. This verifies package contents, not installation on other systems.

## Changed files

- `src/compare.ts`: composed-schema projection, response-extension filtering,
  map traversal consistency, and version-aware nullable handling.
- `src/loader.ts`: schema-reference sibling normalization and early path guards.
- `test/audit.test.mjs`: 11 focused audit/regression tests.
- `test/integration.test.mjs`: rejects hidden network-attempt diagnostics.
- `README.md`: corrected rules and explicit compatibility/security limits.
- `AUDIT.md`: this report. Ignored compiled outputs were regenerated by the build.

## GitHub release readiness

**Suitable for a clearly scoped Milestone 1 candidate review; not ready to serve
as a comprehensive production compatibility gate.** Local compilation, tests,
smoke checks, and package-content checks pass. Remaining semantic and input-safety
limits must accompany any release description.

This workspace is not a Git repository, so no branch, diff, remote, clean working
tree, release tag, or GitHub configuration could be verified. No CI configuration
exists, and the advertised Node 22 minimum and Linux/macOS behavior were not tested
here. Initialize/review version control and run the intended platform/Node matrix
before declaring GitHub release readiness. Nothing was pushed, published, or
deployed.
