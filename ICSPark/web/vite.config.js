import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La SPA vive en ./client; el build se emite a ./server/public,
// que el servidor Express sirve en el puerto 8081.
export default defineConfig({
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
});
