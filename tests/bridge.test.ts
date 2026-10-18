/**
 * The TypeScript bridge must give the same answers as cid-ponte (Python) over the same WHO
 * fixture excerpts. tests/fixtures/golden-2026-01.json is generated from the Python package.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { Bridge, MAPPING_FILES, simpleTabulationFile } from "../src/bridge";
import type { Lookup, Origin10 } from "../src/bridge";
import { loadBrTable, readFixture } from "./helpers";

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/golden-2026-01.json", import.meta.url), "utf8"),
) as { release: string; lookups: Lookup[]; reverse: Record<string, Origin10[]> };

const br = loadBrTable();
const files = [...Object.values(MAPPING_FILES), simpleTabulationFile("pt")];
const bridge = Bridge.fromTexts(
  golden.release,
  Object.fromEntries(files.map((f) => [f, readFixture(golden.release, f)])),
  br,
);

describe("golden lookups (same answers as cid-ponte)", () => {
  for (const c of golden.lookups) {
    it(`lookup ${JSON.stringify(c.input)} → ${c.reason}`, () => {
      expect(bridge.lookup(c.input)).toEqual(c);
    });
  }
});

describe("golden reverse (11 → 10)", () => {
  for (const [code, expected] of Object.entries(golden.reverse)) {
    it(`reverse ${code}`, () => {
      expect(bridge.reverse(code)).toEqual(expected);
    });
  }
});

describe("Brazilian table", () => {
  it("loads the full v2019 table", () => {
    expect(br.size).toBeGreaterThan(14_000);
    expect(br.info("I219").title).toMatch(/infarto/i);
    expect(br.info("O93.0").active2019).toBe(true);
    expect(br.info("Z99.99").exists).toBe(false);
  });
});

describe("titles and entities", () => {
  it("exposes residual flag and pt/en titles from the SimpleTabulation", () => {
    const e = bridge.entityOf("BA00.Z");
    expect(e?.isResidual).toBe(true);
    expect(e?.title).toMatch(/hipertens/i);
    expect(e?.titleEn).toBe("Essential hypertension, unspecified");
  });

  it("composite targets resolve to their main stem", () => {
    expect(bridge.entityOf("1C41/1G40&XN1P6")).toBe(bridge.entityOf("1C41"));
    expect(bridge.entityOf(null)).toBeUndefined();
  });

  it("explain() carries the raw WHO rows", () => {
    const ex = bridge.explain("O80");
    expect(ex.one[0]?.["icd10_code"]).toBe("O80");
    expect(["Equivalent", "Subclass"]).toContain(ex.foundation[0]?.["relation"]);
  });
});
