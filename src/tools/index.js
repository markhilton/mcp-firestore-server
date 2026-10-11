import * as queryCollection from "./query-collection.js";
import * as getDocument from "./get-document.js";
import * as queryWithWhere from "./query-with-where.js";
import * as listCollections from "./list-collections.js";
import * as createDocument from "./create-document.js";
import * as updateDocument from "./update-document.js";
import * as deleteDocument from "./delete-document.js";
import * as countDocuments from "./count-documents.js";
import * as batchGet from "./batch-get.js";

const tools = [
  queryCollection,
  getDocument,
  queryWithWhere,
  listCollections,
  createDocument,
  updateDocument,
  deleteDocument,
  countDocuments,
  batchGet,
];

/** Tools that modify data. */
export const WRITE_TOOLS = Object.freeze([
  "create_document",
  "update_document",
  "delete_document",
]);

/** MCP tool annotations (hints for clients about safety/side effects). */
const READ = { readOnlyHint: true, openWorldHint: false };
const ANNOTATIONS = {
  query_collection: { title: "Query collection", ...READ },
  get_document: { title: "Get document", ...READ },
  query_with_where: { title: "Query with filters", ...READ },
  list_collections: { title: "List collections", ...READ },
  count_documents: { title: "Count documents", ...READ },
  batch_get: { title: "Batch get documents", ...READ },
  create_document: {
    title: "Create document",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  update_document: {
    title: "Update document",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  delete_document: {
    title: "Delete document",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/**
 * Read-only mode from MCP_FIRESTORE_READONLY:
 * "1"/"true"/"all" -> "all" (write tools hidden and rejected),
 * "production"     -> "production" (writes to production rejected),
 * otherwise        -> null.
 */
export function getReadOnlyMode() {
  const raw = (process.env.MCP_FIRESTORE_READONLY || "").trim().toLowerCase();
  if (["1", "true", "all"].includes(raw)) return "all";
  if (raw === "production") return "production";
  return null;
}

/**
 * Get tool definitions with the `target` parameter injected into each tool.
 * Write tools are omitted when MCP_FIRESTORE_READONLY is "1"/"true"/"all".
 */
export function getToolDefinitions(availableTargets, defaultTarget) {
  const hideWrites = getReadOnlyMode() === "all";
  return tools
    .filter(tool => !(hideWrites && WRITE_TOOLS.includes(tool.definition.name)))
    .map(tool => ({
      ...tool.definition,
      annotations: ANNOTATIONS[tool.definition.name],
      inputSchema: {
        ...tool.definition.inputSchema,
        properties: {
          ...tool.definition.inputSchema.properties,
          target: {
            type: "string",
            enum: availableTargets,
            description: `Firestore target endpoint (default: "${defaultTarget}")`,
          },
        },
      },
    }));
}

/**
 * Get handler function for a tool by name.
 */
const handlerMap = Object.fromEntries(
  tools.map(tool => [tool.definition.name, tool.handler]),
);

export function getHandler(toolName) {
  return handlerMap[toolName] || null;
}
