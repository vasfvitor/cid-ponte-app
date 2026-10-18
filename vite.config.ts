import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the build works at any path (GitHub Pages project site, local file server).
  base: "./",
  build: { target: "es2022" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
