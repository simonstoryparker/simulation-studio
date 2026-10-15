import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const version = JSON.parse(readFileSync("package.json")).version;
const cargoVersion = readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version = "([^"]+)"/m)[1];
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json"));
const target = process.argv[2];
const platforms = { "aarch64-apple-darwin": "darwin-aarch64", "x86_64-apple-darwin": "darwin-x86_64", "x86_64-pc-windows-msvc": "windows-x86_64" };
const platform = platforms[target];
if (!platform || version !== config.version || version !== cargoVersion || process.env.GITHUB_REF_NAME !== `v${version}`) throw Error("Release target, tag and all app versions must match.");
for (const name of ["STUDIO_UPDATER_PUBLIC_KEY", "TAURI_SIGNING_PRIVATE_KEY"]) {
  if (!process.env[name]?.trim()) throw Error(`Missing release credential: ${name}`);
}
const override = { bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: process.env.STUDIO_UPDATER_PUBLIC_KEY } } };
// Match Dashshund: ad-hoc macOS signing, no Authenticode signing.
// Updater signatures remain mandatory on every platform.
if (platform.startsWith("darwin")) override.bundle.macOS = { signingIdentity: "-" };
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})`);
}
run(process.execPath, ["scripts/generate-notices.mjs"]);
run(process.execPath, [resolve("node_modules/@tauri-apps/cli/tauri.js"), "build", "--target", target, "--bundles", platform.startsWith("darwin") ? "app,dmg" : "nsis", "--config", JSON.stringify(override)]);
mkdirSync("release", { recursive: true });
const bundleDir = `src-tauri/target/${target}/release/bundle`;
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? (entry.name.endsWith(".app") ? [] : walk(join(dir, entry.name))) : [join(dir, entry.name)]); }
const suffix = platform.startsWith("darwin") ? ".app.tar.gz" : "-setup.exe";
const candidates = walk(bundleDir).filter(file => file.endsWith(suffix));
if (candidates.length !== 1) throw Error(`Expected one updater package ending ${suffix}`);
const updater = candidates[0];
const name = `Simulation-Studio_${version}_${platform}${platform.startsWith("darwin") ? ".app.tar.gz" : "-setup.exe"}`;
copyFileSync(updater, `release/${name}`);
copyFileSync(`${updater}.sig`, `release/${name}.sig`);
const installers = [name];
if (platform.startsWith("darwin")) {
  const images = walk(bundleDir).filter(file => file.endsWith(".dmg"));
  if (images.length !== 1) throw Error("Expected one macOS DMG installer.");
  const dmgName = `Simulation-Studio_${version}_${platform}.dmg`;
  copyFileSync(images[0], `release/${dmgName}`);
  installers.push(dmgName);
}
const files = [...new Set([...installers, `${name}.sig`])].map(file => ({ name: file, sha256: createHash("sha256").update(readFileSync(`release/${file}`)).digest("hex") }));
writeFileSync(`release/artifact-${platform}.json`, JSON.stringify({ version, platform, updater: name, signature: readFileSync(`${updater}.sig`, "utf8").trim(), files }, null, 2) + "\n");
