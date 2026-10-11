import { test } from "node:test";
import assert from "node:assert/strict";
import { initFirebase, getDb, resetTarget } from "../src/firebase.js";

test("resetTarget: re-creates only that target and restores env", async () => {
  const saved = { ...process.env };
  process.env.GOOGLE_CLOUD_PROJECT = "demo-test";
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/nonexistent/key.json";
  try {
    initFirebase();
    const emu = getDb("emulator").db;
    const prod = getDb("production").db;

    await resetTarget("production");

    assert.notEqual(getDb("production").db, prod);
    assert.equal(getDb("emulator").db, emu);
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "localhost:8080");

    await resetTarget("emulator");
    assert.notEqual(getDb("emulator").db, emu);
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "localhost:8080");

    await assert.rejects(() => resetTarget("bogus"), /Unknown target/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
