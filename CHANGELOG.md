# Changelog

## 3.1.0 — 2026-10-10

### Added

- Typed value decoding on every write path (`create_document`, `update_document`), recursively through nested maps and arrays:
  - Timestamps: `{"_seconds": n, "_nanoseconds": n}` (the shape reads return, so values round-trip) and `{"$timestamp": "<ISO-8601>"}`.
  - Sentinels: `{"$serverTimestamp": true}`, `{"$increment": n}`, and `{"$delete": true}` (update/merge only; rejected by `create_document`, and nested `$delete` requires `merge: true`).
- Where-clause values in `query_with_where` and `count_documents` decode JSON-encoded Timestamp forms, so queries can filter on timestamps. Write sentinels are rejected in queries.
- Tool descriptions and schemas document the new forms.

### Unchanged

- Bare ISO-8601 strings are still stored as strings.
- Production write safety (`confirm: true`) and input validation run before decoding.

## 3.0.1

- Fix JSON Schema Draft 2020-12 compliance (`prefixItems` for where-clause tuples) and add the `validate:schemas` publish gate.
