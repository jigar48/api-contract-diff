# Newly required request bodies: implementation and security review

The comparator reads only `requestBody.required === true` for HTTP operations
present in both validated, dereferenced graphs. An absent body or omitted flag is
optional. New operations are ignored; removed parents retain existing suppression.
The rule adds constant work per existing operation and never traverses request
schemas or content types. Query and response rules retain their relative order.

JSON output schemaVersion 1 adds `request-body-newly-required`, containing only
`kind`, `path`, and lowercase `method`. Closed-enum consumers must add the kind;
consumers must tolerate additive kinds and fields. The README documents the full
output contract and a reproducible synthetic order API demonstration.

Security boundaries are unchanged: all references, including requestBody references,
pass through canonical directory and symlink containment, own-property JSON Pointer
lookup, and disabled external resolvers. No dependencies, network APIs, telemetry,
dynamic execution, or file access were added. Reports disclose only the API path
and method; the existing terminal escaping and JSON escaping apply. Finding strings
remain untrusted data. Tests block network APIs for CLI comparisons and exercise
internal/relative mixed-format references, malformed pointers, prohibited remote
references and traversal. Existing regressions cover symlink and resource limits.

Remaining limitations: JSON parsing has no size/depth budget. YAML retains its
2 MiB, depth 64, 1,024 items per collection and 10,000 total collection items per
file budgets; there is no aggregate reference-count, byte, or comparison-work
budget. Filesystem races and mounted network filesystems remain outside protection.
Use stable, trusted local inputs. The pinned parser/validator's supported versions
and reference/dialect restrictions remain as documented in the README. This is
partial compatibility checking; body schemas, media types, and comprehensive API
compatibility are not analyzed.
