import { defineConfig } from "vite";

export default defineConfig({
  base: "/captioncloud/",
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
