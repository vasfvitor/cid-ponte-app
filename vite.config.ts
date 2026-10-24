import { readFileSync } from "node:fs";

import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const ECT = "@whoicd/icd11ect";
const { version: ectVersion } = JSON.parse(
  readFileSync(new URL(`./node_modules/${ECT}/package.json`, import.meta.url), "utf8"),
) as { version: string };

/**
 * WHO's notice on top of the ECT chunk (license, clause 2.6: no removing WHO notices): minifying
 * drops the package's own. Added once the chunk is final, so the minifier cannot drop it either.
 */
const ectNotice = (): Plugin => ({
  name: "ect-notice",
  apply: "build",
  generateBundle(_, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk" || !chunk.moduleIds.some((id) => id.replaceAll("\\", "/").endsWith(`/${ECT}/index.js`))) continue;
      chunk.code =
        `/*! ICD-11 Embedded Coding Tool (${ECT} ${ectVersion}). Copyright (c) World Health Organization, 2020. ` +
        `All rights reserved. ICD-11 Terms of Use and License Agreement: https://icd.who.int/docs/icd-api/license */\n${chunk.code}`;
    }
  },
});

export default defineConfig({
  // Relative base so the build works at any path (GitHub Pages project site, local file server).
  base: "./",
  build: { target: "es2022" },
  plugins: [ectNotice()],
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
