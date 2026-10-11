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
  if (error?.code === 16 || error?.code === "UNAUTHENTICATED") return true;
  if (error?.response?.data?.error === "invalid_grant") return true;
  const message = String(error?.message ?? error ?? "");
  return AUTH_MESSAGE_PATTERNS.some(re => re.test(message));
}

const PRIVATE_KEY_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

/**
 * Redact credential-bearing and filesystem details from an error message:
 * private-key blocks, bearer/OAuth tokens, service-account emails and absolute paths.
 */
export function redactMessage(message) {
  return String(message ?? "")
    .replace(PRIVATE_KEY_RE, "[redacted private key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, "[redacted token]")
    .replace(
      /[A-Za-z0-9._-]+@[A-Za-z0-9.-]*\.iam\.gserviceaccount\.com/gi,
      "[redacted account]",
    )
    .replace(/\b[A-Za-z]:\\[^\s"'<>|:*?]*/g, "[redacted path]")
    .replace(/(^|[\s"'(=:])\/(?:[\w.@~+-]+\/)+[\w.@~+-]*/g, "$1[redacted path]");
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
