import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Typed value decoding for JSON tool input.
 *
 * MCP tool arguments are plain JSON, so Firestore-native types need an
 * encoding. These forms are recognised (anywhere in a value, recursively):
 *
 *   {"_seconds": n, "_nanoseconds": n}  -> Timestamp  (the shape reads return)
 *   {"$timestamp": "<ISO-8601>"}        -> Timestamp
 *   {"$serverTimestamp": true}          -> FieldValue.serverTimestamp()
 *   {"$delete": true}                   -> FieldValue.delete()  (update/merge only)
 *   {"$increment": n}                   -> FieldValue.increment(n)
 *   {"$string": "33101"}                -> the plain string (escape for digit-only/"true" strings;
 *                                          allowed in every mode, incl. queries)
 *
 * Bare ISO strings are deliberately NOT converted: that would silently change
 * the type of ordinary string fields.
 */

/** Decode modes: which Firestore operation the value is destined for. */
export const DECODE_MODES = Object.freeze({
  CREATE: "create", // set() without merge / add(): no $delete
  MERGE: "merge", // set(..., { merge: true }): $delete allowed at any map depth
  UPDATE: "update", // update(): $delete allowed only on top-level fields
  QUERY: "query", // where() values: Timestamps only, no sentinels
});

const TAGS = new Set([
  "$string",
  "$timestamp",
  "$serverTimestamp",
  "$delete",
  "$increment",
]);

const MAX_NANOS = 999_999_999;

// Date (UTC) or date-time with an explicit offset; optional 1–9 fractional digits.
const ISO_RE =
  /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2}))?$/;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function fail(path, message) {
  throw new Error(`Invalid typed value at "${path || "<root>"}": ${message}`);
}

function parseIsoTimestamp(str, path) {
  if (typeof str !== "string") {
    fail(path, '$timestamp must be an ISO-8601 string, e.g. "2026-10-11T01:17:00Z".');
  }
  const m = ISO_RE.exec(str);
  if (!m) {
    fail(
      path,
      `$timestamp "${str}" is not ISO-8601 with an explicit timezone (e.g. "2026-10-11T01:17:00Z" or "2026-10-11T01:17:00-04:00").`,
    );
  }
  const [, date, time, fraction, zone] = m;
  // Parse without the fraction (Date only keeps ms), then add nanos back.
  const millis = Date.parse(time ? `${date}T${time}${zone}` : `${date}T00:00:00Z`);
  if (Number.isNaN(millis)) fail(path, `$timestamp "${str}" is not a valid date.`);
  const nanos = fraction ? Number(fraction.padEnd(9, "0")) : 0;
  return new Timestamp(Math.floor(millis / 1000), nanos);
}

function decodeSecondsNanos(obj, path) {
  const { _seconds: s, _nanoseconds: n } = obj;
  if (!Number.isInteger(s)) fail(path, "_seconds must be an integer.");
  if (!Number.isInteger(n) || n < 0 || n > MAX_NANOS) {
    fail(path, `_nanoseconds must be an integer between 0 and ${MAX_NANOS}.`);
  }
  try {
    return new Timestamp(s, n);
  } catch (err) {
    return fail(path, err.message);
  }
}

function decodeTagged(tag, arg, ctx) {
  const { mode, path, inArray, depth } = ctx;

  if (tag === "$string") {
    if (typeof arg !== "string")
      fail(path, '$string must wrap a string, e.g. {"$string": "33101"}.');
    return arg;
  }
  if (tag === "$timestamp") return parseIsoTimestamp(arg, path);

  // Everything below is a write sentinel.
  if (mode === DECODE_MODES.QUERY) {
    fail(path, `${tag} is a write sentinel and cannot be used in a query value.`);
  }
  if (inArray)
    fail(path, `${tag} cannot be used inside an array (Firestore restriction).`);

  switch (tag) {
    case "$serverTimestamp":
      if (arg !== true) fail(path, "$serverTimestamp must be true.");
      return FieldValue.serverTimestamp();
    case "$increment":
      if (typeof arg !== "number" || !Number.isFinite(arg)) {
        fail(path, "$increment must be a finite number.");
      }
      return FieldValue.increment(arg);
    case "$delete":
      if (arg !== true) fail(path, "$delete must be true.");
      if (mode === DECODE_MODES.CREATE) {
        fail(
          path,
          "$delete is only valid in update_document (merge or update); it cannot be used when creating a document.",
        );
      }
      if (mode === DECODE_MODES.UPDATE && depth > 1) {
        fail(
          path,
          "$delete inside a nested map requires merge:true (update() only accepts it on top-level fields).",
        );
      }
      return FieldValue.delete();
    default:
      return fail(path, `unknown tag ${tag}.`);
  }
}

function decode(value, ctx) {
  if (Array.isArray(value)) {
    return value.map((item, i) =>
      decode(item, { ...ctx, path: `${ctx.path}[${i}]`, inArray: true }),
    );
  }
  if (!isPlainObject(value)) return value;

  const keys = Object.keys(value);

  if (keys.length === 2 && "_seconds" in value && "_nanoseconds" in value) {
    return decodeSecondsNanos(value, ctx.path);
  }

  const tagKeys = keys.filter(k => TAGS.has(k));
  if (tagKeys.length > 0) {
    if (keys.length !== 1) {
      fail(ctx.path, `${tagKeys[0]} must be the only key in its object.`);
    }
    return decodeTagged(tagKeys[0], value[tagKeys[0]], ctx);
  }

  const out = {};
  for (const key of keys) {
    out[key] = decode(value[key], {
      ...ctx,
      path: ctx.path ? `${ctx.path}.${key}` : key,
      depth: ctx.depth + 1,
    });
  }
  return out;
}

/**
 * Decode typed-value encodings in a document data object (create/update).
 *
 * @param {object} data - Plain JSON document data.
 * @param {"create"|"merge"|"update"} mode - Destination write operation.
 * @returns {object} A new object with Timestamps / FieldValue sentinels substituted.
 * @throws {Error} On malformed encodings or a sentinel used where Firestore forbids it.
 */
export function decodeDocumentData(data, mode) {
  return decode(data, { mode, path: "", depth: 0, inArray: false });
}

/**
 * Decode typed-value encodings in a query where-clause value. Only Timestamp
 * forms are allowed; write sentinels are rejected.
 *
 * @param {unknown} value - Already-coerced where value.
 * @param {string} [field] - Field name, used in error messages.
 */
export function decodeQueryValue(value, field = "") {
  return decode(value, {
    mode: DECODE_MODES.QUERY,
    path: field,
    depth: 1,
    inArray: false,
  });
}
