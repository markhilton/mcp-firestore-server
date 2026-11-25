# Changelog

## 3.3.0 — 2026-11-24

Security review of the whole package, plus dependency updates. No tool was removed. Four defaults changed to fail safe; each keeps the old capability reachable.

### Security

- **Behaviour change:** an unrecognised `MCP_FIRESTORE_READONLY` value (for example `yes` or `prod`) now enables full read-only mode and logs a warning. Before, it silently left writes enabled. `0`, `false`, `off`, `no` and unset still mean writes are enabled.
- **Behaviour change:** the server refuses to start when `MCP_FIRESTORE_DEFAULT_TARGET` is misspelled or names a target that is not configured. Before, asking for `emulator` without an emulator silently made **production** the default.
- **Behaviour change:** `create_document` with a `docId` fails with `ALREADY_EXISTS` when that document exists. Before, it silently replaced the whole document. Pass the new `overwrite: true` to keep the old behaviour. The tool is now annotated `destructiveHint: true`, and the error hint tells the assistant to ask you before it overwrites.
- **Behaviour change:** `docId`, `docIds` and `startAfter` must be single path segments (no `/`, not `.`/`..`, not `__name__`, at most 1500 bytes), and `list_collections` validates `documentPath`. Reach nested documents through `collection` (`users/u1/posts`).
- Collection and document paths longer than 6144 bytes (Firestore's own limit) are rejected before they reach the SDK, and the error does not echo them.
- Tool names are resolved from own entries only. Names such as `constructor` or `toString` are rejected as unknown tools instead of reaching an inherited function.
- Every successful write to the production target is logged to stderr with the tool, collection and full document ID as quoted fields (never the data). A replace through `overwrite: true` is marked `overwrite=true`.
- The server sends MCP `instructions` telling the client that document data is untrusted and that production writes need an explicit request from the user. The production-write refusal now says to ask the user before retrying with `confirm: true`.
- The project ID is validated at startup (letters, digits, `.`, `_`, `:`, `-`, at most 63 characters) and shown, quoted and with its source, in each tool's `target` description and in the startup log. A `.firebaserc` in the working directory can still choose the project when no project variable is set, but the choice is now visible and the file can no longer inject text. Project detection no longer logs a value before it is validated. Set `GOOGLE_CLOUD_PROJECT` explicitly when you work in a repository you did not write.
- Startup, transport and fatal-error log lines are redacted like tool errors (full text with `MCP_FIRESTORE_DEBUG` only). Log lines built from an error have control characters removed and are capped at 1000 characters, so caller input cannot forge log lines.
- The npm tarball is built from a `files` allowlist (`index.js`, `src/`). A test fails if anything else, or anything shaped like a credential, would be published.
- CI runs with a read-only token, does not persist checkout credentials, and pins its actions to commit SHAs.
- README documents the security model: `confirm: true` is a guard against accidents, not a security boundary; use least-privilege credentials and `MCP_FIRESTORE_READONLY=production`.

### Added

- `create_document`: `overwrite` argument (requires `docId`). Error code `ALREADY_EXISTS` with a hint.

### Changed

- `@modelcontextprotocol/sdk` 1.17 → 1.32, `firebase-admin` 14.0 → 14.5 (`@google-cloud/firestore` 9.4), `eslint` 10.15, `prettier` 3.10. `npm audit` reports 0 advisories (was 11).
- A test asserts that the emulator client is bound to the emulator host and the production client is not, so a dependency update cannot silently break target isolation.

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
