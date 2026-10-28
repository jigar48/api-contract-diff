# Changelog

## Unreleased

- Add `request-body-newly-required` with `path` and lowercase `method` when an
  existing operation's absent/optional request body becomes `required: true`.
  Omitted `required` is false. Reuse validated local references for OpenAPI 3.0/3.1
  and JSON/YAML; no request schema or content-type compatibility analysis.
- Retain JSON schemaVersion 1, exit codes, existing findings and suppression.
  Closed-enum consumers must add `request-body-newly-required` to their allowlist;
  version 1 consumers must tolerate additive kinds. Body findings follow query
  findings and precede response findings in each operation.
- Add synthetic mixed-format order body fixtures, an offline CLI demonstration,
  regression coverage, and a security/resource-limit review.

## 0.1.0-rc.2 (local candidate)

- Support local OpenAPI YAML 1.2 `.yaml`/`.yml` files, including mixed JSON/YAML
  comparisons and mixed-format local reference chains. Reuse the existing
  validation and comparison pipeline with all four finding categories and JSON
  output schema version 1 unchanged.
- Strictly reject invalid YAML, duplicate keys, multiple documents, non-string
  mapping keys, unsupported tags, anchors, aliases, merge keys, invalid UTF-8,
  non-finite numbers, and unsafe integers. Preserve local-reference containment
  checks and disabled remote resolvers.
- Limit each YAML file to 2 MiB and structural depth 64. Before AST composition
  and duplicate-key processing, enforce 1,024 items per collection and 10,000
  total collection items per file using the parser's syntax tree. Apply these
  budgets to referenced YAML as well, and reuse the syntax tree without reparsing.
  Ordinary JSON parsing retains its existing behavior.
- Add `compare old.json new.json --format json` with version 1 output containing
  `schemaVersion`, `count`, and the four existing finding categories. Human output
  remains the default; comparison behavior, local input validation, and exit codes
  are unchanged. Invalid CLI options are rejected with stderr usage diagnostics.
