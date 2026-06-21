import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWriteAllowed } from "../../src/helpers/guards.js";
import { TARGETS } from "../../src/constants.js";

test("assertWriteAllowed: allows emulator writes without confirm", () => {
  assert.doesNotThrow(() => assertWriteAllowed(TARGETS.EMULATOR, {}));
  assert.doesNotThrow(() => assertWriteAllowed(TARGETS.EMULATOR, { confirm: false }));
});

test("assertWriteAllowed: blocks production writes without confirm:true", () => {
  assert.throws(() => assertWriteAllowed(TARGETS.PRODUCTION, {}), /production/i);
  assert.throws(
    () => assertWriteAllowed(TARGETS.PRODUCTION, { confirm: false }),
    /confirm:true/,
  );
  assert.throws(
    () => assertWriteAllowed(TARGETS.PRODUCTION, { confirm: "true" }),
    /confirm:true/,
  );
});

test("assertWriteAllowed: allows production writes with confirm:true", () => {
  assert.doesNotThrow(() => assertWriteAllowed(TARGETS.PRODUCTION, { confirm: true }));
});

test("assertWriteAllowed: undefined target is treated as non-production", () => {
  assert.doesNotThrow(() => assertWriteAllowed(undefined, {}));
});
