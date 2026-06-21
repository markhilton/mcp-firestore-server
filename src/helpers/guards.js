import { TARGETS } from "../constants.js";

/**
 * Guard against accidental writes to the production Firestore.
 *
 * Writes against the emulator are always allowed (frictionless local dev).
 * Writes against production require an explicit `confirm: true` in the tool
 * args, so an LLM cannot mutate live data without a deliberate opt-in.
 *
 * @param {string} target - Resolved target ("emulator" | "production").
 * @param {object} args - The tool arguments (checked for `confirm`).
 * @throws {Error} When writing to production without `confirm: true`.
 */
export function assertWriteAllowed(target, args) {
  if (target === TARGETS.PRODUCTION && args?.confirm !== true) {
    throw new Error(
      "Refusing production write: pass confirm:true to write to the production target (target=production).",
    );
  }
}
