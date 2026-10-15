import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const PLATFORMS = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"];
export function assemble(directory, version, verify = false) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Only stable semantic versions can be published.");
  const descriptors = readdirSync(directory).filter(name => name.startsWith("artifact-") && name.endsWith(".json")).sort().map(name => JSON.parse(readFileSync(join(directory, name), "utf8")));
  if (descriptors.length !== PLATFORMS.length || new Set(descriptors.map(d => d.platform)).size !== PLATFORMS.length || descriptors.some(d => !PLATFORMS.includes(d.platform))) throw Error("Every supported platform must have exactly one artifact descriptor.");
  const manifest = { version, platforms: {} };
  const hashes = new Map();
  for (const descriptor of descriptors) {
    if (descriptor.version !== version || !descriptor.signature?.trim()) throw Error("Release version or updater signature is missing/mismatched.");
    for (const file of descriptor.files) {
      if (basename(file.name) !== file.name || !file.name.startsWith(`Simulation-Studio_${version}_${descriptor.platform}`)) throw Error("Invalid release filename.");
      const actual = createHash("sha256").update(readFileSync(join(directory, file.name))).digest("hex");
      if (actual !== file.sha256 || hashes.has(file.name)) throw Error("Release checksum mismatch or duplicate asset.");
      hashes.set(file.name, actual);
    }
    if (!hashes.has(descriptor.updater) || !hashes.has(`${descriptor.updater}.sig`) || readFileSync(join(directory, `${descriptor.updater}.sig`), "utf8").trim() !== descriptor.signature) throw Error("Updater package/signature is missing or inconsistent.");
    if (descriptor.platform.startsWith("darwin") && !descriptor.files.some(f => f.name.endsWith(".pkg"))) throw Error("macOS installer is missing.");
    manifest.platforms[descriptor.platform] = { signature: descriptor.signature, url: `https://github.com/simonstoryparker/simulation-studio/releases/download/v${version}/${encodeURIComponent(descriptor.updater)}` };
  }
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  hashes.set("latest.json", createHash("sha256").update(manifestJson).digest("hex"));
  const sums = [...hashes].sort(([a], [b]) => a.localeCompare(b)).map(([name, hash]) => `${hash}  ${name}`).join("\n") + "\n";
  if (verify) {
    if (readFileSync(join(directory, "latest.json"), "utf8") !== manifestJson || readFileSync(join(directory, "SHA256SUMS"), "utf8") !== sums) throw Error("Published manifest or checksums differ from the verified artifacts.");
  } else {
    writeFileSync(join(directory, "latest.json"), manifestJson);
    writeFileSync(join(directory, "SHA256SUMS"), sums);
  }
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) assemble(process.argv[2], process.argv[3], process.argv.includes("--verify"));
