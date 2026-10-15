import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
const result = spawnSync("cargo", ["metadata", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--format-version", "1"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw Error(result.stderr);
const crates = JSON.parse(result.stdout).packages;
const lock = JSON.parse(readFileSync("package-lock.json"));
let output = "Simulation Studio third-party dependency notices\n\n";
function append(name, version, license, directory, licenseFile) {
  output += `\n========== ${name} ${version} ==========\nLicense: ${license ?? "See included license files / upstream registry"}\n`;
  const files = readdirSync(directory).filter(file => /^(license|licence|copying|notice)([._-]|$)/i.test(file));
  if (licenseFile && !files.includes(licenseFile)) files.push(licenseFile);
  for (const file of files) {
    const path = isAbsolute(file) ? file : join(directory, file);
    try { output += `\n--- ${basename(file)} ---\n${readFileSync(path, "utf8")}\n`; } catch (error) { if (error.code !== "EISDIR") throw error; }
  }
}
for (const [directory, info] of Object.entries(lock.packages)) {
  if (!directory || !existsSync(join(directory, "package.json"))) continue;
  const pkg = JSON.parse(readFileSync(join(directory, "package.json")));
  append(pkg.name, pkg.version, typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license), directory);
}
for (const crate of crates.filter(crate => crate.source)) append(crate.name, crate.version, crate.license, crate.manifest_path.replace(/[\\/][^\\/]+$/, ""), crate.license_file);
mkdirSync("src-tauri/resources", { recursive: true });
writeFileSync("src-tauri/resources/THIRD_PARTY_NOTICES.txt", output);
console.log(`Generated notices for locked npm dependencies and ${crates.length - 1} Rust crates.`);
