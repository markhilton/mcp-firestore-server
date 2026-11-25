import { Buffer } from "node:buffer";
import { InputValidationError } from "./errors.js";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 1000;

/**
 * Validate a query `limit`. Undefined/null yields the default (10); anything
 * else must be an integer (or integer string) in 1..1000.
 *
 * @param {unknown} limit
 * @returns {number}
 * @throws {InputValidationError} When limit is not an integer within range.
 */
export function resolveLimit(limit) {
  if (limit === undefined || limit === null || limit === "") return DEFAULT_LIMIT;
  const n =
    typeof limit === "string" && /^\s*\d+\s*$/.test(limit) ? Number(limit) : limit;
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new InputValidationError(
      `Invalid limit: must be an integer between 1 and ${MAX_LIMIT}. Use startAfter=lastDocId to page through more documents.`,
    );
  }
  return n;
}

/** Default maximum number of documents fetchable in a single batch_get. */
export const DEFAULT_MAX_BATCH = 300;

/** Max collection/document path size in bytes (Firestore's resource-name limit). */
export const MAX_PATH_BYTES = 6144;

/** Reject an oversized path before any shape check, so it is never echoed back. */
function checkPathLength(path, label) {
  if (typeof path === "string" && Buffer.byteLength(path, "utf8") > MAX_PATH_BYTES) {
    throw new InputValidationError(
      `Invalid ${label}: longer than ${MAX_PATH_BYTES} bytes.`,
    );
  }
}

/**
 * Validate a Firestore collection path before it reaches the SDK, so callers
 * get a clear error instead of a cryptic Firestore one.
 *
 * Accepts simple ("users") and nested ("users/uid/posts") collection paths.
 * A collection path has an odd number of segments (collection/doc/collection…).
 *
 * @param {string} path
 * @throws {InputValidationError} When the path is missing, blank, or malformed.
 */
export function validateCollectionPath(path) {
  checkPathLength(path, "collection path");
  if (typeof path !== "string" || path.trim() === "") {
    throw new InputValidationError(
      "Invalid collection path: expected a non-empty string.",
    );
  }
  if (path.startsWith("/") || path.endsWith("/")) {
    throw new InputValidationError(
      `Invalid collection path "${path}": no leading or trailing slashes.`,
    );
  }
  const segments = path.split("/");
  if (segments.some(s => s.trim() === "")) {
    throw new InputValidationError(
      `Invalid collection path "${path}": contains empty segments.`,
    );
  }
  if (segments.length % 2 === 0) {
    throw new InputValidationError(
      `Invalid collection path "${path}": collection paths must have an odd number of segments (e.g. 'users' or 'users/uid/posts').`,
    );
  }
}

/** Max document ID size in bytes (Firestore limit). */
const MAX_DOC_ID_BYTES = 1500;

/** Rules shared by document IDs and path segments (no slash check here). */
function checkIdSegment(id, label) {
  if (typeof id !== "string" || id === "") {
    throw new InputValidationError(`Invalid ${label}: expected a non-empty string.`);
  }
  if (id === "." || id === "..") {
    throw new InputValidationError(
      `Invalid ${label} "${id}": "." and ".." are reserved.`,
    );
  }
  if (/^__.*__$/.test(id)) {
    throw new InputValidationError(
      `Invalid ${label} "${id}": IDs of the form __name__ are reserved by Firestore.`,
    );
  }
  if (Buffer.byteLength(id, "utf8") > MAX_DOC_ID_BYTES) {
    throw new InputValidationError(
      `Invalid ${label}: longer than ${MAX_DOC_ID_BYTES} bytes.`,
    );
  }
}

/**
 * Validate a single Firestore document ID.
 *
 * @param {unknown} id
 * @param {string} [label="docId"] Name used in error messages.
 * @throws {InputValidationError} When the ID is not a valid single-segment ID.
 */
export function validateDocId(id, label = "docId") {
  if (typeof id === "string" && id.includes("/")) {
    throw new InputValidationError(
      `Invalid ${label} "${id}": must not contain "/". Put the parent path in \`collection\` instead (e.g. collection "users/u1/posts", docId "p1").`,
    );
  }
  checkIdSegment(id, label);
}

/**
 * Validate a Firestore document path ("users/uid" or "users/uid/posts/p1"):
 * an even number of valid segments.
 *
 * @param {string} path
 * @throws {InputValidationError} When the path is malformed.
 */
export function validateDocumentPath(path) {
  checkPathLength(path, "document path");
  if (typeof path !== "string" || path.trim() === "") {
    throw new InputValidationError("Invalid document path: expected a non-empty string.");
  }
  if (path.startsWith("/") || path.endsWith("/")) {
    throw new InputValidationError(
      `Invalid document path "${path}": no leading or trailing slashes.`,
    );
  }
  const segments = path.split("/");
  if (segments.some(s => s.trim() === "")) {
    throw new InputValidationError(
      `Invalid document path "${path}": contains empty segments.`,
    );
  }
  if (segments.length % 2 !== 0) {
    throw new InputValidationError(
      `Invalid document path "${path}": document paths must have an even number of segments (e.g. 'users/uid' or 'users/uid/posts/p1').`,
    );
  }
  for (const segment of segments) checkIdSegment(segment, "document path segment");
}

/**
 * Ensure document data is a non-empty plain object before a create/update.
 *
 * @param {unknown} data
 * @throws {InputValidationError} When data is not a non-empty object.
 */
export function assertNonEmptyData(data) {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new InputValidationError(
      "Invalid document data: expected a non-null JSON object.",
    );
  }
  if (Object.keys(data).length === 0) {
    throw new InputValidationError(
      "Invalid document data: object must contain at least one field.",
    );
  }
}

/**
 * Validate a batch_get id list and enforce a sane upper bound.
 *
 * @param {unknown} ids
 * @param {number} [max=DEFAULT_MAX_BATCH]
 * @throws {InputValidationError} When ids is not a non-empty array or exceeds the limit.
 */
export function assertBatchSize(ids, max = DEFAULT_MAX_BATCH) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new InputValidationError(
      "Invalid docIds: expected a non-empty array of document IDs.",
    );
  }
  if (ids.length > max) {
    throw new InputValidationError(
      `Too many docIds: ${ids.length} requested, maximum is ${max}.`,
    );
  }
}
