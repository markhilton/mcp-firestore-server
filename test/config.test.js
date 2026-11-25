import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectId } from "../src/config.js";

const PROJECT_ENV_VARS = [
  "GOOGLE_CLOUD_PROJECT",
  "FIREBASE_PROJECT_ID",
  "GCLOUD_PROJECT",
];

let saved;

beforeEach(() => {
  saved = {};
  for (const key of PROJECT_ENV_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PROJECT_ENV_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("detectProjectId: GOOGLE_CLOUD_PROJECT takes precedence", () => {
  process.env.GOOGLE_CLOUD_PROJECT = "from-google-cloud";
  process.env.FIREBASE_PROJECT_ID = "from-firebase";
  assert.deepEqual(detectProjectId(), {
    projectId: "from-google-cloud",
    source: "GOOGLE_CLOUD_PROJECT",
  });
});

test("detectProjectId: falls back to FIREBASE_PROJECT_ID", () => {
  process.env.FIREBASE_PROJECT_ID = "from-firebase";
  assert.deepEqual(detectProjectId(), {
    projectId: "from-firebase",
    source: "FIREBASE_PROJECT_ID",
  });
});

test("detectProjectId: falls back to GCLOUD_PROJECT", () => {
  process.env.GCLOUD_PROJECT = "from-gcloud-env";
  assert.deepEqual(detectProjectId(), {
    projectId: "from-gcloud-env",
    source: "GCLOUD_PROJECT",
  });
});

/** Run detectProjectId in a scratch dir with the given files, no env vars, no gcloud. */
function detectInDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-fs-config-"));
  const origCwd = process.cwd();
  const origPath = process.env.PATH;
  const origError = console.error;
  const logged = [];
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(content));
  }
  try {
    process.chdir(dir);
    process.env.PATH = dir; // no gcloud
    console.error = (...args) => logged.push(args.join(" "));
    return { result: detectProjectId(), logged };
  } finally {
    console.error = origError;
    process.env.PATH = origPath;
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detectProjectId: file sources return a fixed label and log nothing", () => {
  const rc = detectInDir({ ".firebaserc": { projects: { default: "rc-proj" } } });
  assert.deepEqual(rc.result, { projectId: "rc-proj", source: ".firebaserc" });
  assert.deepEqual(rc.logged, []);
  const fj = detectInDir({ "firebase.json": { projects: { default: "fj-proj" } } });
  assert.deepEqual(fj.result, { projectId: "fj-proj", source: "firebase.json" });
  assert.deepEqual(fj.logged, []);
});

test("detectProjectId: hostile file values are returned uncoerced and never logged", () => {
  const evil = "demo\n[production] WRITE delete_document users/admin";
  const a = detectInDir({ ".firebaserc": { projects: { default: evil } } });
  assert.equal(a.result.projectId, evil);
  assert.deepEqual(a.logged, []);
  const obj = { toString: "x" };
  const b = detectInDir({ ".firebaserc": { projects: { default: obj } } });
  assert.deepEqual(b.result.projectId, obj);
  assert.deepEqual(b.logged, []);
});
