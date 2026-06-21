# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that exposes Firestore database operations as MCP tools. Supports dual-endpoint connections (emulator + production Firestore simultaneously). Published as `@nerd305/mcp-firestore-server` on npm.

## Commands

- **Run**: `npm start` or `node index.js`
- **Install**: `npm install`
- **Test locally with link**: `npm link` then `npm link @nerd305/mcp-firestore-server` in consumer project
- **Publish**: `npm publish --access public`

No test framework or linter is configured.

## Architecture

ESM-only (`"type": "module"`). Pure JavaScript, no build step.

### Entry Flow

`index.js` -> `src/server.js:startServer()` -> initializes Firebase, registers MCP tool handlers via `@modelcontextprotocol/sdk`, connects stdio transport.

### Key Modules

- **`src/firebase.js`** - Dual-endpoint Firebase initialization. Creates separate `firebase-admin` app instances for emulator and production by toggling `FIRESTORE_EMULATOR_HOST` env var during construction. Exports `initFirebase()` and `getDb(target)`.
- **`src/config.js`** - Project ID auto-detection chain: env vars -> `gcloud config` -> `firebase.json` / `.firebaserc` (walks up 10 parent dirs).
- **`src/constants.js`** - Target identifiers (`TARGETS.EMULATOR`, `TARGETS.PRODUCTION`).
- **`src/server.js`** - MCP server setup, tool registration, request routing via `getHandler()`.

### Tool Module Pattern

Each tool in `src/tools/` exports two named exports:
1. `definition` - MCP tool schema (name, description, inputSchema)
2. `handler(args, db)` - async function receiving parsed args and a Firestore `db` instance, returns a plain object (serialized to JSON by `buildResponse`)

The `target` parameter is injected into every tool's schema automatically by `src/tools/index.js:getToolDefinitions()`.

### Helpers

- **`src/helpers/query.js`** - Shared query building: `applyWhereClauses`, `applyOrderBy`, `applyPagination`, `executeQuery`, `mapDocSnapshot`
- **`src/helpers/schema.js`** - Shared JSON Schema fragments (`COLLECTION_PROPERTY`, `PAGINATION_PROPERTIES`, `WHERE_CLAUSES_PROPERTY`)
- **`src/helpers/response.js`** - `buildResponse(data)` and `buildErrorResponse(error)` wrappers
- **`src/helpers/coerce-value.js`** - String-to-type coercion for query values (numbers, booleans, null, JSON arrays/objects)

### Adding a New Tool

1. Create `src/tools/<tool-name>.js` exporting `definition` and `handler`
2. Import and add to the `tools` array in `src/tools/index.js`
3. Use shared schema fragments from `src/helpers/schema.js` for common properties
4. The `target` parameter and `db` instance are handled automatically

## Environment Variables

| Variable | Purpose |
|---|---|
| `GOOGLE_CLOUD_PROJECT` / `FIREBASE_PROJECT_ID` | Project ID (or auto-detected) |
| `FIRESTORE_EMULATOR_HOST` | Emulator address, enables emulator target |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service account key path, enables production target |
| `MCP_FIRESTORE_DEFAULT_TARGET` | Override default target (`"emulator"` or `"production"`) |

At least one of `FIRESTORE_EMULATOR_HOST` or `GOOGLE_APPLICATION_CREDENTIALS` must be set.
