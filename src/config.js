import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process"; // secret-scan:allow — fixed `gcloud config get-value project`, no interpolation

/**
 * Auto-detect Google Cloud Project ID from environment, gcloud config,
 * or Firebase config files.
 *
 * Returns `{ projectId, source }`. `source` is a fixed label chosen by this code,
 * never text read from a file. `projectId` is returned exactly as found (it may be
 * unvalidated, even a non-string, when it came from a file or gcloud) and is
 * `null` when nothing was found. This function logs nothing: the caller must
 * validate `projectId` before it writes it anywhere.
 */
export function detectProjectId() {
  // 1. Check environment variables
  for (const name of ["GOOGLE_CLOUD_PROJECT", "FIREBASE_PROJECT_ID", "GCLOUD_PROJECT"]) {
    if (process.env[name]) return { projectId: process.env[name], source: name };
  }

  // 2. Try to get from gcloud config
  try {
    const gcloudProject = execSync("gcloud config get-value project 2>/dev/null", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gcloudProject) return { projectId: gcloudProject, source: "gcloud config" };
  } catch (e) {
    // gcloud not installed or not configured
  }

  // 3. Check for firebase.json / .firebaserc in current and parent directories
  let currentDir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const firebaseJsonPath = join(currentDir, "firebase.json");
    if (existsSync(firebaseJsonPath)) {
      try {
        const firebaseConfig = JSON.parse(readFileSync(firebaseJsonPath, "utf8"));
        if (firebaseConfig.projects?.default) {
          return { projectId: firebaseConfig.projects.default, source: "firebase.json" };
        }
      } catch (e) {
        // Invalid firebase.json
      }
    }

    const firebasercPath = join(currentDir, ".firebaserc");
    if (existsSync(firebasercPath)) {
      try {
        const firebaserc = JSON.parse(readFileSync(firebasercPath, "utf8"));
        if (firebaserc.projects?.default) {
          return { projectId: firebaserc.projects.default, source: ".firebaserc" };
        }
      } catch (e) {
        // Invalid .firebaserc
      }
    }

    const parentDir = join(currentDir, "..");
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return { projectId: null, source: null };
}
