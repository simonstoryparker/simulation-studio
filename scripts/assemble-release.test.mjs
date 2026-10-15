import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { assemble, PLATFORMS } from "./assemble-release.mjs";
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), "studio-release-"));
  try {
    for (const platform of PLATFORMS) {
      const updater = `Simulation-Studio_0.1.0_${platform}${platform.startsWith("darwin") ? ".app.tar.gz" : "-setup.exe"}`;
      const names = [updater, `${updater}.sig`, ...(platform.startsWith("darwin") ? [`Simulation-Studio_0.1.0_${platform}.pkg`] : [])];
      const files = names.map(name => { writeFileSync(join(dir, name), name.endsWith(".sig") ? "test-signature" : name); return { name, sha256: createHash("sha256").update(readFileSync(join(dir, name))).digest("hex") }; });
      writeFileSync(join(dir, `artifact-${platform}.json`), JSON.stringify({ version: "0.1.0", platform, updater, signature: "test-signature", files }));
    }
    run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("assembles a complete three-platform feed and verifies the same assets", () => fixture(dir => {
  const manifest = assemble(dir, "0.1.0");
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [...PLATFORMS].sort());
  assert.match(manifest.platforms["windows-x86_64"].url, /releases\/download\/v0.1.0/);
  assemble(dir, "0.1.0", true);
}));
test("rejects missing architectures rather than publishing a partial update", () => fixture(dir => {
  unlinkSync(join(dir, "artifact-darwin-aarch64.json"));
  assert.throws(() => assemble(dir, "0.1.0"), /Every supported platform/);
}));
test("rejects changed packages", () => fixture(dir => {
  writeFileSync(join(dir, "Simulation-Studio_0.1.0_windows-x86_64-setup.exe"), "tampered");
  assert.throws(() => assemble(dir, "0.1.0"), /checksum/);
}));
test("rejects missing signatures and mismatched versions", () => fixture(dir => {
  assert.throws(() => assemble(dir, "0.2.0"), /version/);
  unlinkSync(join(dir, "Simulation-Studio_0.1.0_windows-x86_64-setup.exe.sig"));
  assert.throws(() => assemble(dir, "0.1.0"));
}));
test("publication refuses a changed update feed", () => fixture(dir => {
  assemble(dir, "0.1.0");
  writeFileSync(join(dir, "latest.json"), "{}");
  assert.throws(() => assemble(dir, "0.1.0", true), /manifest/);
}));
