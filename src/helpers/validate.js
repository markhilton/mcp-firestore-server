export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 1000;

/**
 * Validate a query `limit`. Undefined/null yields the default (10); anything
 * else must be an integer (or integer string) in 1..1000.
 *
 * @param {unknown} limit
 * @returns {number}
 * @throws {Error} When limit is not an integer within range.
 */
export function resolveLimit(limit) {
  if (limit === undefined || limit === null || limit === "") return DEFAULT_LIMIT;
  const n =
    typeof limit === "string" && /^\s*\d+\s*$/.test(limit) ? Number(limit) : limit;
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new Error(
      `Invalid limit: must be an integer between 1 and ${MAX_LIMIT}. Use startAfter=lastDocId to page through more documents.`,
    );
  }
  return n;
}

/** Default maximum number of documents fetchable in a single batch_get. */
export const DEFAULT_MAX_BATCH = 300;

/**
 * Validate a Firestore collection path before it reaches the SDK, so callers
 * get a clear error instead of a cryptic Firestore one.
 *
 * Accepts simple ("users") and nested ("users/uid/posts") collection paths.
 * A collection path has an odd number of segments (collection/doc/collection…).
 *
 * @param {string} path
 * @throws {Error} When the path is missing, blank, or malformed.
 */
export function validateCollectionPath(path) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("Invalid collection path: expected a non-empty string.");
  }
  if (path.startsWith("/") || path.endsWith("/")) {
    throw new Error(`Invalid collection path "${path}": no leading or trailing slashes.`);
  }
  const segments = path.split("/");
  if (segments.some(s => s.trim() === "")) {
    throw new Error(`Invalid collection path "${path}": contains empty segments.`);
  }
  if (segments.length % 2 === 0) {
    throw new Error(
      `Invalid collection path "${path}": collection paths must have an odd number of segments (e.g. 'users' or 'users/uid/posts').`,
    );
  }
}

/**
 * Ensure document data is a non-empty plain object before a create/update.
 *
 * @param {unknown} data
 * @throws {Error} When data is not a non-empty object.
 */
export function assertNonEmptyData(data) {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid document data: expected a non-null JSON object.");
  }
  if (Object.keys(data).length === 0) {
    throw new Error("Invalid document data: object must contain at least one field.");
  }
}

/**
 * Validate a batch_get id list and enforce a sane upper bound.
 *
 * @param {unknown} ids
 * @param {number} [max=DEFAULT_MAX_BATCH]
 * @throws {Error} When ids is not a non-empty array or exceeds the limit.
 */
export function assertBatchSize(ids, max = DEFAULT_MAX_BATCH) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("Invalid docIds: expected a non-empty array of document IDs.");
  }
  if (ids.length > max) {
    throw new Error(`Too many docIds: ${ids.length} requested, maximum is ${max}.`);
  }
}
