import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import "./check-prerequisites.mjs";
const notices = spawnSync(process.execPath, ["scripts/generate-notices.mjs"], { stdio: "inherit" });
if (notices.status !== 0) process.exit(notices.status ?? 1);
const flags =
  process.platform === "darwin" ? ["--bundles", "app"] : ["--no-bundle"];
const result = spawnSync(
  process.execPath,
  [resolve("node_modules/@tauri-apps/cli/tauri.js"), "build", ...flags],
  { stdio: "inherit" },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
