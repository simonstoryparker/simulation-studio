# App icon

The source is [`src-tauri/icons/icon.png`](../src-tauri/icons/icon.png), a 512 × 512 image. The S glyph has a diagonal gradient from maroon (`#800020`) at the top right to orange (`#ff9b42`) at the lower left, on a dark charcoal background. It was recolored using an image generation editor.

Desktop icon sizes and macOS/Windows bundles can be regenerated with the Tauri icon command:

```sh
npm run tauri -- icon src-tauri/icons/icon.png --output /tmp/simulation-studio-icons
```

Copy `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, and `icon.ico` from that output to `src-tauri/icons/`. Keep the source `icon.png` at 512 × 512.
