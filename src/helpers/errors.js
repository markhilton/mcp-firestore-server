/**
 * Error classification and LLM-friendly mapping for Firestore failures.
 */

// Structured google-auth / gaxios message shapes (anchored, not arbitrary substrings).
const AUTH_MESSAGE_PATTERNS = [
  /^invalid_grant\b/i,
  /^(?:\d+ )?UNAUTHENTICATED\b/,
  /^Could not load the default credentials/i,
  /Getting metadata from plugin failed/i,
  /^The file at .+ does not exist/i,
  /^Unable to read the credential file/i,
];

/** Static replacement for AUTH_EXPIRED error text (the raw message can name accounts and files). */
export const AUTH_ERROR_MESSAGE =
  "Authentication failed: credentials expired or missing.";

const AUTH_HINT =
  "Application Default Credentials expired or are missing. Run `gcloud auth application-default login` " +
  "(or fix GOOGLE_APPLICATION_CREDENTIALS), then retry — the server re-initialises credentials automatically, no restart needed.";

/**
 * True when the error is an expired/missing credential failure. Uses structured
 * signals (gRPC code, google-auth response shape, library message prefixes) and
 * never loose substring matches, so caller-echoed text (e.g. a collection path
 * containing "reauth") is not misclassified.
 */
export function isAuthError(error) {
  // Our own validation messages echo caller input and must never be classified as auth failures.
  if (isValidationError(error)) return false;
  if (error?.code === 16 || error?.code === "UNAUTHENTICATED") return true;
  if (error?.response?.data?.error === "invalid_grant") return true;
  const message = String(error?.message ?? error ?? "");
  return AUTH_MESSAGE_PATTERNS.some(re => re.test(message));
}

const PRIVATE_KEY_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

/**
 * Marks an error whose message contains only this server's own text plus
 * caller-supplied input (argument validation, guards). Such messages are safe
 * to echo verbatim, apart from secret redaction, so path redaction is skipped
 * for them: a path the caller typed is not a leak, and hiding it makes the
 * message useless to the LLM that has to fix it. Never use it for messages
 * that embed SDK, OS or network error text.
 */
export class InputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputValidationError";
  }
}

/** True when the error is an InputValidationError. */
export function isValidationError(error) {
  return error instanceof InputValidationError;
}

/**
 * Whether debug mode is on (stack traces in responses, unredacted errors and
 * full stderr logging). Only MCP_FIRESTORE_DEBUG counts: generic DEBUG is set to
 * `*` by many unrelated tools and must not disable redaction.
 */
export function debugEnabled() {
  return Boolean(process.env.MCP_FIRESTORE_DEBUG);
}

/** Messages longer than this are truncated before redaction (bounds regex cost). */
const MAX_REDACT_LENGTH = 4096;

// Characters that may directly precede a path in prose, quotes or key=value pairs.
const PATH_PREFIX = "(^|[\\s\"'(=:,`])";
const SEGMENT = "[\\w.@~+-]";

const RELATIVE_PATH_RE = new RegExp(
  `${PATH_PREFIX}(?:~|\\.{1,2})(?:\\/${SEGMENT}+)+\\/?`,
  "g",
);
const ABSOLUTE_PATH_RE = new RegExp(
  `${PATH_PREFIX}\\/(?:${SEGMENT}+\\/)+${SEGMENT}*`,
  "g",
);
// A lone "/segment" is only treated as a path when it ends in a file extension
// (/k.json, /key.pem). Bare "/", "/v1" or "/users" in prose are left alone, since
// single-segment redaction without that anchor would mangle ordinary text.
const SINGLE_SEGMENT_FILE_RE = new RegExp(
  `${PATH_PREFIX}\\/${SEGMENT}*[A-Za-z0-9_]\\.[A-Za-z0-9]{1,8}(?![\\w/])`,
  "g",
);

/**
 * Redact credential-bearing and (optionally) filesystem details from an error
 * message: private-key blocks, bearer/OAuth/refresh tokens, API keys, emails
 * and, unless `paths` is false, absolute/relative/home/UNC/Windows paths.
 *
 * @param {unknown} message
 * @param {{paths?: boolean}} [options] paths:false skips path redaction only.
 */
export function redactMessage(message, { paths = true } = {}) {
  let raw = String(message ?? "");
  // Cap first: several patterns are super-linear on huge echoed input.
  if (raw.length > MAX_REDACT_LENGTH) raw = `${raw.slice(0, MAX_REDACT_LENGTH)}…`;
  let out = raw
    .replace(PRIVATE_KEY_RE, "[redacted private key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, "[redacted token]")
    .replace(/\b1\/\/0[A-Za-z0-9_-]+/g, "[redacted token]")
    .replace(/\bAIza[0-9A-Za-z_-]{35,}/g, "[redacted key]")
    .replace(
      /[A-Za-z0-9._-]+@[A-Za-z0-9.-]*\.iam\.gserviceaccount\.com/gi,
      "[redacted account]",
    )
    .replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
      "[redacted email]",
    );
  if (paths) {
    out = out
      .replace(/(^|[\s"'(=:,`])\\\\[^\s"'<>|:*?]+/g, "$1[redacted path]")
      .replace(/\b[A-Za-z]:\\[^\s"'<>|:*?]*/g, "[redacted path]")
      .replace(RELATIVE_PATH_RE, "$1[redacted path]")
      .replace(ABSOLUTE_PATH_RE, "$1[redacted path]")
      .replace(SINGLE_SEGMENT_FILE_RE, "$1[redacted path]");
  }
  return out;
}

/**
 * Map an error to structured fields ({ code, hint, indexUrl }) or null when
 * the error has no special handling. Never includes stacks or paths.
 */
export function mapError(error) {
  const message = String(error?.message ?? error ?? "");

  if (/requires an index/i.test(message)) {
    const match = /https:\/\/console\.firebase\.google\.com\/[^\s"'<>]+/.exec(message);
    const indexUrl = match ? match[0].replace(/[.,;)]+$/, "") : undefined;
    const mapped = {
      code: "FAILED_PRECONDITION_INDEX",
      hint: indexUrl
        ? `Create the index at indexUrl, or drop orderBy / a range filter and sort client-side.`
        : `Create the composite index in the Firebase console, or drop orderBy / a range filter and sort client-side.`,
    };
    if (indexUrl) mapped.indexUrl = indexUrl;
    return mapped;
  }

  if (isAuthError(error)) return { code: "AUTH_EXPIRED", hint: AUTH_HINT };

  if (/descending key scan/i.test(message)) {
    return {
      code: "UNSUPPORTED_DESCENDING_KEY_SCAN",
      hint: "Firestore cannot order by document ID descending. Order by a real field (e.g. a timestamp) with direction desc, or use ascending document-ID order.",
    };
  }

  return null;
}
