# Using Simulation Studio

Studio connects to a local robot simulation with a compatible control bridge and NT4 server. Your robot project must provide these services; see [robot integration](development.md#robot-integration).

## Robot controls

The left column contains Enable/Disable, mode, alliance, robot state, elapsed time, and E-stop.

Select **Full Match** and press **Enable** to run a timed sequence. Defaults are 20 seconds of Auto, a 3-second disabled transition, and 140 seconds of Teleop. Change these durations in Settings. Changing mode or alliance cancels the sequence. E-stop stays latched until the simulation restarts.

Losing focus in the full window disables the simulation and switches to compact mode. Further focus loss in compact mode clears held keyboard keys while allowing simulation and physical controllers to remain active. The robot bridge must disable after 250 ms without valid control frames.

## Controllers

The **Controllers** tab is always available. Assign physical gamepads independently from the active keyboard port. To bind a key, click a control on the controller diagram and press the key. Escape cancels capture; Clear removes a binding.

The keyboard can share a port with a gamepad. Buttons merge, and held keyboard axis or D-pad directions take priority. Switching the keyboard port clears held keys without interrupting the gamepad. Reassigning a gamepad or unplugging it disables simulation; Studio does not silently replace device assignments.

## NetworkTables widgets

Click or drag an entry from Topics to add a widget. To add a folder’s contents recursively, open it and choose **Open all entries in folder**. Each entry gets its own widget, choosers are grouped, and duplicates are skipped. Run the action again to add newly published entries.

Move and resize widgets in named tabs. Double-click a tab to rename it, or use its close button to remove it. At least one workspace tab remains.

Editable widgets, including choosers and tunables, publish changes immediately by default. Readout and details widgets are display-only. Sliders need an explicit range; custom selectors need explicit typed options. Folders do not have special tuning or feature-flag behavior.

Standard `SendableChooser` widgets display `options`, publish `selected` even if the robot has not published that setter topic, and show robot-reported `active` separately. Studio discovers `.type` metadata at any path.

A local write does not guarantee robot acknowledgement. Widgets distinguish locally published values from received values, and robot publication can overwrite an edit. Disconnected writes are rejected and never replayed.

### Value formats

NT integers use decimal strings between the frontend and native app to preserve signed 64-bit precision. Integer array editors require quoted JSON values, such as `["9007199254740993"]`.

Raw and structured formats are read-only. Value previews share a 4 KiB budget and show at most 100 array elements. Full cached details are fetched on request.

## Compact overlay

Click away from Studio or choose **Settings → Open compact overlay** to turn the window into an always-on-top overlay. Use its expand button, the Dock icon, or the window switcher to restore the full window. The hover × button dismisses automatic compact mode until you click **Compact** in Studio.

The overlay fits the visible controls, can be moved, and remembers its position per workspace. Clicking a control while the overlay is inactive acts immediately and keeps it compact.

Enable/Disable, mode, state/time, and keyboard ports 0 and 1 appear by default. Settings lets you add alliance, E-stop, ports 2–5, and an ordered list of telemetry topics. Telemetry appears in a second row. Project and connection endpoints are also in Settings.

## Saved settings

Layouts, input profiles, keyboard port, match durations, Topics visibility, and overlay settings save per project in the operating system’s application-data directory for `org.team581.simulation-studio`. Version 1 workspaces migrate on load.

Topic values, enable state, held keys, and running matches are never restored from a workspace.

## Updates

Studio checks at startup and every six hours while open, downloads updates automatically, and offers **Settings → App updates → Restart to update**. Disconnect the simulation first: updates wait until both control and NT connections are inactive. Every restart begins disabled with no held inputs or running match.

Updates use public GitHub Releases and verified updater signatures; no login is needed. Workspaces and controller profiles survive replacement. macOS may request administrator authorization to replace an app in `/Applications`.

If a download fails, the installed app remains usable. If replacement fails, choose **Download installer**, close Studio, and run the installer.
