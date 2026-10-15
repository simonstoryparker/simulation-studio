# Signed releases and acceptance

## One-time setup

Use GitHub environments `release` (build/sign) and `public-release` (publish). Configure required reviewers for publication where the account supports them. Restrict release tags and changes to release workflows to maintainers. Never give signing secrets to pull-request workflows.

In the `release` environment configure:

| Name | Kind | Value |
|---|---|---|
| `STUDIO_UPDATER_PUBLIC_KEY` | Variable | Public key from `tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY` | Secret | Matching private key contents |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret | Key password, if used |
| `APPLE_CERTIFICATE` | Secret | Base64 Developer ID Application p12 |
| `APPLE_CERTIFICATE_PASSWORD` | Secret | Application p12 password |
| `APPLE_SIGNING_IDENTITY` | Secret | Full Developer ID Application identity |
| `APPLE_INSTALLER_CERTIFICATE` | Secret | Base64 Developer ID Installer p12 |
| `APPLE_INSTALLER_CERTIFICATE_PASSWORD` | Secret | Installer p12 password |
| `APPLE_INSTALLER_SIGNING_IDENTITY` | Secret | Full Developer ID Installer identity |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Secrets | Apple account, app-specific password, developer team |
| `STUDIO_WINDOWS_PFX_BASE64` | Secret | Base64 exportable Windows Authenticode signing certificate, including chain |
| `STUDIO_WINDOWS_PFX_PASSWORD` | Secret | PFX password |

The Windows script uses the Windows SDK SignTool and a timestamp service. If your certificate is hardware-backed or uses a managed signing provider, adapt `scripts/sign-windows.ps1` to that provider before releasing; never substitute an unsigned build. Verify the certificate is trusted on clean machines.

Generate the updater key using `npm run tauri -- signer generate -w /secure/location/studio.key`. Back up that private key and its password outside GitHub before the first release. Keep the same public key in future builds; replacing it without a trust transition breaks updates for existing installations. Platform signing and updater signing are separate requirements.

The initial extraction found no local Apple signing identity. Credentials, hosted signing configuration, and clean-machine installer checks are not pre-certified by this source change.

## Build a release

1. Bump the same stable version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
2. Run `npm run check`. Commit, then push tag `vX.Y.Z`.
3. `Build signed release` checks the app, builds macOS ARM64/Intel and Windows x64 on native runners, signs/notarizes, and creates a **draft** GitHub release. No partial release is published when a platform fails.
4. Download the draft installers and complete the acceptance checklist below. To test the updater before publication, make a local development build with `STUDIO_UPDATER_PUBLIC_KEY` set and an updater endpoint override pointing at a local test feed containing the signed draft artifacts. Never commit test endpoints or disable production TLS/signature checks. Do not use a public stable release as a test channel.
5. Run `Publish verified release` with the draft tag and `smoke_tested` checked. It verifies all platform files, hashes, signatures' manifest entries, and the update feed before publishing. Tauri verifies the cryptographic updater signature when downloading/installing. The workflow only accepts stable semantic versions.

Published `latest.json` uses `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64`. Downloads are fixed to their versioned release assets. Stable clients check `https://github.com/simonstoryparker/simulation-studio/releases/latest/download/latest.json`.

## Required platform acceptance

- Clean macOS and Windows installation with no Node/Rust; verify OS signatures/notarization, Windows WebView2 bootstrap, and default launch discovery.
- Gradle and VS Code simulation launch, paths with spaces, second-launch forwarding, controller input, and the WPILib fallback.
- Signed release A → B through both updater and manual installer. Exactly one installation, working shortcuts, preserved workspaces/profiles, disabled restart, latest session arguments restored, obsolete app files removed.
- Manual installers refuse while Studio is running. The updater waits for both control and NT disconnection, freezes new sessions, and saves before replacing files.
- Simulation launch races with update preparation; update cancellation/save failure; offline checks; interrupted download; invalid signatures; installer permission denial. The installed app remains usable and installer recovery is offered.
- macOS administrator authorization where needed; Windows current-user installation with no elevation requirement. Confirm an update does not silently create a second installation.

The macOS `.pkg` uses a stable receipt, disables relocation, and upgrades the full app bundle. The Windows NSIS installer uses a stable app identifier and current-user install location. Neither installer removes app-data workspaces. The updater uses Tauri 2.14.0, whose macOS replacement stages the new bundle and retains the old bundle until replacement succeeds.

## Recovery and robot cutover

Retain past installers. Withdraw a broken release from latest and publish a corrected higher version; do not automatically downgrade persisted workspaces. An offline or failed update must not prevent simulation use.

Only after the signed standalone release passes platform acceptance should Team 581 merge the robot extraction branch. Until then, `simon-simulation-desktop-app` retains the embedded app and build path.

Packaged dependency notices are generated from locked npm and Rust dependencies and installed in the application resources. See THIRD_PARTY_NOTICES.md.
