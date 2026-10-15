# Native installation and update acceptance

Run the **Installer and updater acceptance** workflow with a draft release tag. It downloads and verifies the actual release files, installs them on native macOS and Windows runners, and tests manual replacement and a real Tauri update to the draft release. Results and logs are uploaded as workflow artifacts. No private robot repository or updater private key is needed.

`prepare.mjs` generates a disposable 0.0.0 copy of Studio. Only that copy receives a loopback HTTP feed and the Rust driver; the shipping source, HTTPS feed and signature checks are unchanged. The driver invokes Studio's existing download, preparation, persistence and installation code. The destination is the exact production package, verified against the originally installed executable hash. The public release key verifies the real updater signature.

`run.mjs` tests paths with spaces, installer re-runs, preserved layouts/controller profiles, failed checks, interrupted/tampered downloads, connection deferral, reconnect blocking, clearing enabled/held-input state, removal of a resource that existed only in the old package, and production relaunch using the latest session. A loopback control fixture inspects the restarted app's outgoing frames. This is a test of a generated older copy to the production release, not evidence of upgrades from every historical version.

Runner automation does not establish first-download Gatekeeper/SmartScreen approval, hardware controller behavior, or physical clean-machine compatibility. These remain manual platform checks. Local macOS runs install into a disposable directory; the normal installed app must be closed because Studio enforces a single instance across installations.
