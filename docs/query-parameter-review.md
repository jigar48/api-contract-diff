# Newly required query parameters: implementation and security review

The new `query-parameter-newly-required` finding covers new required query
parameters and optional queries becoming required, only on existing operations.
Effective parameters use path declarations followed by operation overrides with
the same case-sensitive name and location. A query-only `Map` safely represents
names such as `__proto__` and avoids duplicate findings for inherited identities.
Names are sorted, and query findings precede response findings within each
operation. Existing response and removal rules remain unchanged.

JSON schemaVersion 1 is retained as an additive finding extension. The envelope
and existing finding shapes are unchanged. Closed-enum consumers need an update;
consumers must tolerate new kinds and fields. See the README for the exact fields.

Security review:

- Reference loading is unchanged. Canonical containment checks, own-property JSON
  Pointer lookup, and disabled external resolvers apply to parameter references.
  New tests reject remote, traversal, and inherited-property parameter references
  while the existing security regressions exercise symlink containment and schemes.
- No new filesystem or network APIs, telemetry, schema fetching, or dependencies
  were added. Offline CLI tests deny network APIs, including installed-package tests.
- Query comparison visits parameter arrays and sorts distinct query names; it does
  not traverse parameter schemas. Recursive parameter schemas use the loader's
  existing circular-reference support and are exercised in JSON/YAML on both
  OpenAPI versions. This adds no recursive comparison traversal.
- Parameter names use Map keys rather than object assignments. Terminal names are
  quoted with JSON escaping and pass through the existing terminal-control escape
  function. JSON retains original strings with standard JSON escaping.
- Reports add only the query name, API path, and method. They do not include
  parameter defaults, examples, descriptions, filenames, or full schemas. Finding
  values remain untrusted and may themselves contain sensitive user-provided text.
- Dependency audit initially identified advisories in transitive `fast-uri` 3.1.8.
  The lockfile updates it to patched 3.1.9 within the existing dependency range;
  the subsequent audit reports zero vulnerabilities. No direct dependency changes.

No blocking security issue was identified in this change. Existing documented
risks remain: unrestricted JSON size/depth, no aggregate reference/work budget,
filesystem races, and mounted network filesystems. Use stable, trusted local
inputs. This remains a partial compatibility checker, not a guarantee that clients
will continue working. Query schema, serialization, request-body, header, and
cookie compatibility remain outside this feature.
