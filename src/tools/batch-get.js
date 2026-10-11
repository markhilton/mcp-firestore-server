import { COLLECTION_PROPERTY, OUTPUT_PROPERTIES } from "../helpers/schema.js";
import { mapDocSnapshot } from "../helpers/query.js";
import { validateCollectionPath, assertBatchSize } from "../helpers/validate.js";
import {
  fitDocs,
  fitSingleDoc,
  normalizeFields,
  prepareDocs,
  resolveMaxChars,
} from "../helpers/output.js";

export const definition = {
  name: "batch_get",
  description:
    "Fetch multiple documents by ID in a single request. Uses Firestore's getAll() for efficiency. Supports subcollection paths. Large values are compacted and output is capped: pass `fields` to select only needed fields, `raw: true` for uncompacted values, `maxChars` to raise the cap. If `truncated`, re-request the ids in `omittedIds`.",
  inputSchema: {
    type: "object",
    properties: {
      collection: COLLECTION_PROPERTY,
      docIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of document IDs to fetch",
      },
      ...OUTPUT_PROPERTIES,
    },
    required: ["collection", "docIds"],
  },
};

export async function handler(args, db) {
  validateCollectionPath(args.collection);
  assertBatchSize(args.docIds);
  const maxChars = resolveMaxChars(args.maxChars);
  const fields = normalizeFields(args.fields);

  const refs = args.docIds.map(id => db.collection(args.collection).doc(id));
  const snapshots = await db.getAll(...refs, ...(fields ? [{ fieldMask: fields }] : []));
  const mapped = snapshots.map(mapDocSnapshot);

  const prepared = prepareDocs(mapped, { fields, raw: args.raw });
  const fit = fitDocs(prepared, maxChars);
  let docs = fit.docs;
  let compacted = fit.compacted;
  let extras = {};
  if (docs.length === 1) {
    const single = fitSingleDoc(docs[0], maxChars);
    docs = [single.doc];
    extras = single.extras;
    if (extras.omittedFields) {
      const id = docs[0].id;
      compacted = compacted.filter(
        c => !extras.omittedFields.includes(c.slice(id.length + 1).split(".")[0]),
      );
    }
  }
  const dropped = fit.dropped;

  const droppedHint =
    "Response exceeded the budget; omittedIds were not returned. Re-request them, or pass 'fields' to select fewer fields.";
  const hints = [dropped.length > 0 && droppedHint, extras.hint].filter(Boolean);

  return {
    collection: args.collection,
    count: docs.filter(d => d.exists).length,
    requested: args.docIds.length,
    documents: docs,
    ...(compacted.length > 0 && { compacted }),
    ...((dropped.length > 0 || extras.truncated) && {
      truncated: true,
      truncatedReason: "maxChars",
    }),
    ...(dropped.length > 0 && { omittedIds: dropped.map(d => d.id) }),
    ...(extras.omittedFields && { omittedFields: extras.omittedFields }),
    ...(hints.length > 0 && { hint: hints.join(" ") }),
  };
}
