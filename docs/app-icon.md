# App icon

The source is `src-tauri/icons/icon.png`. The existing S icon was recolored with the built-in image generation editor using this prompt:

> Edit target: the provided Simulation Studio app icon. precise-object-edit. Make ONLY a color change to the existing teal S glyph, replacing its teal with a smooth diagonal gradient: deep team maroon #800020 at the TOP RIGHT of the S, through warm red/copper, ending in bright team orange #ff9b42 at the LOWER LEFT. Preserve the exact S silhouette, placement, size, dark outline, soft edge treatment and dark charcoal background. Do not redesign, sharpen, add objects, add text, change the framing, or alter anything outside the S. Keep square icon format, 512x512 if possible.

The result was resized to 512 × 512. Desktop icon sizes and macOS/Windows bundles were generated with the Tauri icon command:

```sh
npm run tauri -- icon src-tauri/icons/icon.png --output /tmp/simulation-studio-icons
```

Copy `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, and `icon.ico` from that output to `src-tauri/icons/`. Keep the source `icon.png` at 512 × 512.
