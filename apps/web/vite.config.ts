import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createPublicAssetVersions } from "./src/buildAssetVersions.js";

const publicDir = fileURLToPath(new URL("../../assets", import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir,
  define: {
    __PUBLIC_ASSET_VERSIONS__: JSON.stringify(createPublicAssetVersions(publicDir))
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/socket.io": {
        target: "http://localhost:4000",
        ws: true
      }
    }
  }
});
