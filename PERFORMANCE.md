# Performance validation

Targets are acceptance goals, not guarantees inferred from using Tauri. Measure release builds and count the native app plus its attributed webview/GPU/network processes, excluding the robot JVM and other applications' WebKit processes.

## Recorded results

Development Mac, macOS, Apple Silicon, WPILib 2026.2.1:

| Check | Result | Scope |
|---|---:|---|
| macOS app bundle | approximately 8.12 MiB | Updated controls/overlay/3D controller; native executable with embedded frontend; no bundled Chromium/Node |
| Frontend production assets | approximately 367 KiB main JS, 589 KiB lazy controller JS, 15 KiB CSS | Approximately 112 KiB, 150 KiB, and 4 KiB gzip; controller loads only when its tab opens |
| Java bridge roundtrip p95 | 20.58 ms (recovery run; earlier run 19.17 ms) | 100 frames on an actual HAL/WebSocket bridge, with a 20 ms application loop |
| Control watchdog / reconnect / E-stop | passed | HAL integration tests, including all six joystick ports |
| NT4 desktop smoke test | passed | Actual WPILib NT4 fixture; folder expansion, integer precision, enable feedback |

The bridge roundtrip measures WebSocket input to applied-state acknowledgement. It does **not** establish native gamepad-event latency, keyboard-to-robot latency, or performance of the entire robot application under load.

## Reproduce

Build with `npm run package`, then launch the release app bundle on macOS (using `open -n -a`), or the release executable on Windows/Linux. Startup prints `Simulation Studio frontend ready: … ms` when the UI has loaded its workspace and input profiles. Measure cold versus warm runs separately; first-time compilation is excluded.

Run `./gradlew shared:simulationAppFixture -PfixtureTopics=10000 -PwpilibSimGui=true`. The fixture publishes 10,000 numeric entries and updates its first 500 at approximately 50 Hz. Open a values folder, exercise layouts and controller input, then switch tabs and remove widgets. Metadata discovery is topics-only; only onscreen consumers subscribe to values. Arrays/raw previews share a 4 KiB budget.

Identify the app and its associated webview processes before sampling. On macOS WebKit services may have parent PID 1, so do not count every WebKit process on the machine. Record which processes appeared during this app launch. Use:

```sh
python3 scripts/sample-processes.py --pids APP_PID WEBVIEW_PID GPU_PID NETWORK_PID --seconds 60
```

Use the browser/webview performance tools for frame times and UI long tasks while dragging and resizing. A p95 frame target under 20 ms and absence of tasks over 100 ms must be established with an actual trace; successful rendering alone is insufficient.

## Remaining acceptance measurements

- Warm startup under 1 s and cold startup under 2 s across repeated runs.
- Under 150 MiB total resident memory and under 3% of one CPU core over 60 s with a 100-widget layout.
- Native gamepad-event and Disable-action p95 under 40 ms, including the Rust input/control path.
- Frame-time/long-task trace while dragging/resizing with the stated workload.
- Native UI/device smoke tests on Windows and Linux. The CI matrix compiles/tests all three platforms when run, but it has not been executed from this local session.

The implementation is not yet certified against these unmeasured targets. Hardware and platform checks must be completed before claiming full performance acceptance.

## September 30, 2026 UI and control verification

The requested Luna medium implementer completed the frontend changes; primary review completed native input synchronization, timer cancellation, and macOS resize support. `npm run check` covers frontend build, 9 frontend tests, Clippy, and 13 native tests. The 7 real HAL/WebSocket bridge tests passed (roundtrip p95 approximately 19.77 ms in this run).

Against the 1,000-topic HAL/NT fixture on macOS, verified: default Full Match durations of 20/3/140, configurable short full-match completion and automatic disable, the disabled transition, keyboard destination switching while enabled, compact operation while AdvantageScope has focus, controller rotation, diagram click-to-bind, Escape cancellation, immediate boolean writes, window expansion, and compact resize/bounds persistence. Native tests cover Teleop boundaries, delayed ticks, cancellation/restart, opposing keys, trigger ranges, and keyboard/physical merging. macOS does not support Tauri's native resize-drag operation; the overlay uses pointer capture and a bounded native size command instead.

Physical gamepads, mechanism homing on a real simulated robot, Windows/Linux native UI, and new CPU/memory/frame-time measurements were not available for this verification. Previous performance numbers do not establish those results for the updated app.

## Standalone extraction verification

Historical measurements above describe the original robot-branch app and are not new release certification. Standalone tests run here with `npm run check`; real HAL/NT measurements use the robot-owned integration fixture. Clean-machine macOS/Windows installer and update acceptance remain required before publishing.
