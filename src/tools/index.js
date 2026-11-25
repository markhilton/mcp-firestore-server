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
    destructiveHint: true,
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

const READONLY_OFF = ["", "0", "false", "off", "no"];
const READONLY_ALL = ["1", "true", "all"];

function readOnlyRaw() {
  return (process.env.MCP_FIRESTORE_READONLY || "").trim().toLowerCase();
}

/**
 * Read-only mode from MCP_FIRESTORE_READONLY (trimmed, case-insensitive):
 * unset/""/"0"/"false"/"off"/"no" -> null (writes enabled),
 * "production"                    -> "production" (writes to production rejected),
 * "1"/"true"/"all"                -> "all" (write tools hidden and rejected),
 * any other value                 -> "all" (fail closed: a typo must not enable writes).
 */
export function getReadOnlyMode() {
  const raw = readOnlyRaw();
  if (READONLY_OFF.includes(raw)) return null;
  if (raw === "production") return "production";
  return "all";
}

/**
 * One-line startup warning when MCP_FIRESTORE_READONLY holds an unrecognised
 * value (which is treated as "all"), else null.
 */
export function getReadOnlyWarning() {
  const raw = readOnlyRaw();
  if (READONLY_OFF.includes(raw) || raw === "production" || READONLY_ALL.includes(raw)) {
    return null;
  }
  const shown = raw.replace(/[^\x20-\x7e]/g, "?").slice(0, 40);
  return `Warning: unrecognised MCP_FIRESTORE_READONLY value "${shown}"; treating it as "all" (all writes disabled). Use 1/true/all, production, or 0/false/off/no.`;
}

/**
 * Get tool definitions with the `target` parameter injected into each tool.
 * Write tools are omitted when MCP_FIRESTORE_READONLY is "1"/"true"/"all".
 * The project ID is untrusted (it can come from a repo's .firebaserc), so it is shown
 * as quoted data with its fixed source label, never as free text.
 */
export function getToolDefinitions(
  availableTargets,
  defaultTarget,
  projectId,
  projectSource,
) {
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
            description: `Firestore target endpoint (default: "${defaultTarget}").${
              projectId
                ? ` Project ID (data${projectSource ? `, from ${projectSource}` : ""}): ${JSON.stringify(projectId)}.`
                : ""
            }`,
          },
        },
      },
    }));
}

/**
 * Get handler function for a tool by name.
 */
const handlerMap = new Map(tools.map(tool => [tool.definition.name, tool.handler]));

export function getHandler(toolName) {
  return handlerMap.get(toolName) ?? null;
}

/** True when `name` is a registered tool name (own, not inherited). */
export function isKnownTool(name) {
  return handlerMap.has(name);
}
