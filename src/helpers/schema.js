import { WHERE_OPERATORS } from "./query.js";

/**
 * Shared schema fragments for tool definitions.
 * Prevents duplication of common property definitions across tool files.
 */

export const COLLECTION_PROPERTY = {
  type: "string",
  description: "Collection path (e.g. 'users' or 'users/uid/posts' for subcollections)",
};

export const CONFIRM_PROPERTY = {
  type: "boolean",
  default: false,
  description:
    "Required `true` to write to the production target. Ignored for the emulator target.",
};

/**
 * Caller-facing summary of the typed-value encodings decoded by
 * src/helpers/typed-values.js. Appended to write-tool `data` descriptions.
 */
export const TYPED_VALUES_DESCRIPTION =
  'Typed values (any depth, incl. arrays): Timestamp as {"_seconds": n, "_nanoseconds": n} (same shape reads return) or {"$timestamp": "2026-10-11T01:17:00Z"} (ISO-8601 with timezone). Sentinels (not inside arrays): {"$serverTimestamp": true}, {"$increment": n}. Bare ISO strings stay strings.';

export const PAGINATION_PROPERTIES = {
  limit: { type: "number", default: 10, description: "Maximum documents to return" },
  orderBy: { type: "string", description: "Field to order by" },
  orderDirection: {
    type: "string",
    enum: ["asc", "desc"],
    default: "asc",
    description: "Order direction",
  },
  startAfter: {
    type: "string",
    description:
      "Document ID to start after (for pagination). Use lastDocId from previous response.",
  },
};

export const WHERE_CLAUSES_PROPERTY = {
  type: "array",
  description:
    'Array of where clauses: [[field, operator, value], ...]. Values are auto-coerced to numbers, booleans, arrays, etc. To filter on a Timestamp pass a JSON-encoded value such as {"$timestamp": "2026-10-11T01:17:00Z"} or {"_seconds": 1791681420, "_nanoseconds": 0}.',
  items: {
    type: "array",
    // Draft 2020-12 tuple validation uses `prefixItems` (the legacy array-form
    // `items: [...]` is invalid under 2020-12 and makes Anthropic reject the
    // whole tool list with `tools.N.custom.input_schema: JSON schema is invalid`).
    prefixItems: [
      { type: "string", description: "Field name" },
      { type: "string", enum: WHERE_OPERATORS, description: "Comparison operator" },
      {
        type: "string",
        description:
          "Value to compare (auto-coerced; JSON-encoded Timestamp forms supported)",
      },
    ],
    minItems: 3,
    maxItems: 3,
  },
};
