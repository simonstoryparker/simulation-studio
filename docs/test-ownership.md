# Test ownership and extraction audit

Source: `team581/offseason-2026@simon-simulation-desktop-app`, commit `8c4b4808b260c02cf936f18576adf0edf0168106`.

| Tests or supporting files | Owner after extraction |
|---|---|
| `sim-app/src/store.test.ts`, `sim-app/src/workspace.test.ts` | This repo: `src/` |
| Inline Rust tests in `sim-app/src-tauri/src/{main,model,nt}.rs` | This repo: `src-tauri/src/` |
| App build/check workflow, prerequisite/package scripts, process sampling, performance notes | This repo |
| Original UI specification under Java tests | This repo: `docs/original-ui-requirements.md` |
| New updater UI, lifecycle race, protocol/loopback, and release-manifest tests | This repo |
| Java `SimulationControlBridgeTest`, `SimulationAppFixture`, installed-app discovery tests | Robot repo |
| Robot mechanism, swerve, turret, and HAL behavior tests | Robot repo |

Audited all branch paths containing test, spec, and fixture, and searched outside the app directory for Simulation Studio references. There were no other app test suites outside `sim-app/`; the Java-directory UI specification was the misplaced app-specific supporting document. Robot behavior tests changed on the source branch stay with robot code.

App checks require no private checkout, robot assets, WPILib JVM, or GitHub credentials. Add new app tests here, including controller mapping, UI, workspace migrations, NT clients, installation, and updates. Keep Java launcher/bridge/HAL integration tests with the robot. Shared wire-protocol vectors are intentionally copied and independently tested on both sides.
