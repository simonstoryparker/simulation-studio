# Third-party notices

The original application code has no general reuse license. That does not change the licenses of its dependencies.

The frontend uses React, React DOM, react-grid-layout/react-resizable, Three.js, and the Tauri API. The native app uses Tauri, its single-instance/updater plugins, serde/serde_json, Tokio, tokio-tungstenite, futures-util, rmpv, gilrs, and url, plus their transitive dependencies. Exact versions and registry sources are recorded in `package-lock.json` and `src-tauri/Cargo.lock`.

`scripts/generate-notices.mjs` collects each installed npm package's and resolved Rust crate's license metadata and included LICENSE/COPYING/NOTICE files. Local packaging and release builds generate `src-tauri/resources/THIRD_PARTY_NOTICES.txt` and bundle it with the app. This includes development/build dependencies as well as runtime dependencies so their notices are retained conservatively. Regenerate it after dependency updates; never hand-edit generated notices.

The controller drawing is procedural application code; no robot CAD/models or external controller artwork is included.
