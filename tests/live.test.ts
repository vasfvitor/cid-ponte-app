/**
 * Network test: downloads the real WHO release (~10 MB), verifies the pinned SHA-256, and
 * assembles the Bridge with the same `bridgeFromZips` the browser uses, then checks a few
 * known answers on the full tables.
 * Run with `LIVE=1 pnpm test`. With `WHO_FILES_DIR=<dir>` the zips are read from that directory
 * (mapping.zip, SimpleTabulation-ICD-11-MMS-pt.zip) instead of downloaded.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bridgeFromZips, sha256Hex } from "../src/data/load";
import {
  DEFAULT_RELEASE, MAPPING_SHA256, SIMPLE_TABULATION_PT_SHA256, mappingUrl, simpleTabulationUrl,
} from "../src/data/sources";
import { loadBrTable } from "./helpers";

const release = DEFAULT_RELEASE;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const dir = process.env["WHO_FILES_DIR"];
  if (dir) return new Uint8Array(readFileSync(`${dir}/${url.split("/").pop()}`));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

describe.skipIf(!process.env["LIVE"] && !process.env["WHO_FILES_DIR"])(`live WHO release ${release}`, () => {
  it("downloads, verifies and answers on the full tables", { timeout: 180_000 }, async () => {
    const [mapping, titles] = await Promise.all([
      fetchBytes(mappingUrl(release)),
      fetchBytes(simpleTabulationUrl(release, "pt")),
    ]);
    expect(await sha256Hex(mapping)).toBe(MAPPING_SHA256[release]);
    expect(await sha256Hex(titles)).toBe(SIMPLE_TABULATION_PT_SHA256[release]);

    const bridge = bridgeFromZips(release, mapping, titles, loadBrTable());

    // 12,597 distinct icd10Code values in OneCategory (2026-01), as in cid-ponte docs/cobertura.md
    expect(bridge.codes10.size).toBe(12_597);
    expect(bridge.hasTitles).toBe(true);

    const i219 = bridge.lookup("I219");
    expect(i219.reason).toBe("mapped");
    expect(i219.targets[0]?.code).toBe("BA41.Z");
    expect(i219.targets[0]?.relation).toBe("Equivalent");
    expect(i219.targets[0]?.titlePt).toMatch(/infarto/i);

    expect(bridge.lookup("U071").targets[0]?.code).toBe("RA01.0");

    const w000 = bridge.lookup("W000");
    expect(w000.reason).toBe("parent_category");
    expect(w000.effectiveCode).toBe("W00");
    expect(w000.targets.length).toBeGreaterThan(0);

    expect(bridge.lookup("O930").reason).toBe("no_br_path");
    expect(bridge.lookup("L739").reason).toBe("no_mapping");

    // K72 (hepatic failure) has several distinct targets in MultipleCategories
    const k72 = bridge.lookup("K72");
    expect(k72.targets[0]?.cardinality).toBe("1:N");
    expect(k72.targets.length).toBeGreaterThan(1);
  });
});
