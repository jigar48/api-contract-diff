# Changelog

## Unreleased

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
