import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4175" },
  },
  preview: {
    port: 4174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4175" },
  },
});
