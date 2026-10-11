import {
  COLLECTION_PROPERTY,
  CONFIRM_PROPERTY,
  TYPED_VALUES_DESCRIPTION,
} from "../helpers/schema.js";
import { assertWriteAllowed } from "../helpers/guards.js";
import { validateCollectionPath, assertNonEmptyData } from "../helpers/validate.js";
import { decodeDocumentData, DECODE_MODES } from "../helpers/typed-values.js";

export const definition = {
  name: "create_document",
  description:
    "Create a new document in a collection. Supports subcollection paths (e.g. 'users/uid/posts'). Supports Timestamp values and the $serverTimestamp / $increment sentinels in data ($delete is rejected; use update_document).",
  inputSchema: {
    type: "object",
    properties: {
      collection: COLLECTION_PROPERTY,
      docId: {
        type: "string",
        description:
          "Optional document ID. If not provided, Firestore will auto-generate one.",
      },
      data: {
        type: "object",
        description: `Document data as JSON object. ${TYPED_VALUES_DESCRIPTION}`,
      },
      confirm: CONFIRM_PROPERTY,
    },
    required: ["collection", "data"],
  },
};

export async function handler(args, db, target) {
  assertWriteAllowed(target, args);
  validateCollectionPath(args.collection);
  assertNonEmptyData(args.data);
  const data = decodeDocumentData(args.data, DECODE_MODES.CREATE);

  const collectionRef = db.collection(args.collection);
  let docRef;

  if (args.docId) {
    docRef = collectionRef.doc(args.docId);
    await docRef.set(data);
  } else {
    docRef = await collectionRef.add(data);
  }

  return {
    collection: args.collection,
    id: docRef.id,
    operation: "created",
  };
}
