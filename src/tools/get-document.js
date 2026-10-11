import { COLLECTION_PROPERTY, OUTPUT_PROPERTIES } from "../helpers/schema.js";
import { mapDocSnapshot } from "../helpers/query.js";
import { validateCollectionPath } from "../helpers/validate.js";
import {
  compactData,
  fitSingleDoc,
  projectData,
  resolveMaxChars,
} from "../helpers/output.js";

export const definition = {
  name: "get_document",
  description:
    "Get a specific document by ID. Supports subcollection paths (e.g. 'users/uid/posts'). Large values are compacted and output is capped: pass `fields` to select only needed fields (skip embeddings), `raw: true` for uncompacted values (when values were compacted the response has `partial: true` and `compacted` lists them), `maxChars` to raise the cap.",
  inputSchema: {
    type: "object",
    properties: {
      collection: COLLECTION_PROPERTY,
      docId: { type: "string", description: "Document ID" },
      ...OUTPUT_PROPERTIES,
    },
    required: ["collection", "docId"],
  },
};

export async function handler(args, db) {
  validateCollectionPath(args.collection);
  const maxChars = resolveMaxChars(args.maxChars);
  const doc = await db.collection(args.collection).doc(args.docId).get();
  const mapped = mapDocSnapshot(doc);
  if (!mapped.exists) return mapped;

  const projected = projectData(mapped.data, args.fields);
  const { data, compacted } = compactData(mapped.id, projected, args.raw === true);
  const { doc: fitted, extras } = fitSingleDoc({ ...mapped, data }, maxChars);

  // `compacted` lists only fields still present after any budget trimming.
  const kept = compacted.filter(c => {
    const top = c.slice(mapped.id.length + 1).split(".")[0];
    return !(extras.omittedFields || []).includes(top);
  });
  return {
    ...fitted,
    ...(kept.length > 0 && { compacted: kept, partial: true }),
    ...extras,
  };
}
