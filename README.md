# api-contract-diff

[![CI](https://github.com/jigar48/api-contract-diff/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jigar48/api-contract-diff/actions/workflows/ci.yml)
[MIT licensed](LICENSE) · TypeScript · Node.js 22+

**Spot API contract changes before they surprise an integration.**

`api-contract-diff` compares two local OpenAPI JSON specifications and reports
removed endpoints, removed response fields, and changed response property types.
Use it when reviewing an API update or checking a supplier's specification before
updating your integration. It prints a readable terminal report and returns an
exit code you can use in CI.

This is an early `0.1.0-rc.1` candidate, **not a comprehensive compatibility gate**.
Exit 0 means no supported changes were detected; it does not prove compatibility.
There is no published npm package assumed by these instructions.

## Try it in under two minutes

With Git, Node.js 22 or newer, and npm installed:

```sh
git clone https://github.com/jigar48/api-contract-diff.git
cd api-contract-diff
npm ci
npm run build
node dist/cli.js compare examples/orders-before.json examples/orders-after.json
```

Setup time depends on your connection and machine. The demo intentionally exits
**1** because it detects five changes:

```text
5 breaking change(s) detected:
- Removed path: /legacy-orders
- Removed response property: GET /orders/{orderId} → 200 (application/json) /customer/email
- Changed response property type: GET /orders/{orderId} → 200 (application/json) /items/*/quantity: integer → string
- Changed response property type: GET /orders/{orderId} → 200 (application/json) /total: number → string
- Removed operation: DELETE /orders/{orderId}
```

To compare your own specifications:

```sh
node dist/cli.js compare old.json new.json
```

## A realistic before/after example

An ecommerce integration reads order totals, customer details, and line items.
The updated API removes `customer.email`, returns `total` and item `quantity` as
strings, and removes two older endpoint definitions.

Illustrative `GET /orders/{orderId}` response **before**:

```json
{
  "orderId": "ORD-1042",
  "total": 59.98,
  "customer": { "name": "Alex", "email": "alex@example.com" },
  "items": [{ "sku": "TSHIRT-BLUE-M", "quantity": 2 }]
}
```

**After**:

```json
{
  "orderId": "ORD-1042",
  "total": "59.98",
  "customer": { "name": "Alex" },
  "items": [{ "sku": "TSHIRT-BLUE-M", "quantity": "2" }]
}
```

The CLI compares the **OpenAPI specifications**, not these example payloads.
The complete runnable files are [orders-before.json](examples/orders-before.json)
and [orders-after.json](examples/orders-after.json). This is a synthetic example;
it contains no customer data. `/*` in the report means an array item.

## What it detects

| Category | Example |
| --- | --- |
| Removed API paths | `/legacy-orders` disappears |
| Removed HTTP operations | `DELETE /orders/{orderId}` disappears |
| Removed response properties | `customer.email` disappears |
| Changed response property types | `total` changes from `number` to `string` |

Detection covers nested objects, array items, and named properties inside map
values. It combines structural declarations through `allOf` and resolves local
references, including recursive schemas. Responses are compared separately for
each existing status code and media type.

Both optional and required property removals are reported. Every declared type
change is treated conservatively as breaking. Removed parent paths, operations,
or properties suppress redundant descendant-removal reports.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No supported breaking changes detected |
| `1` | One or more supported breaking changes detected |
| `2` | Invalid arguments, invalid specification, file error, or rejected reference |

Reports go to stdout; errors go to stderr. Both documents are validated before
comparison. Identical specifications print `No breaking changes detected.`

```sh
node dist/cli.js compare examples/orders-before.json examples/orders-before.json
```

That command exits 0. A nonexistent input file exits 2.

## Install the CLI command locally

From the source checkout, after installing dependencies and building:

```sh
npm link
api-contract-diff compare old.json new.json
```

You can also create and install a local tarball; this does not publish anything:

```sh
npm pack
npm install --global ./api-contract-diff-0.1.0-rc.1.tgz
api-contract-diff compare old.json new.json
```

`npm pack` builds first. The installed CLI needs no TypeScript compiler. Demo files
belong to the source checkout and are not included in the tarball. Installing
dependencies requires registry access; comparison never fetches HTTP resources.

## Known limitations

- **Structural checks only.** No `oneOf`/`anyOf`, tuple `prefixItems`, discriminator,
  constraint, enum, format, requiredness-only, or general schema-satisfiability
  analysis. `allOf` supports the structural keywords described above, not every
  possible JSON Schema intersection.
- **Responses only.** Requests, parameters, headers, callbacks, and webhooks are
  not compared. Root response type changes and map removal have no separate
  finding category.
- **Literal status matching.** Equivalence between an explicit code, a range such
  as `2XX`, and `default` is not calculated. Removing a bodyless response or a
  response without named properties can produce no finding.
- **Conservative findings.** Optional field removal and compatible type changes
  can be reported. Inferring object/array types from `properties`/`items` is a
  reporting heuristic, not a complete interpretation of JSON Schema semantics.
- **JSON only.** Supports the pinned validator's OpenAPI versions 3.0.0–3.0.4 and
  3.1.0–3.1.2. YAML, `$id` resource scopes, anchors, dynamic references, and custom
  dialects are unsupported. Literal schema-like keys in examples or extensions
  can be interpreted as schema syntax and rejected.
- **Trusted local inputs.** No file-size, file-count, depth, or work limits.
  Filesystem races and mounted network filesystems are outside the tool's
  protection. This is not a filesystem sandbox.

Use the report alongside API review and integration tests, not as your only
release check.

<details>
<summary>Validation, references, and type handling</summary>

OpenAPI structure is validated with Swagger Parser. OpenAPI 3.1 schemas also
undergo JSON Schema 2020-12 meta-schema validation with Ajv. All validation schemas
are bundled dependencies; external resolvers are disabled.

References may use internal JSON Pointers or relative JSON files, for example
`./schemas/order.json#/Order`. Each reference resolves relative to its containing
file. All referenced files must stay inside the entry specification's directory,
including after canonical path and symlink resolution. All `$ref` values are
checked, including unused components.

Remote references, absolute reference paths, UNC/device paths, query strings,
backslashes, and non-pointer fragments are rejected. Entry filenames also reject
URI schemes and UNC/device paths. Filesystem access remains subject to the OS.
The `x-contract-documents` extension is reserved for internal bundling.

Schema `$ref` siblings are ignored in 3.0 and applied conjunctively in 3.1. Type
arrays are order independent. `nullable` affects types only in 3.0; use explicit
JSON Schema `null` types in 3.1. Property locations use JSON Pointer escaping;
`*` denotes array items and `{key}` denotes map values. Output is deterministic,
and terminal control characters from specification text are escaped.

</details>

## Development and verification

```sh
npm ci
npm run build
npm test
npm run check:release
npm run check:package
```

[The initial GitHub-hosted CI run](https://github.com/jigar48/api-contract-diff/actions/runs/38910933245)
passed on Node.js 22 and 24 across Ubuntu, Windows, and macOS: **40 tests and five
installed-package smoke checks per job**, with no failures or skipped tests.
The badge above shows the current `main` workflow status.

Package checks install a tarball into a clean temporary consumer, enforce an exact
file allowlist, and exercise the installed bin with network APIs blocked. Release
checks validate metadata and scan for common credentials/local paths; scanning is
heuristic, not a security guarantee. Tests require no API credentials. The symlink
test may skip on systems without the necessary creation privilege.

The source is separated into [loading/validation](src/loader.ts),
[comparison](src/compare.ts), [reporting](src/report.ts), and
[CLI orchestration](src/cli.ts). [Tests](test/) cover unit, integration, and audit
regressions.

## About the maintainer · Work with me

Created and maintained by **Jigar Prajapati**, a software engineer specializing in
API integrations, ecommerce systems, cloud infrastructure, and automation.

Available for custom software development, API integrations, ecommerce solutions,
and AI automation consulting.

[Connect on LinkedIn](https://www.linkedin.com/in/buildaiwith-jigar-prajapati/) ·
[Email Jigar](mailto:jigar.prajapati48@gmail.com) ·
[GitHub profile](https://github.com/jigar48)

## License and security

[MIT license](LICENSE). For responsible disclosure, read [SECURITY.md](SECURITY.md).
Do not post vulnerability details or credentials in public issues.
