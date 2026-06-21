import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(detectProjectId(), "from-google-cloud");
});

test("detectProjectId: falls back to FIREBASE_PROJECT_ID", () => {
  process.env.FIREBASE_PROJECT_ID = "from-firebase";
  assert.equal(detectProjectId(), "from-firebase");
});

test("detectProjectId: falls back to GCLOUD_PROJECT", () => {
  process.env.GCLOUD_PROJECT = "from-gcloud-env";
  assert.equal(detectProjectId(), "from-gcloud-env");
});
