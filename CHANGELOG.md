# Changelog

## 3.2.1 — 2026-10-11

### Security

- Error redaction now also covers `~/` and relative paths, paths after a backtick or comma, UNC paths, single-segment file paths such as `/k.json`, email addresses, Google OAuth refresh tokens and Google API keys.
- Expired-credential errors (`AUTH_EXPIRED`) return a static message instead of the raw one; the `hint` still tells you what to do.
- Our own input-validation messages (for example `Invalid collection path "/users/abc"`) keep the path you typed so they stay actionable. Secrets in them are still redacted.
- **Behaviour change:** stack traces and unredacted errors are enabled by `MCP_FIRESTORE_DEBUG` only. The generic `DEBUG` variable no longer has any effect.
- A `__proto__` field name in document data or query values is rejected with a clear error instead of silently dropping the field.
- Error messages longer than 4096 characters are truncated before redaction (bounds regex cost on huge echoed input).
- Validation errors are never classified as `AUTH_EXPIRED`; emails no longer match version strings like `pkg@1.2.3`; UNC detection no longer fires on escaped backslashes.
- Tool failures are logged to stderr as a redacted message only (full error and stack with `MCP_FIRESTORE_DEBUG`).

## 3.2.0 — 2026-10-10

Driven by a review of 1,188 real Claude Code tool calls, about 20% of which failed.

### Added

- Output control on read tools: `fields` projection (Firestore `select()` for queries), default compaction of long numeric arrays and long strings (`raw: true` opts out, `compacted` lists affected paths), and a response budget (`maxChars`, env `MCP_FIRESTORE_MAX_RESPONSE_CHARS`, default 60000) that truncates with `truncated: true` and a correct `lastDocId` for pagination.
- `not-in` where operator.
- `{"$string": "..."}` typed value to force a string in where clauses and writes (plain `"33101"` is still coerced to a number).
- Structured errors: `code` + `hint` for expired credentials (`AUTH_EXPIRED`), missing indexes (`FAILED_PRECONDITION_INDEX` with `indexUrl`), and descending key scans.
- Automatic credential recovery: on an auth error the target's client is re-created and the call retried once, so `gcloud auth application-default login` works without restarting the server.
- Unknown-argument check with suggestions (for example `documentId` → `docId`).
- MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `title`).
- Read-only mode: `MCP_FIRESTORE_READONLY=1` hides write tools; `=production` rejects production writes only.

### Changed

- Read responses compact large values by default and set `partial: true`. Pass `raw: true` for the previous output.
- `limit` on query tools is now an integer from 1 to 1000 (previously unbounded). Page with `startAfter`.

### Security

- `fields` paths cannot reach `__proto__`, `constructor`, or `prototype`, and projection never writes through the prototype chain (prevented a prototype-pollution bypass of the production `confirm` gate). `confirm`, `merge`, and `target` are read as own properties only.
- Error messages redact absolute paths, service-account emails, OAuth/Bearer tokens, and private keys unless `MCP_FIRESTORE_DEBUG` is set.
- Auth-error detection uses structured signals only; unknown-argument echoes are length- and count-bounded.

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
