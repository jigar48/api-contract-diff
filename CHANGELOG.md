# Changelog

## Unreleased

- Add `compare old.json new.json --format json` with version 1 output containing
  `schemaVersion`, `count`, and the four existing finding categories. Human output
  remains the default; comparison behavior, local input validation, and exit codes
  are unchanged. Invalid CLI options are rejected with stderr usage diagnostics.
