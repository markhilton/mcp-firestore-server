/**
 * Output budgeting: field projection, value compaction and response-size caps.
 * Keeps tool results under the client's token limit instead of failing outright.
 */

export const DEFAULT_MAX_CHARS = 60000;
export const MIN_MAX_CHARS = 1000;
export const MAX_MAX_CHARS = 500000;
export const VECTOR_MIN_LENGTH = 64;
export const STRING_MAX_LENGTH = 4000;

/**
 * Validate and normalise the `fields` argument.
 * Returns an array of field paths, or null when absent/empty (meaning "all fields").
 */
export function normalizeFields(fields) {
  if (fields === undefined || fields === null) return null;
  if (!Array.isArray(fields) || fields.some(f => typeof f !== "string" || !f.trim())) {
    throw new Error(
      '\'fields\' must be an array of non-empty field-path strings (e.g. ["title", "author.name"]).',
    );
  }
  const clean = [...new Set(fields.map(f => f.trim()))];
  return clean.length > 0 ? clean : null;
}

/**
 * Resolve the response budget: per-call `maxChars` > env > default.
 */
export function resolveMaxChars(maxChars, env = process.env) {
  if (maxChars !== undefined && maxChars !== null) {
    const n = Number(maxChars);
    if (!Number.isInteger(n) || n < MIN_MAX_CHARS || n > MAX_MAX_CHARS) {
      throw new Error(
        `'maxChars' must be an integer between ${MIN_MAX_CHARS} and ${MAX_MAX_CHARS}.`,
      );
    }
    return n;
  }
  const fromEnv = parseInt(env.MCP_FIRESTORE_MAX_RESPONSE_CHARS, 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_CHARS;
}

/**
 * Apply Firestore server-side projection. Never calls select() with no fields
 * (that would return only document references).
 */
export function applySelect(query, fields) {
  const normalized = normalizeFields(fields);
  return normalized ? query.select(...normalized) : query;
}

function getPath(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || !(p in cur)) return { found: false };
    cur = cur[p];
  }
  return { found: true, value: cur };
}

function setPath(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Client-side projection supporting dotted nested paths ("a.b.c").
 * Missing paths are skipped. Returns data unchanged when fields is null.
 */
export function projectData(data, fields) {
  const normalized = normalizeFields(fields);
  if (!normalized || data === null || data === undefined) return data;
  const out = {};
  for (const path of normalized) {
    const parts = path.split(".");
    const { found, value } = getPath(data, parts);
    if (found) setPath(out, parts, value);
  }
  return out;
}

function isPlainObject(v) {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function compactNode(value, path, compacted) {
  if (typeof value === "string") {
    if (value.length > STRING_MAX_LENGTH) {
      compacted.push(path);
      const extra = value.length - STRING_MAX_LENGTH;
      return `${value.slice(0, STRING_MAX_LENGTH)}… [truncated ${extra} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > VECTOR_MIN_LENGTH && value.every(v => typeof v === "number")) {
      compacted.push(path);
      return `[${value.length} numbers omitted — pass raw: true or exclude via fields]`;
    }
    return value.map((v, i) => compactNode(v, `${path}.${i}`, compacted));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = compactNode(v, path ? `${path}.${k}` : k, compacted);
    }
    return out;
  }
  return value; // Timestamps, GeoPoints, DocumentReferences, primitives
}

/**
 * Compact one document's data. Returns { data, compacted } where compacted is a
 * list of "<docId>.<field.path>" entries. raw: true bypasses compaction.
 */
export function compactData(docId, data, raw = false) {
  if (raw || data === null || data === undefined) return { data, compacted: [] };
  const paths = [];
  const out = compactNode(data, "", paths);
  return { data: out, compacted: paths.map(p => `${docId}.${p}`) };
}

function size(value) {
  return JSON.stringify(value, null, 2).length;
}

/**
 * Prepare docs ({id, data, ...}) for output: project (client-side, optional),
 * compact, and keep per-doc compacted paths so dropped docs are not reported.
 */
export function prepareDocs(docs, { fields, raw } = {}) {
  const normalized = normalizeFields(fields);
  return docs.map(doc => {
    const base = normalized ? { ...doc, data: projectData(doc.data, normalized) } : doc;
    const { data, compacted } = compactData(doc.id, base.data, raw === true);
    return { doc: { ...base, data }, compacted };
  });
}

/**
 * Trim trailing documents until the serialized array fits maxChars (keeps >= 1).
 * Returns { docs, compacted, dropped } where dropped is the list of removed docs.
 */
export function fitDocs(prepared, maxChars) {
  if (prepared.length === 0) return { docs: [], compacted: [], dropped: [] };
  // JSON.stringify(arr, null, 2) = "[\n" + items indented 2 spaces, joined ",\n" + "\n]".
  // Indenting an item adds 2 chars plus 2 per embedded newline. Size each doc once.
  const itemSize = p => {
    const s = JSON.stringify(p.doc, null, 2);
    let newlines = 0;
    for (let i = s.indexOf("\n"); i !== -1; i = s.indexOf("\n", i + 1)) newlines++;
    return s.length + 2 + newlines * 2;
  };
  let total = 4 + itemSize(prepared[0]); // brackets/newlines + first doc (always kept)
  let keep = 1;
  while (keep < prepared.length) {
    const next = total + 2 + itemSize(prepared[keep]);
    if (next > maxChars) break;
    total = next;
    keep++;
  }
  const kept = prepared.slice(0, keep);
  return {
    docs: kept.map(p => p.doc),
    compacted: kept.flatMap(p => p.compacted),
    dropped: prepared.slice(keep).map(p => p.doc),
  };
}

/**
 * Fit a single document ({id, exists, data}) into maxChars by omitting top-level
 * fields (in order) once the budget is exhausted. Returns { doc, extras }.
 */
export function fitSingleDoc(doc, maxChars) {
  if (size(doc) <= maxChars || !isPlainObject(doc.data)) {
    return { doc, extras: {} };
  }
  const data = {};
  const omittedFields = [];
  let used = size({ ...doc, data: {} });
  for (const [k, v] of Object.entries(doc.data)) {
    const s = size({ [k]: v });
    if (used + s <= maxChars) {
      data[k] = v;
      used += s;
    } else {
      omittedFields.push(k);
    }
  }
  return {
    doc: { ...doc, data },
    extras: {
      truncated: true,
      truncatedReason: "maxChars",
      omittedFields,
      hint: "Document exceeds the response budget. Pass 'fields' to select only the fields you need, or raise 'maxChars'.",
    },
  };
}

/**
 * Build the optional metadata keys for a query response.
 */
export function queryExtras({ compacted, dropped, singleOversize }) {
  return {
    ...(compacted.length > 0 && { compacted }),
    ...(dropped.length > 0 && { truncated: true, truncatedReason: "maxChars" }),
    ...(singleOversize && {
      hint: "A single document exceeds the response budget. Pass 'fields' to select only the fields you need, or raise 'maxChars'.",
    }),
  };
}

/**
 * Shared post-processing for query tools.
 * Returns { docs, lastDocId, extras }.
 */
export function finalizeQueryDocs(rawDocs, args) {
  const maxChars = resolveMaxChars(args.maxChars);
  const prepared = prepareDocs(rawDocs, { fields: args.fields, raw: args.raw });
  const { docs, compacted, dropped } = fitDocs(prepared, maxChars);
  const singleOversize = docs.length === 1 && size(docs) > maxChars;
  const lastDocId = docs.length > 0 ? docs[docs.length - 1].id : null;
  return {
    docs,
    lastDocId,
    extras: queryExtras({ compacted, dropped, singleOversize }),
  };
}
