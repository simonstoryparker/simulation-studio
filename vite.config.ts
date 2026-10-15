import { defineConfig } from "vite";
import manifest from "./package.json";
import react from "@vitejs/plugin-react";
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});
