import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// Editors and Gradle daemons may retain the PATH from before rustup was installed.
const cargoBin = join(process.env.CARGO_HOME || join(homedir(), ".cargo"), "bin");
const cargoExecutable = process.platform === "win32" ? "cargo.exe" : "cargo";
if (existsSync(join(cargoBin, cargoExecutable))) {
  process.env.PATH = [process.env.PATH, cargoBin].filter(Boolean).join(delimiter);
}

for (const [binary, args] of [
  ["cargo", ["--version"]],
  ["rustc", ["--version"]],
]) {
  const result = spawnSync(binary, args, { stdio: "pipe" });
  if (result.error || result.status !== 0) {
    console.error(
      `Simulation Studio requires ${binary}. Install Rust from https://rustup.rs, restart your terminal/VS Code, and retry.`,
    );
    process.exit(1);
  }
}
