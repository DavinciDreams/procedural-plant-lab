import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist-lib",
    lib: {
      entry: {
        procplants: resolve(import.meta.dirname, "src/index.ts"),
        core: resolve(import.meta.dirname, "src/core.ts"),
        "junction-research": resolve(import.meta.dirname, "src/procplant-watertight-junction.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      // Tellus already owns its Three.js renderer. Sharing that singleton
      // avoids duplicate classes, shader programs, and GPU resource tracking.
      external: ["three"],
    },
  },
});
