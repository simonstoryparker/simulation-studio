# Releases and acceptance

## One-time setup

Use GitHub environments `release` (build and updater signing) and `public-release` (publish). Configure required reviewers for publication where the account supports them. Restrict release tags and changes to release workflows to maintainers. Never give signing secrets to pull-request workflows.

In the `release` environment configure:

| Name | Kind | Value |
|---|---|---|
| `STUDIO_UPDATER_PUBLIC_KEY` | Variable | Public key from `tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY` | Secret | Matching private key contents |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret | Key password, if used |
This follows [Dashshund's release approach](https://github.com/jonahsnider/dashshund/blob/main/.github/workflows/release-please.yml): native macOS/Windows builds, GitHub release downloads, and Tauri-signed updates. Its [Tauri configuration](https://github.com/jonahsnider/dashshund/blob/main/src-tauri/tauri.conf.json) uses ad-hoc macOS signing (`signingIdentity: "-"`), DMG and NSIS bundles, and no Windows Authenticode signing. Studio needs no Apple developer certificate, notarization account, or Windows signing certificate for this setup. These downloads can trigger macOS Gatekeeper or Windows SmartScreen prompts; updater signatures authenticate updates but do not confer OS publisher trust.

Studio retains its explicit version tags, all-platform draft assembly, smoke-test checkbox, and publication reviewer rather than copying Dashshund's release-please version automation. Its simulation connection/update interlock also remains in place.

Generate the updater key using `npm run tauri -- signer generate -w /secure/location/studio.key`. Back up that private key and its password outside GitHub before the first release. Keep the same public key in future builds; replacing it without a trust transition breaks updates for existing installations. Only updater signing is required by this workflow. Never reuse another app's updater key.

Clean-machine installation and upgrade checks remain required before publication.

## Build a release

1. Bump the same stable version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
2. Run `npm run check`. Commit, then push tag `vX.Y.Z`.
3. `Build release` checks the app, builds macOS ARM64/Intel and Windows x64 on native runners, signs updater artifacts, and creates a **draft** GitHub release. No partial release is published when a platform fails.
4. Download the draft installers and complete the acceptance checklist below. To test the updater before publication, make a local development build with `STUDIO_UPDATER_PUBLIC_KEY` set and an updater endpoint override pointing at a local test feed containing the signed draft artifacts. Never commit test endpoints or disable production TLS/signature checks. Do not use a public stable release as a test channel.
5. Run `Publish verified release` with the draft tag and `smoke_tested` checked. It verifies all platform files, hashes, signatures' manifest entries, and the update feed before publishing. Tauri verifies the cryptographic updater signature when downloading/installing. The workflow only accepts stable semantic versions.

Published `latest.json` uses `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64`. Downloads are fixed to their versioned release assets. Stable clients check `https://github.com/simonstoryparker/simulation-studio/releases/latest/download/latest.json`.

## Required platform acceptance

- Clean macOS and Windows installation with no Node/Rust; verify first-launch OS approval, Windows WebView2 bootstrap, and default launch discovery.
- Gradle and VS Code simulation launch, paths with spaces, second-launch forwarding, controller input, and the WPILib fallback.
- Release A → B with signed updater artifacts through both updater and manual installer. Exactly one installation, working shortcuts, preserved workspaces/profiles, disabled restart, latest session arguments restored, obsolete app files removed.
- Windows setup refuses while Studio is running. macOS DMG replacement has no installer guard: close Studio before dragging the new app into Applications and choose Replace. The updater waits for both control and NT disconnection, freezes new sessions, and saves before replacing files.
- Simulation launch races with update preparation; update cancellation/save failure; offline checks; interrupted download; invalid signatures; installer permission denial. The installed app remains usable and installer recovery is offered.
- macOS administrator authorization where needed; Windows current-user installation with no elevation requirement. Confirm an update does not silently create a second installation.

The macOS `.dmg` provides the standard drag-to-Applications flow; choosing Replace replaces the full app bundle. The Windows NSIS installer uses a stable app identifier and current-user install location. Neither installer removes app-data workspaces. The updater uses Tauri 2.14.0, whose macOS replacement stages the new bundle and retains the old bundle until replacement succeeds.

## Recovery and robot cutover

Retain past installers. Withdraw a broken release from latest and publish a corrected higher version; do not automatically downgrade persisted workspaces. An offline or failed update must not prevent simulation use.

Only after the standalone release passes platform acceptance should Team 581 merge the robot extraction branch. Until then, `simon-simulation-desktop-app` retains the embedded app and build path.

Packaged dependency notices are generated from locked npm and Rust dependencies and installed in the application resources. See THIRD_PARTY_NOTICES.md.
