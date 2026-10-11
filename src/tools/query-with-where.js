import { coerceValue } from "../helpers/coerce-value.js";
import { decodeQueryValue } from "../helpers/typed-values.js";
import {
  COLLECTION_PROPERTY,
  PAGINATION_PROPERTIES,
  OUTPUT_PROPERTIES,
  WHERE_CLAUSES_PROPERTY,
} from "../helpers/schema.js";
import {
  WHERE_OPERATORS,
  applyWhereClauses,
  applyOrderBy,
  applyPagination,
  executeQuery,
} from "../helpers/query.js";
import { applySelect } from "../helpers/output.js";
import { validateCollectionPath } from "../helpers/validate.js";

export const definition = {
  name: "query_with_where",
  description:
    "Query a collection with where conditions. Supports single or multiple clauses, value type coercion (including Timestamp values), and pagination. Supports subcollection paths. Paginate with startAfter=lastDocId. Output is capped (default 60000 chars): if `truncated` is true, fetch the next page with startAfter=lastDocId, or pass `fields` to select fewer fields.",
  inputSchema: {
    type: "object",
    properties: {
      collection: COLLECTION_PROPERTY,
      where: WHERE_CLAUSES_PROPERTY,
      // Legacy single-clause format (backward compat)
      field: {
        type: "string",
        description: "Field to filter on (legacy single-clause format)",
      },
      operator: {
        type: "string",
        enum: WHERE_OPERATORS,
        description: "Comparison operator (legacy single-clause format)",
      },
      value: {
        type: "string",
        description:
          'Value to compare (legacy single-clause format). Numbers, booleans, and arrays are auto-coerced; JSON-encoded Timestamps such as {"$timestamp": "2026-10-11T01:17:00Z"} are decoded. To force a string that looks like a number/boolean/null (e.g. a zip code), pass {"$string": "33101"}.',
      },
      ...PAGINATION_PROPERTIES,
      ...OUTPUT_PROPERTIES,
    },
    required: ["collection"],
  },
};

export async function handler(args, db) {
  validateCollectionPath(args.collection);
  let query = db.collection(args.collection);
  let clauses;

  if (args.where && Array.isArray(args.where)) {
    // Multi-clause format: [[field, op, value], ...]
    ({ query, clauses } = applyWhereClauses(query, args.where));
  } else if (args.field && args.operator && args.value !== undefined) {
    // Legacy single-clause format
    const coerced = decodeQueryValue(coerceValue(args.value), args.field);
    clauses = [{ field: args.field, operator: args.operator, value: coerced }];
    query = query.where(args.field, args.operator, coerced);
  } else {
    throw new Error(
      "Provide either 'where' array or 'field'/'operator'/'value' parameters.",
    );
  }

  query = applySelect(query, args.fields);
  query = applyOrderBy(query, args);
  query = await applyPagination(query, db, args.collection, args.startAfter);

  const { docs, lastDocId, extras } = await executeQuery(query, args.limit, args);

  return {
    collection: args.collection,
    query: clauses
      .map(c => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`)
      .join(" AND "),
    count: docs.length,
    documents: docs,
    ...(lastDocId && { lastDocId }),
    ...extras,
  };
}
