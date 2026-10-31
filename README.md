# Simulation Studio

Simulation Studio is a desktop app for local FRC robot simulation. It’s an attempt to make the WPILib simulation experience a little easier to use, with robot controls, keyboard and gamepad input, and NetworkTables widgets in one window. WPILib’s simulation UI is outdated, makes button bindings and controls difficult to configure, and doesn’t handle controllers properly on macOS.

A compact overlay keeps controls nearby while you use another viewer, such as AdvantageScope. The app is built with Tauri, React, and Rust.

<img width="946" height="646" alt="Simulation Studio Preview" src="https://github.com/user-attachments/assets/f6037308-8ea2-4794-81c6-b22c1d3b6961" />
<img width="678" height="169" alt="Compact" src="https://github.com/user-attachments/assets/90f677f0-c2ac-4cf8-8aaa-de3d2f58c7d1" />


## Install

Download an installer from [Releases](https://github.com/simonstoryparker/simulation-studio/releases/latest):

- **macOS:** open the `.dmg` for Apple Silicon or Intel and drag **Simulation Studio** into **Applications**.
- **Windows x64:** run the `-setup.exe`. Setup installs WebView2 if needed.

Close Studio before installing an upgrade. On macOS, choose **Replace** for the existing app. Node and Rust are only needed for development.

Downloads are not signed with an Apple or Windows publisher certificate, so your OS may require first-launch approval.

## Use with a robot simulation

Your robot project needs a compatible control bridge and an NT4 server. Studio connects to services on your own computer; it does not include robot code or WPILib. See [robot integration](docs/development.md#robot-integration) for launch arguments and the [protocol](docs/protocol.md) for bridge requirements.

Once connected, select a mode and enable the simulation. Use **Controllers** to assign gamepads or keyboard bindings, and add NetworkTables entries as widgets. Layouts and input profiles save per project.

See the [usage guide](docs/usage.md) for match timing, controller ports, widgets, the compact overlay, and updates.

## Develop

Install Node 22 or newer, stable Rust, and the [Tauri platform prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm ci
npm run desktop
```

Run `npm run check` for the build, tests, and Clippy, or `npm run package` for a local build. See [development](docs/development.md) and [release instructions](docs/releases.md) for details.

The app was extracted from Team 581’s robot repository; see [source provenance](SOURCE.md). No general reuse license is granted for the application source. [Dependency licenses](THIRD_PARTY_NOTICES.md) still apply.
