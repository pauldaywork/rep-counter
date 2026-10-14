import { defineConfig } from "vitest/config";
import { storePlugin } from "./vite-plugin-store";

export default defineConfig({
  plugins: [storePlugin()],
  server: { port: 5173, strictPort: true },
  // fft.js is CommonJS and only imported from the AudioWorklet, which
  // Vite's dependency scan does not see. Pre-bundle it up front so the
  // first mic start does not trigger a re-optimise and page reload.
  optimizeDeps: { include: ["fft.js"] },
  // AudioWorklet.addModule loads module scripts, so bundle workers as ES modules.
  worker: { format: "es" },
  test: { include: ["test/**/*.test.ts"] },
});
