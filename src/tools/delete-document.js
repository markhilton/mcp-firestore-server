import { COLLECTION_PROPERTY, CONFIRM_PROPERTY } from "../helpers/schema.js";
import { assertWriteAllowed } from "../helpers/guards.js";
import { validateCollectionPath } from "../helpers/validate.js";

export const definition = {
  name: "delete_document",
  description:
    "Delete a document. Supports subcollection paths (e.g. 'users/uid/posts').",
  inputSchema: {
    type: "object",
    properties: {
      collection: COLLECTION_PROPERTY,
      docId: { type: "string", description: "Document ID" },
      confirm: CONFIRM_PROPERTY,
    },
    required: ["collection", "docId"],
  },
};

export async function handler(args, db, target) {
  assertWriteAllowed(target, args);
  validateCollectionPath(args.collection);

  await db.collection(args.collection).doc(args.docId).delete();

  return {
    collection: args.collection,
    id: args.docId,
    operation: "deleted",
  };
}
