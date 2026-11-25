# MCP Firestore Server

A Model Context Protocol (MCP) server that provides Firestore database operations with dual-endpoint support (emulator + production).

## Installation

```bash
npx @nerd305/mcp-firestore-server
```

## Configuration

| Environment Variable                           | Purpose                                                                                                                                                                                            | Required?                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GOOGLE_CLOUD_PROJECT` / `FIREBASE_PROJECT_ID` | Project ID                                                                                                                                                                                         | Yes (or auto-detected from gcloud / .firebaserc) |
| `FIRESTORE_EMULATOR_HOST`                      | Emulator address (e.g. `127.0.0.1:8080`)                                                                                                                                                           | No (enables emulator target)                     |
| `GOOGLE_APPLICATION_CREDENTIALS`               | Service account key path                                                                                                                                                                           | No (enables production target)                   |
| `MCP_FIRESTORE_DEFAULT_TARGET`                 | Default target: `"emulator"` or `"production"`. The server refuses to start if the value is misspelled or names a target that is not configured                                                    | No (auto-resolved)                               |
| `MCP_FIRESTORE_READONLY`                       | `1`/`true`/`all`: hide and reject write tools. `production`: reject writes to production only. `0`/`false`/`off`/`no` or unset: writes enabled. Any other value is treated as `all` (fails closed) | No                                               |
| `MCP_FIRESTORE_MAX_RESPONSE_CHARS`             | Default response budget for document payloads (default `60000`)                                                                                                                                    | No                                               |
| `MCP_FIRESTORE_DEBUG`                          | Include stack traces and unredacted error text in responses and logs. Never set it in a shared or production setup                                                                                 | No (off by default)                              |

At least one of `FIRESTORE_EMULATOR_HOST` or `GOOGLE_APPLICATION_CREDENTIALS` must be set. When both are configured, the server connects to both endpoints simultaneously and defaults to the emulator.

### Production write safety

Reads run freely against any target. **Writes against the `production` target (`create_document`, `update_document`, `delete_document`) require `confirm: true`** — without it, the tool returns an error and makes no change. Writes against the emulator never need confirmation. This prevents an assistant from mutating live data without a deliberate opt-in.

### Security model

The server runs with the Firebase Admin SDK, so it **bypasses Firestore security rules**. What it can read or change in production is decided by the IAM roles of the credentials you give it, and by nothing else.

- **`confirm: true` is a guard against accidents, not a security boundary.** The assistant sets it itself. An assistant that follows instructions hidden in a web page or in a Firestore document can set it too.
- **Document data is untrusted input.** Anything stored in Firestore, including user-generated content, is returned to the assistant as-is. Treat it as data, never as instructions.
- **Use least-privilege credentials for production.** Point `GOOGLE_APPLICATION_CREDENTIALS` at a dedicated service account with `roles/datastore.viewer` when you only need to read, or `roles/datastore.user` when you need to write. Do not use an Owner or Editor account.
- **Set `MCP_FIRESTORE_READONLY=production`** unless you need production writes in that session. The server then rejects them regardless of what the assistant sends.
- **Keep your MCP client's permission prompts on for the write tools.** They are annotated (`destructiveHint`) so clients can ask you before each call. That prompt is the only confirmation a person actually sees.
- **Pin the version** in your MCP config (`@nerd305/mcp-firestore-server@x.y.z`) instead of running the latest release unreviewed.
- **Check which project you are on.** The project ID is shown in every tool's `target` description and logged at startup. When no project environment variable is set, it can come from a `.firebaserc` in the working directory, so set `GOOGLE_CLOUD_PROJECT` explicitly when you work in a repository you did not write.
- Every production write is logged to stderr with the tool, collection and document ID (never the data), so you can audit what was changed.

## Usage with Claude Desktop

Add to your `.mcp.json` configuration:

### Emulator only

```json
{
  "mcpServers": {
    "firestore": {
      "command": "npx",
      "args": ["-y", "@nerd305/mcp-firestore-server"],
      "env": {
        "GOOGLE_CLOUD_PROJECT": "your-project-id",
        "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"
      }
    }
  }
}
```

### Production only

```json
{
  "mcpServers": {
    "firestore": {
      "command": "npx",
      "args": ["-y", "@nerd305/mcp-firestore-server"],
      "env": {
        "GOOGLE_CLOUD_PROJECT": "your-project-id",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json"
      }
    }
  }
}
```

### Dual-endpoint (emulator + production)

```json
{
  "mcpServers": {
    "firestore": {
      "command": "npx",
      "args": ["-y", "@nerd305/mcp-firestore-server"],
      "env": {
        "GOOGLE_CLOUD_PROJECT": "your-project-id",
        "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json"
      }
    }
  }
}
```

When both are configured, use the `target` parameter on any tool to choose which endpoint to query. The default target is the emulator (override with `MCP_FIRESTORE_DEFAULT_TARGET`).

## Available Tools

All tools support an optional `target` parameter (`"emulator"` | `"production"`) and include the resolved `target` in every response. Collection paths support subcollections (e.g. `"users/uid/posts"`).

### query_collection

Query documents from a Firestore collection with pagination support.

```typescript
{
  collection: string;       // Collection path
  limit?: number;           // Default: 10
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  startAfter?: string;      // Document ID for pagination (use lastDocId from previous response)
  target?: "emulator" | "production";
}
```

### get_document

Get a specific document by ID.

```typescript
{
  collection: string;
  docId: string;
  target?: "emulator" | "production";
}
```

### query_with_where

Query documents with where conditions. Supports multiple clauses and automatic value type coercion (numbers, booleans, arrays are auto-detected from strings). JSON-encoded [Timestamp values](#typed-values-timestamps-and-field-sentinels) are decoded too.

```typescript
{
  collection: string;
  // Multi-clause format (preferred)
  where?: [field: string, operator: string, value: string][];
  // Legacy single-clause format
  field?: string;
  operator?: "==" | "!=" | "<" | "<=" | ">" | ">=" | "array-contains" | "in" | "array-contains-any";
  value?: string;
  limit?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  startAfter?: string;
  target?: "emulator" | "production";
}
```

**Examples:**

```json
{ "collection": "users", "where": [["age", ">", "18"], ["status", "==", "active"]] }
{ "collection": "users", "field": "email", "operator": "==", "value": "user@example.com" }
```

### list_collections

List top-level collections or subcollections of a specific document.

```typescript
{
  documentPath?: string;    // e.g. "users/uid" to list subcollections
  target?: "emulator" | "production";
}
```

### count_documents

Count documents using Firestore's native aggregation (no document fetching). Supports optional where conditions.

```typescript
{
  collection: string;
  where?: [field: string, operator: string, value: string][];
  target?: "emulator" | "production";
}
```

### batch_get

Fetch multiple documents by ID in a single request.

```typescript
{
  collection: string;
  docIds: string[];
  target?: "emulator" | "production";
}
```

### create_document

Create a new document. `data` supports [typed values](#typed-values-timestamps-and-field-sentinels) except `$delete`. With a `docId`, the call fails with `ALREADY_EXISTS` if that document exists: use `update_document` to change it, or pass `overwrite: true` to replace it entirely.

```typescript
{
  collection: string;
  docId?: string;           // Auto-generated if not provided
  overwrite?: boolean;      // With docId: replace an existing document (default false)
  data: object;
  confirm?: boolean;        // Required true to write to production
  target?: "emulator" | "production";
}
```

### update_document

Update an existing document. `data` supports [typed values](#typed-values-timestamps-and-field-sentinels), including `{"$delete": true}` to remove a field.

```typescript
{
  collection: string;
  docId: string;
  data: object;
  merge?: boolean;          // Default: true
  confirm?: boolean;        // Required true to write to production
  target?: "emulator" | "production";
}
```

### delete_document

Delete a document.

```typescript
{
  collection: string;
  docId: string;
  confirm?: boolean;        // Required true to delete from production
  target?: "emulator" | "production";
}
```

## Large results: projection, compaction, budget

Read tools (`query_collection`, `query_with_where`, `get_document`, `batch_get`) accept:

- `fields`: field paths to return (dotted paths allowed). Queries use Firestore `select()`.
- `raw`: `true` disables compaction. By default, numeric arrays longer than 64 items (for example embedding vectors) collapse to a placeholder, and strings longer than 4000 characters are truncated. Every compacted path is listed in `compacted`.
- `maxChars`: response budget for this call (1000–500000). Queries drop trailing documents to fit and set `truncated: true`; continue with `startAfter: <lastDocId>`. Single documents list dropped fields in `omittedFields`, and `batch_get` lists dropped IDs in `omittedIds`.

## Errors and recovery

Errors keep the `error` message and add a `code` and `hint` where the cause is known:

- `AUTH_EXPIRED`: Application Default Credentials expired. Run `gcloud auth application-default login`. The server re-creates the client and retries once, so no restart is needed.
- `FAILED_PRECONDITION_INDEX`: the query needs a composite index; `indexUrl` links to create it.
- Unknown arguments are rejected with a suggestion, for example `documentId` → `docId`.
- Document IDs (`docId`, `docIds`, `startAfter`) are single path segments: no `/`. Put the parent path in `collection`, for example `collection: "users/u1/posts"`, `docId: "p1"`.

Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so clients can tell reads from writes.

## Typed values (Timestamps and field sentinels)

Tool input is plain JSON, so Firestore-native types use an encoding. `create_document` and `update_document` decode these forms anywhere in `data`, including nested maps and arrays:

| JSON form                                     | Stored as                      | Notes                                                                                                           |
| --------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `{"_seconds": 1791681420, "_nanoseconds": 0}` | `Timestamp`                    | The same shape reads return, so read → write round-trips.                                                       |
| `{"$timestamp": "2026-10-11T01:17:00Z"}`      | `Timestamp`                    | ISO-8601 with an explicit timezone (`Z` or `±hh:mm`), or a bare date (UTC midnight). Up to 9 fractional digits. |
| `{"$serverTimestamp": true}`                  | `FieldValue.serverTimestamp()` | Not allowed inside arrays.                                                                                      |
| `{"$increment": 1}`                           | `FieldValue.increment(n)`      | Any finite number. Not allowed inside arrays.                                                                   |
| `{"$delete": true}`                           | `FieldValue.delete()`          | `update_document` only. Nested maps require `merge: true` (the default). Rejected by `create_document`.         |

Bare ISO strings are **not** converted, so ordinary string fields are never retyped. A tagged object must contain only its tag key; malformed values fail with an error that names the field path.

```json
{
  "collection": "image_advisories",
  "docId": "abc123",
  "data": {
    "resolvedAt": { "$timestamp": "2026-10-11T01:17:00Z" },
    "updatedAt": { "$serverTimestamp": true },
    "tempNote": { "$delete": true }
  }
}
```

Where-clause values in `query_with_where` and `count_documents` accept the two Timestamp forms as JSON-encoded strings, so you can filter on timestamps (write sentinels are rejected in queries):

```json
{
  "collection": "image_advisories",
  "where": [["resolvedAt", ">=", "{\"$timestamp\": \"2026-10-01T00:00:00Z\"}"]]
}
```

## Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Run locally: `npm start`

## Testing with npm link

```bash
cd mcp-firestore-server
npm link
# In your project
npm link @nerd305/mcp-firestore-server
```

## License

MIT
