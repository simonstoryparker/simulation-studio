// Prepare a disposable copy of the real app as version 0.0.0. Production is untouched.
import { cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(process.argv[2]);
const version = JSON.parse(readFileSync('package.json')).version;
mkdirSync(root, { recursive: true });
for (const name of ['src', 'src-tauri', 'scripts', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'THIRD_PARTY_NOTICES.md']) {
  cpSync(name, join(root, name), { recursive: true, filter: path => !/[/\\](target|gen)([/\\]|$)/.test(path) });
}
const edit = (file, from, to) => {
  const path = join(root, file), content = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  if (!content.includes(from)) throw Error(`Cannot instrument ${file}`);
  writeFileSync(path, content.replace(from, to));
};
edit('package.json', `"version": "${version}"`, '"version": "0.0.0"');
edit('src-tauri/Cargo.lock', `name = "simulation-studio"\nversion = "${version}"`, 'name = \"simulation-studio\"\nversion = \"0.0.0\"');
edit('src-tauri/Cargo.toml', `version = "${version}"`, 'version = "0.0.0"');
edit('src-tauri/src/main.rs', 'tauri::async_runtime::spawn(updates::periodic(state));', 'tauri::async_runtime::spawn(updates::smoke(state));');
edit('src-tauri/src/updates.rs', '.updater_builder()\n        .pubkey(key)', '.updater_builder()\n        .endpoints(vec![std::env::var("STUDIO_SMOKE_FEED").unwrap().parse().unwrap()]).unwrap()\n        .pubkey(key)');
const updates = join(root, 'src-tauri/src/updates.rs');
writeFileSync(updates, readFileSync(updates, 'utf8') + '\n' + readFileSync('tests/installation/driver.rs', 'utf8'));
const configPath = join(root, 'src-tauri/tauri.conf.json');
const config = JSON.parse(readFileSync(configPath));
config.version = '0.0.0';
config.bundle.createUpdaterArtifacts = false;
config.plugins.updater.dangerousInsecureTransportProtocol = true; // Loopback fixture only.
config.bundle.targets = process.platform === 'win32' ? ['nsis'] : ['app'];
writeFileSync(configPath, JSON.stringify(config, null, 2));
writeFileSync(join(root, 'src-tauri/resources/smoke-obsolete.txt'), 'Obsolete file from older test app');
