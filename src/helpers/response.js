import {
  mapError,
  redactMessage,
  debugEnabled,
  isValidationError,
  AUTH_ERROR_MESSAGE,
} from "./errors.js";

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
 * Build an MCP error response. Stack traces and unredacted messages appear only
 * when MCP_FIRESTORE_DEBUG is set (see debugEnabled). Outside debug mode,
 * auth errors get a static message (the hint carries the guidance) and
 * InputValidationErrors keep caller-supplied paths but still have secrets redacted.
 */
export function buildErrorResponse(error) {
  const debug = debugEnabled();
  const message = String(error?.message ?? error);
  const mapped = mapError(error);
  let text = message;
  if (!debug) {
    if (mapped?.code === "AUTH_EXPIRED") text = AUTH_ERROR_MESSAGE;
    else text = redactMessage(message, { paths: !isValidationError(error) });
  }
  const payload = { error: text, ...mapped };
  if (debug) {
    payload.stack = error?.stack;
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
