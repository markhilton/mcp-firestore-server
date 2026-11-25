import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process"; // secret-scan:allow test runs npm pack --dry-run and git ls-files only
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const packed = (() => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out)[0].files.map(f => f.path);
})();

test("package contents: only allow-listed paths are packed", () => {
  assert.ok(packed.length > 0);
  const allowed = /^(package\.json|README\.md|LICENSE|index\.js|src\/[\w./-]+\.js)$/;
  const bad = packed.filter(p => !allowed.test(p));
  assert.deepEqual(bad, []);
});

test("package contents: no harness, test, CI or credential-like files", () => {
  const forbiddenDir = /^(CLAUDE\.md|\.claude|test|scripts|\.github)(\/|$)/;
  for (const p of packed) {
    const base = p.split("/").pop();
    assert.ok(!forbiddenDir.test(p), `${p} must not be packed`);
    assert.ok(!base.startsWith("."), `${p} is a dotfile`);
    assert.ok(!/^\.env/.test(base), `${p} is an env file`);
    assert.ok(!/\.(pem|key)$/.test(base), `${p} is a key file`);
    assert.ok(
      !(base.endsWith(".json") && p !== "package.json"),
      `${p} is a json file other than package.json`,
    );
  }
});

test("package contents: no packed file contains credential-shaped content", () => {
  const shapes = [
    /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    /"private_key"\s*:/,
    /"type"\s*:\s*"service_account"/,
    /\bnpm_[A-Za-z0-9]{36}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /\bya29\.[A-Za-z0-9_-]{20,}/,
  ];
  for (const p of packed) {
    const content = readFileSync(join(root, p), "utf8");
    for (const re of shapes) {
      assert.ok(!re.test(content), `${p} matches credential shape ${re}`);
    }
  }
});

test("package contents: .claude is not tracked by git", t => {
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", ".claude"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    t.skip("not inside a git work tree");
    return;
  }
  assert.equal(tracked.trim(), "");
});
