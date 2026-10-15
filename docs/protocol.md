# Local simulation protocol, version 1

Studio is an independent client of two robot-hosted loopback services:

| Service | Default | Contract |
|---|---|---|
| Control | `ws://127.0.0.1:5811` | JSON input frames and applied-state acknowledgements |
| Telemetry | `ws://127.0.0.1:5810/nt/simulation-studio` | Standard NT4 / NT4.1 WebSockets |

The launcher passes `--control`, `--nt`, and `--project`; project identifies the saved workspace. Project identities must be nonempty, at most 100 UTF-8 bytes, and stable across app versions. Studio accepts only loopback `ws` endpoints. The same flags delivered to an existing instance switch its session and clear inputs.

## Complete control frames

Every 20 ms, Studio sends `version: 1`, an increasing nonnegative `sequence`, booleans `enabled` and `estop`, `mode` (`teleop`, `auto`, `test`), `alliance` (`Unknown`, `Red1`–`Red3`, `Blue1`–`Blue3`), finite `matchTime` (-1 to 3600), and exactly six `joysticks`.

Each joystick has a `name` (at most 128 UTF-16 code units), `xbox` boolean, at most twelve finite `axes` in [-1, 1], at most 32 boolean `buttons`, and at most twelve integer `povs` in [-1, 359]. Frames are at most 16 KiB. Empty input arrays are valid.

The bridge admits one controlling connection, requires a disabled frame before enabling, rejects stale sequences or malformed frames, and latches E-stop until simulation restart. After 250 ms without a valid frame, it disables and clears all inputs. Losing the connection also disables.

## Applied-state acknowledgement

The robot applies input on its robot thread and responds with `version`, `sequence`, `enabled`, `estop`, `attached`, and `mode`. Studio sends only disabled frames until it receives a valid version-1 acknowledgement. Unsupported or malformed acknowledgements close the control session, clear inputs, and surface an incompatibility error. A missing acknowledgement for 500 ms triggers reconnect in a disabled state.

Keep protocol version 1 compatible across app releases. A future breaking protocol needs an explicit compatibility transition; changing app semantic version alone must not change this wire format.

## Tests

`tests/protocol/control-v1.json` is mirrored in the robot repo at `shared/src/test/resources/simulation/control-v1.json`. Both repositories test the same control vectors independently. Update both copies together when extending the contract. The app also tests acknowledgement vectors and a loopback WebSocket fixture; the robot tests real HAL application and watchdog behavior.
