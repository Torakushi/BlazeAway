import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        play: fileURLToPath(new URL("./index.html", import.meta.url)),
        host: fileURLToPath(new URL("./host.html", import.meta.url)),
        demo: fileURLToPath(new URL("./demo.html", import.meta.url)),
      },
    },
  },
});
