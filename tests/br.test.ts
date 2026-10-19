import { describe, expect, it } from "vitest";

import { foldText } from "../src/bridge";
import { loadBrTable } from "./helpers";

const br = loadBrTable();

describe("foldText", () => {
  it("drops accents, case and punctuation", () => {
    expect(foldText("Hipertensão essencial (primária)")).toBe("hipertensao essencial primaria");
    expect(foldText("  Infarto  AGUDO do miocárdio ")).toBe("infarto agudo do miocardio");
  });
});

describe("BrTable.search (CID-10 by name)", () => {
  it("finds by accented or unaccented words, any order", () => {
    const codes = br.search("infarto agudo miocárdio").map((r) => r.code);
    expect(codes).toContain("I21");
    expect(codes.slice(0, 5)).toContain("I21.9");
    expect(br.search("miocardio infarto").map((r) => r.code)).toContain("I21");
  });

  it("ranks titles that start with the query first, active before inactive", () => {
    const [first] = br.search("hipertensao essencial");
    expect(first?.code).toBe("I10");
    const diabetes = br.search("diabetes");
    expect(diabetes.length).toBeGreaterThan(0);
    expect(diabetes.every((r) => r.active)).toBe(true);
  });

  it("tolerates a typo and matches word prefixes", () => {
    expect(br.search("infrato agudo").map((r) => r.code)).toContain("I21");
    expect(br.search("infart agud").map((r) => r.code)).toContain("I21");
  });

  it("respects the limit and returns nothing for empty or unmatched queries", () => {
    expect(br.search("dor", 5)).toHaveLength(5);
    expect(br.search("   ")).toEqual([]);
    expect(br.search("xyzzy quux")).toEqual([]);
  });
});

describe("BrTable.subcategories", () => {
  it("lists the subcategories of a category, in code order", () => {
    const codes = br.subcategories("a41").map((r) => r.code);
    expect(codes).toEqual(["A41.0", "A41.1", "A41.2", "A41.3", "A41.4", "A41.5", "A41.8", "A41.9"]);
    expect(br.subcategories("I10")).toEqual([]);
  });
});
