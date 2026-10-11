import { mapError, redactMessage } from "./errors.js";

/**
 * Build a standard MCP tool response.
 */
export function buildResponse(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Whether to include stack traces in error responses. Off by default to avoid
 * leaking internal paths to the client; enable with MCP_FIRESTORE_DEBUG or DEBUG.
 */
function debugEnabled() {
  return Boolean(process.env.MCP_FIRESTORE_DEBUG || process.env.DEBUG);
}

/**
 * Build an MCP error response. Includes the stack trace only when a debug
 * environment variable is set.
 */
export function buildErrorResponse(error) {
  const debug = debugEnabled();
  const message = String(error?.message ?? error);
  const payload = { error: debug ? message : redactMessage(message), ...mapError(error) };
  if (debug) {
    payload.stack = error.stack;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError: true,
  };
}
