# api-contract-diff

A TypeScript CLI for comparing two local OpenAPI 3.0 or 3.1 JSON specifications.
Milestone 1 detects removed paths, removed HTTP operations, removed response
properties, and changes to response property types. It makes no network requests.

**This is not a comprehensive compatibility gate.** Exit 0 means that none of
the supported changes were found, not that the API is backward compatible.
The first public candidate is `0.1.0-rc.1`; there is no published npm release
assumed by these instructions.

## Installation and usage

Requires Node.js 22 or newer and npm.

From a source checkout:

```sh
npm ci
npm run build
npm link
api-contract-diff compare old.json new.json
```

To produce and install the candidate tarball locally:

```sh
npm pack
npm install --global ./api-contract-diff-0.1.0-rc.1.tgz
api-contract-diff compare old.json new.json
```

`npm pack` builds the CLI first. Installing from a tarball needs no TypeScript
compiler or source checkout. Installation may download npm dependencies; the
comparison command itself uses local files and does not fetch network resources.

You can also run the compiled CLI directly without linking:

```sh
node dist/cli.js compare test/fixtures/old.json test/fixtures/new.json
node dist/cli.js compare test/fixtures/old.json test/fixtures/old.json
```

These fixture commands are for the source checkout. The first exits 1 and the
second exits 0. A missing file, invalid JSON, or rejected reference exits 2.

Example output (exit code 1):

```text
5 breaking change(s) detected:
- Changed response property type: GET /pets → 200 (application/json) /age: integer → string
- Removed response property: GET /pets → 200 (application/json) /name
- Removed response property: GET /pets → 200 (application/json) /tags/*/label
- Removed operation: DELETE /pets
- Removed path: /retired
```

Identical or additive contracts print `No breaking changes detected.`

| Exit | Meaning |
| --- | --- |
| 0 | No detected breaking changes |
| 1 | At least one detected breaking change |
| 2 | Invalid command, unreadable file, malformed JSON, invalid OpenAPI, or reference error |

Reports go to stdout; usage and errors go to stderr. Both inputs are loaded and
validated before any comparison report is printed. Paths and properties are
sorted for deterministic output. Untrusted terminal control characters are escaped.

## Supported detection categories

1. Removed API paths.
2. Removed HTTP operations.
3. Removed response properties.
4. Changed response property types.

## Comparison rules

- Compares GET, PUT, POST, DELETE, OPTIONS, HEAD, PATCH, and TRACE.
- Compares each existing response status and media type independently.
- Traverses named properties, nested objects, array items, and schema-valued maps.
- Collects properties declared through `allOf`.
- Intersects types and combines nested declarations across `allOf`, including
  array items and map values. Schema `$ref` siblings are ignored in 3.0 and
  applied conjunctively in 3.1.
- Reports removed parent properties once, without listing their descendants.
- A removed path suppresses individual operation/property reports for that path;
  a removed operation likewise suppresses its property reports.
- Treats every change in declared type as breaking, including widening. Type arrays
  are order independent, and OpenAPI 3.0 `nullable` contributes the `null` type.
- Reports removal of both optional and required properties. Changes to the
  `required` list alone are not detected; this is a conservative declaration diff.
- Infers object/array types from `properties`/`items` when `type` is omitted.
- Missing responses or media types report their removed named properties, but
  response/media-type removal itself is outside the four change categories.
- Property locations use JSON Pointer escaping; `*` denotes array items and
  `{key}` denotes map values.

## Validation and local references

OpenAPI structure is validated using Swagger Parser; OpenAPI 3.1 schema objects
also undergo JSON Schema 2020-12 meta-schema validation with Ajv.
Dependencies ship their validation schemas locally; validation never downloads them.
Supported version strings are those accepted by the pinned parser: 3.0.0–3.0.4
and 3.1.0–3.1.2.

References may be internal JSON Pointers or relative JSON files such as
`./schemas/pet.json#/Pet`. Each file's relative references resolve against that
file's directory. Recursive references are supported. URI-encoded pointer names
and JSON Pointer escapes (`~0`, `~1`) are supported.

Every referenced file must resolve inside the entry specification's directory,
including after following symlinks. Parent traversal outside that directory,
absolute paths, UNC paths, URL schemes (including HTTP and `file:`), query
strings, backslashes, and non-pointer fragments are rejected. All `$ref` values
are checked, including unused components. External resolvers are disabled before
the bundled in-memory document reaches the validator.
Entry filenames also reject URI schemes and UNC/device paths before filesystem
access. Filesystem operations on mounted network volumes or symlinks to remote
targets remain subject to the operating system; this is not a filesystem sandbox.

## Architecture and tests

- `src/loader.ts`: JSON loading, safe reference graph bundling, and validation.
- `src/compare.ts`: pure contract comparison returning structured changes.
- `src/report.ts`: readable terminal formatting.
- `src/cli.ts`: argument handling, orchestration, and exit codes.
- `test/fixtures/`: sample 3.0 documents and a recursive external 3.1 schema.
- `test/unit.test.mjs` and `test/integration.test.mjs`: comparison and CLI tests.
- `test/audit.test.mjs`: compatibility and security regression cases.

```sh
npm test
npm run check:release
npm run check:package
```

This compiles TypeScript and runs Node's built-in test runner. Tests use local
fixtures and temporary files only. The symlink test skips when Windows does not
grant symlink creation privileges.

The release check validates metadata, the license, ignore rules, and scans Git
candidate files for common credentials and local paths. It is a heuristic check
that supplements manual review. The package check creates a tarball, enforces an
exact file allowlist, installs it in a temporary clean consumer, and runs the
installed CLI's bin shim with network APIs blocked. It checks compatible, breaking,
invalid-JSON, remote-reference, and usage cases. Dependency installation requires
registry access; CLI smoke tests run offline. Temporary package files are removed.

GitHub Actions defines all six combinations of Node.js 22/24 and
`ubuntu-latest`/`windows-latest`/`macos-latest`. Every job runs `npm ci`, build,
tests, release checks, and package checks with read-only repository permissions.
The workflow never publishes or deploys. Defining the matrix does not establish
that remote CI has passed; check its actual results before announcing a candidate.

## Known limitations

This is a structural comparison, not a complete compatibility proof. It does not
analyze `oneOf`/`anyOf` alternatives, discriminators, constraints, formats, enums,
requiredness, request bodies, parameters, headers, callbacks, or webhooks. `allOf`
comparison handles the listed structural keywords, not arbitrary JSON Schema
intersections or satisfiability. Root response schema type changes are outside the
property-type category. Map removal is not itself reported.
Status codes are matched literally; equivalence between explicit codes, wildcard
ranges, and `default` is not calculated. Removing a bodyless response or operation
response with no named properties may produce no finding. In OpenAPI 3.1, a
`properties` or `items` keyword alone does not constrain the instance type; inferred
types here are a reporting heuristic. `nullable` affects comparison only for
OpenAPI 3.0 inputs; 3.1 null types must use JSON Schema type declarations.

JSON only; YAML is unsupported. JSON Schema resource scopes (`$id`), anchors,
dynamic references, and custom dialects are rejected. The extension
`x-contract-documents` is reserved for bundling. Reference/keyword checks are
conservative and also inspect example and extension objects: literal `$ref`,
`$id`, or `schema` data keys there can be treated as schema syntax. Inputs should
be trusted local files that remain unchanged while the command runs; filesystem
checks do not provide isolation against concurrent filesystem changes. No explicit
file-size/depth limits are imposed.

Licensed under the [MIT license](LICENSE).
For responsible disclosure, see [SECURITY.md](SECURITY.md).
