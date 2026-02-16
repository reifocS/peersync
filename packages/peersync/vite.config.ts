import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import preserveDirectives from "rollup-preserve-directives";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: {
        "core/index": resolve(__dirname, "src/core/index.ts"),
        "transport/index": resolve(__dirname, "src/transport/index.ts"),
        "react/index": resolve(__dirname, "src/react/index.ts"),
        "testing/index": resolve(__dirname, "src/testing/index.ts"),
      },
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "react-dom", "peerjs"],
    },
    sourcemap: true,
  },
  plugins: [
    dts({ rollupTypes: false, tsconfigPath: "./tsconfig.json" }),
    preserveDirectives(),
  ],
  publicDir: false,
});
