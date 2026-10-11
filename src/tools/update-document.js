import {
  COLLECTION_PROPERTY,
  CONFIRM_PROPERTY,
  TYPED_VALUES_DESCRIPTION,
} from "../helpers/schema.js";
import { assertWriteAllowed } from "../helpers/guards.js";
import { validateCollectionPath, assertNonEmptyData } from "../helpers/validate.js";
import { decodeDocumentData, DECODE_MODES } from "../helpers/typed-values.js";

export const definition = {
  name: "update_document",
  description:
    "Update an existing document. Supports subcollection paths (e.g. 'users/uid/posts'). Supports Timestamp values and the $serverTimestamp / $increment / $delete sentinels in data.",
  inputSchema: {
    type: "object",
    properties: {
      collection: COLLECTION_PROPERTY,
      docId: { type: "string", description: "Document ID" },
      data: {
        type: "object",
        description: `Fields to update as JSON object. ${TYPED_VALUES_DESCRIPTION} Remove a field with {"$delete": true} (nested maps require merge:true).`,
      },
      merge: {
        type: "boolean",
        default: true,
        description: "Whether to merge with existing data (default: true)",
      },
      confirm: CONFIRM_PROPERTY,
    },
    required: ["collection", "docId", "data"],
  },
};

export async function handler(args, db, target) {
  assertWriteAllowed(target, args);
  validateCollectionPath(args.collection);
  assertNonEmptyData(args.data);

  const merge = !(Object.hasOwn(args, "merge") && args.merge === false);
  const data = decodeDocumentData(
    args.data,
    merge ? DECODE_MODES.MERGE : DECODE_MODES.UPDATE,
  );
  const docRef = db.collection(args.collection).doc(args.docId);

  if (merge) {
    await docRef.set(data, { merge: true });
  } else {
    await docRef.update(data);
  }

  return {
    collection: args.collection,
    id: args.docId,
    operation: "updated",
    merge,
  };
}
