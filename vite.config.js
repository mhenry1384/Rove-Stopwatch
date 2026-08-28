import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2021", "chrome100", "safari13"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        timelogs: resolve(__dirname, "timelogs.html"),
      },
    },
  },
};
