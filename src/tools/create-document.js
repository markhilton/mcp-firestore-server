import {
  COLLECTION_PROPERTY,
  CONFIRM_PROPERTY,
  TYPED_VALUES_DESCRIPTION,
} from "../helpers/schema.js";
import { assertWriteAllowed } from "../helpers/guards.js";
import {
  validateCollectionPath,
  validateDocId,
  assertNonEmptyData,
} from "../helpers/validate.js";
import { InputValidationError } from "../helpers/errors.js";
import { decodeDocumentData, DECODE_MODES } from "../helpers/typed-values.js";

export const definition = {
  name: "create_document",
  description:
    "Create a new document in a collection. With a docId, fails with ALREADY_EXISTS if that document exists (use update_document to change it; use overwrite:true only after the user explicitly asks to replace the existing document entirely, which is destructive). Supports subcollection paths (e.g. 'users/uid/posts'). Supports Timestamp values and the $serverTimestamp / $increment sentinels in data ($delete is rejected; use update_document).",
  inputSchema: {
    type: "object",
    properties: {
      collection: COLLECTION_PROPERTY,
      docId: {
        type: "string",
        description:
          "Optional document ID. If not provided, Firestore will auto-generate one.",
      },
      overwrite: {
        type: "boolean",
        default: false,
        description:
          "Only with docId. If true, replace an existing document entirely instead of failing with ALREADY_EXISTS. Destructive: set it only after the user explicitly asks to replace the existing document; never as an automatic retry after ALREADY_EXISTS. Default false.",
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

  const hasDocId = args.docId !== undefined && args.docId !== null && args.docId !== "";
  if (hasDocId) validateDocId(args.docId);
  const overwrite = Object.hasOwn(args, "overwrite") && args.overwrite === true;
  if (overwrite && !hasDocId) {
    throw new InputValidationError(
      "overwrite:true requires docId (an auto-generated ID can never collide). Pass a docId, or drop overwrite.",
    );
  }

  const collectionRef = db.collection(args.collection);
  let docRef;
  let replaced = false;

  if (hasDocId) {
    docRef = collectionRef.doc(args.docId);
    if (overwrite) {
      await docRef.set(data);
      replaced = true;
    } else {
      await docRef.create(data);
    }
  } else {
    docRef = await collectionRef.add(data);
  }

  return {
    collection: args.collection,
    id: docRef.id,
    operation: "created",
    ...(replaced && { overwrite: true }),
  };
}
