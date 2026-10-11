import {
  COLLECTION_PROPERTY,
  PAGINATION_PROPERTIES,
  OUTPUT_PROPERTIES,
} from "../helpers/schema.js";
import { applyOrderBy, applyPagination, executeQuery } from "../helpers/query.js";
import { applySelect } from "../helpers/output.js";
import { validateCollectionPath } from "../helpers/validate.js";

export const definition = {
  name: "query_collection",
  description:
    "Query a Firestore collection. Supports subcollection paths (e.g. 'users/uid/posts'). Paginate with startAfter=lastDocId. Output is capped (default 60000 chars): if values were compacted the response has `partial: true` (pass `raw: true` for full values); if `truncated` is true, fetch the next page with startAfter=lastDocId, or pass `fields` to select fewer fields.",
  inputSchema: {
    type: "object",
    properties: {
      collection: COLLECTION_PROPERTY,
      ...PAGINATION_PROPERTIES,
      ...OUTPUT_PROPERTIES,
    },
    required: ["collection"],
  },
};

export async function handler(args, db) {
  validateCollectionPath(args.collection);
  let query = db.collection(args.collection);
  query = applySelect(query, args.fields);
  query = applyOrderBy(query, args);
  query = await applyPagination(query, db, args.collection, args.startAfter);

  const { docs, lastDocId, extras } = await executeQuery(query, args.limit, args);

  return {
    collection: args.collection,
    count: docs.length,
    documents: docs,
    ...(lastDocId && { lastDocId }),
    ...extras,
  };
}
