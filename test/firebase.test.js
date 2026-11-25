import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initFirebase, getDb, resetTarget, isValidProjectId } from "../src/firebase.js";

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

/** Run fn with the given env overrides, restoring process.env afterwards. */
async function withEnv(overrides, fn) {
  const saved = { ...process.env };
  for (const k of [
    "GOOGLE_CLOUD_PROJECT",
    "FIREBASE_PROJECT_ID",
    "FIRESTORE_EMULATOR_HOST",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "MCP_FIRESTORE_DEFAULT_TARGET",
  ]) {
    delete process.env[k];
  }
  Object.assign(process.env, { GOOGLE_CLOUD_PROJECT: "demo-test" }, overrides);
  for (const [k, v] of Object.entries(overrides))
    if (v === undefined) delete process.env[k];
  const origError = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = origError;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

const BOTH = {
  FIRESTORE_EMULATOR_HOST: "localhost:8080",
  GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/key.json",
};

function assertIsolation() {
  const emu = getDb("emulator").db._settings;
  assert.equal(emu.servicePath, "localhost");
  assert.equal(emu.port, 8080);
  assert.equal(emu.ssl, false);
  const prod = getDb("production").db._settings;
  assert.notEqual(prod.servicePath, "localhost");
  assert.notEqual(prod.ssl, false);
  assert.notEqual(prod.port, 8080);
}

test("target isolation: emulator client is bound to the emulator, production is not", async () => {
  await withEnv(BOTH, async () => {
    initFirebase();
    assertIsolation();
    await resetTarget("emulator");
    assertIsolation();
    await resetTarget("production");
    assertIsolation();
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "localhost:8080");
  });
});

test("default target: unset keeps existing logic", async () => {
  await withEnv(BOTH, async () => {
    assert.equal(initFirebase().defaultTarget, "emulator");
  });
  await withEnv({ GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/key.json" }, async () => {
    assert.equal(initFirebase().defaultTarget, "production");
  });
});

test("default target: valid values are normalised and honoured", async () => {
  await withEnv({ ...BOTH, MCP_FIRESTORE_DEFAULT_TARGET: "  Production " }, async () => {
    assert.equal(initFirebase().defaultTarget, "production");
  });
  await withEnv({ ...BOTH, MCP_FIRESTORE_DEFAULT_TARGET: "EMULATOR" }, async () => {
    assert.equal(initFirebase().defaultTarget, "emulator");
  });
});

test("default target: a typo throws and lists available targets", async () => {
  await withEnv({ ...BOTH, MCP_FIRESTORE_DEFAULT_TARGET: "prod" }, async () => {
    assert.throws(
      () => initFirebase(),
      /Invalid MCP_FIRESTORE_DEFAULT_TARGET "prod".*"emulator" or "production".*emulator, production/,
    );
  });
});

test("default target: valid but unavailable target throws", async () => {
  await withEnv(
    {
      GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/key.json",
      MCP_FIRESTORE_DEFAULT_TARGET: "emulator",
    },
    async () => {
      assert.throws(
        () => initFirebase(),
        /"emulator" but that target is not available.*Available targets: production/,
      );
    },
  );
});

test("project id: invalid values are rejected without echoing more than 40 chars", async () => {
  for (const bad of ["has space", "-lead", `x${"y".repeat(100)}!`]) {
    await withEnv({ ...BOTH, GOOGLE_CLOUD_PROJECT: bad }, async () => {
      assert.throws(
        () => initFirebase(),
        err => {
          assert.match(err.message, /Invalid Google Cloud project ID/);
          assert.ok(!err.message.includes("y".repeat(41)));
          return true;
        },
      );
    });
  }
});

test("project id: control characters are sanitised in the error", async () => {
  await withEnv({ ...BOTH, GOOGLE_CLOUD_PROJECT: "bad\u001b[31m\nid" }, async () => {
    assert.throws(
      () => initFirebase(),
      err => [...err.message].every(c => c.charCodeAt(0) >= 0x20),
    );
  });
});

test("project id: valid ids are accepted", async () => {
  // One id only: firebase-admin apps are process-global and keep their first projectId.
  await withEnv(BOTH, async () => {
    assert.equal(initFirebase().projectId, "demo-test");
  });
});

test("isValidProjectId: accepts loose emulator-style ids", () => {
  for (const ok of [
    "My_Test",
    "demo-test",
    "example.com:my-project",
    "a",
    "x".repeat(63),
  ]) {
    assert.equal(isValidProjectId(ok), true, ok);
  }
});

test("isValidProjectId: rejects whitespace, control chars, quotes, overlong and non-strings", () => {
  for (const bad of [
    "has space",
    "line\nbreak",
    'quo"te',
    "it's",
    "-lead",
    "",
    "x".repeat(64),
    undefined,
    42,
  ]) {
    assert.equal(isValidProjectId(bad), false, String(bad));
  }
});

test("project id: newline-bearing .firebaserc value never reaches stderr and startup fails", async () => {
  const evil = "demo\n[production] WRITE delete_document users/admin";
  const dir = mkdtempSync(join(tmpdir(), "mcp-fs-rc-"));
  writeFileSync(
    join(dir, ".firebaserc"),
    JSON.stringify({ projects: { default: evil } }),
  );
  const origCwd = process.cwd();
  const origPath = process.env.PATH;
  const savedGcloud = process.env.GCLOUD_PROJECT;
  delete process.env.GCLOUD_PROJECT;
  try {
    await withEnv({ ...BOTH, GOOGLE_CLOUD_PROJECT: undefined }, async () => {
      const logged = [];
      console.error = (...args) => logged.push(args.join(" "));
      process.chdir(dir);
      process.env.PATH = dir; // no gcloud
      assert.throws(
        () => initFirebase(),
        err => {
          assert.match(
            err.message,
            /Invalid Google Cloud project ID "demo\?\[production\]/,
          );
          assert.ok(![...err.message].some(c => c.charCodeAt(0) < 0x20));
          return true;
        },
      );
      assert.ok(
        logged.every(line => !line.includes("WRITE") && !line.includes("demo")),
        `file content leaked to stderr: ${JSON.stringify(logged)}`,
      );
    });
  } finally {
    process.chdir(origCwd);
    process.env.PATH = origPath;
    if (savedGcloud !== undefined) process.env.GCLOUD_PROJECT = savedGcloud;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project id: non-string .firebaserc value is rejected, not coerced", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-fs-rc-"));
  writeFileSync(
    join(dir, ".firebaserc"),
    JSON.stringify({ projects: { default: ["demo-test"] } }),
  );
  const origCwd = process.cwd();
  const origPath = process.env.PATH;
  const savedGcloud = process.env.GCLOUD_PROJECT;
  delete process.env.GCLOUD_PROJECT;
  try {
    await withEnv({ ...BOTH, GOOGLE_CLOUD_PROJECT: undefined }, async () => {
      process.chdir(dir);
      process.env.PATH = dir;
      assert.throws(() => initFirebase(), /Invalid Google Cloud project ID/);
    });
  } finally {
    process.chdir(origCwd);
    process.env.PATH = origPath;
    if (savedGcloud !== undefined) process.env.GCLOUD_PROJECT = savedGcloud;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project id: the one log line names a fixed source label", async () => {
  await withEnv(BOTH, async () => {
    const logged = [];
    console.error = (...args) => logged.push(args.join(" "));
    initFirebase();
    assert.ok(logged.includes("Project ID: demo-test (from GOOGLE_CLOUD_PROJECT)"));
  });
});

test("project id: object with a toString key gives the designed error, nothing leaks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-fs-rc-"));
  writeFileSync(
    join(dir, ".firebaserc"),
    JSON.stringify({ projects: { default: { toString: "x" } } }),
  );
  const origCwd = process.cwd();
  const origPath = process.env.PATH;
  const savedGcloud = process.env.GCLOUD_PROJECT;
  delete process.env.GCLOUD_PROJECT;
  try {
    await withEnv({ ...BOTH, GOOGLE_CLOUD_PROJECT: undefined }, async () => {
      const logged = [];
      console.error = (...args) => logged.push(args.join(" "));
      process.chdir(dir);
      process.env.PATH = dir;
      assert.throws(
        () => initFirebase(),
        err => {
          assert.ok(!(err instanceof TypeError));
          assert.match(err.message, /Invalid Google Cloud project ID "<object>"/);
          return true;
        },
      );
      assert.ok(
        logged.every(line => !line.includes("toString")),
        `file content leaked to stderr: ${JSON.stringify(logged)}`,
      );
    });
  } finally {
    process.chdir(origCwd);
    process.env.PATH = origPath;
    if (savedGcloud !== undefined) process.env.GCLOUD_PROJECT = savedGcloud;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("initFirebase: returns the fixed project source label", async () => {
  await withEnv(BOTH, async () => {
    assert.equal(initFirebase().projectSource, "GOOGLE_CLOUD_PROJECT");
  });
});
