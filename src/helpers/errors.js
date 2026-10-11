/**
 * Error classification and LLM-friendly mapping for Firestore failures.
 */

const AUTH_PATTERNS = [
  /invalid_grant/i,
  /reauth/i,
  /Could not load the default credentials/i,
  /UNAUTHENTICATED/,
];

const AUTH_HINT =
  "Application Default Credentials expired or are missing. Run `gcloud auth application-default login` " +
  "(or fix GOOGLE_APPLICATION_CREDENTIALS), then retry — the server re-initialises credentials automatically, no restart needed.";

/** True when the error looks like an expired/missing credential failure. */
export function isAuthError(error) {
  const message = String(error?.message ?? error ?? "");
  if (error?.code === 16) return true; // gRPC UNAUTHENTICATED
  return AUTH_PATTERNS.some(re => re.test(message));
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
