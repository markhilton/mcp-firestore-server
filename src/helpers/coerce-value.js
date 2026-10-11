/**
 * Coerce string values to appropriate Firestore types.
 * Handles: numbers, booleans, null, arrays, and JSON objects.
 * To force a string (e.g. a digit-only zip code), send {"$string": "33101"};
 * it is JSON-parsed here and unwrapped by typed-values.js.
 */
export function coerceValue(value) {
  if (typeof value !== "string") return value;

  // Booleans
  if (value === "true") return true;
  if (value === "false") return false;

  // Null
  if (value === "null") return null;

  // Numbers (integers and floats)
  if (/^-?\d+(\.\d+)?$/.test(value) && !isNaN(Number(value))) {
    return Number(value);
  }

  // JSON arrays or objects
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      // Not valid JSON, return as string
    }
  }

  return value;
}
