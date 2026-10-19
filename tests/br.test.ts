import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { foldText, isPlaceOfOccurrence } from "../src/bridge";
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

  it("does not tolerate typos when the exact words match (hiper is not hipo)", () => {
    const hyper = br.search("hipertireoidismo").map((r) => r.code);
    expect(hyper).toContain("E05");
    expect(hyper.some((c) => c.startsWith("E03") || c === "E02" || c === "E89.0")).toBe(false);
    const hypo = br.search("hipotensao").map((r) => r.code);
    expect(hypo.some((c) => c === "I10" || c.startsWith("I15"))).toBe(false);
    expect(br.search("hiperglicemia").map((r) => r.code)).not.toContain("E16.1");
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

describe("isPlaceOfOccurrence", () => {
  it("is W00–Y34 except Y06–Y07", () => {
    for (const c of ["W00", "W00.0", "X59", "Y34"]) expect(isPlaceOfOccurrence(c)).toBe(true);
    for (const c of ["V99", "Y06", "Y07.1", "Y35", "K35", "N18.0"]) expect(isPlaceOfOccurrence(c)).toBe(false);
  });
});

describe("cid10_v2019.csv titles (see public/data/FONTES.md, local corrections)", () => {
  it("has no mojibake left (Latin-1 read as GBK)", () => {
    const csv = readFileSync(new URL("../public/data/cid10_v2019.csv", import.meta.url), "utf8");
    expect(csv).not.toMatch(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/);
  });

  it("finds the repaired titles by name", () => {
    expect(br.info("B33.4").title).toMatch(/^Síndrome/);
    expect(br.search("sindrome hantavirus").map((r) => r.code)).toContain("B33.4");
    const ckd = br.search("drc estagio").map((r) => r.code); // titled "DRC estágio N"
    expect(ckd).toEqual(expect.arrayContaining(["N18.2", "N18.3", "N18.4", "N18.5"]));
    expect(br.search("agulha hipodermica").map((r) => r.code)).toContain("W46");
  });
});
