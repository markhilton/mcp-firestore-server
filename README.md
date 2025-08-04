# MCP Firestore Server

A Model Context Protocol (MCP) server that provides Firestore database operations.

## Installation

```bash
npx @nerd305/mcp-firestore-server
```

## Configuration

The server requires the following environment variables:

- `GOOGLE_CLOUD_PROJECT` or `FIREBASE_PROJECT_ID`: Your Firebase project ID (required)
- `FIRESTORE_EMULATOR_HOST`: Firestore emulator host (optional, e.g., "127.0.0.1:8080")

## Usage with Claude Desktop

Add to your `.mcp.json` configuration:

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

For production Firestore (requires authentication):

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

## Available Tools

### query_collection

Query documents from a Firestore collection.

```typescript
{
  collection: string;
  limit?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}
```

### get_document

Get a specific document by ID.

```typescript
{
  collection: string;
  docId: string;
}
```

### query_with_where

Query documents with where conditions.

```typescript
{
  collection: string;
  field: string;
  operator: "==" | "!=" | "<" | "<=" | ">" | ">=" | "array-contains" | "in" | "array-contains-any";
  value: string;
  limit?: number;
}
```

### list_collections

List all top-level collections.

```typescript
{
}
```

### create_document

Create a new document.

```typescript
{
  collection: string;
  docId?: string; // Optional, auto-generated if not provided
  data: object;
}
```

### update_document

Update an existing document.

```typescript
{
  collection: string;
  docId: string;
  data: object;
  merge?: boolean; // Default: true
}
```

### delete_document

Delete a document.

```typescript
{
  collection: string;
  docId: string;
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
