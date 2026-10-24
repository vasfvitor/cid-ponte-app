import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Target } from "../src/bridge";
import { compareToMapped, ectSettings, initialTerms } from "../src/ui/detail";
import { fixtureBridge, loadBrTable } from "./helpers";

const { release } = JSON.parse(
  readFileSync(new URL("./fixtures/golden-2026-01.json", import.meta.url), "utf8"),
) as { release: string };
const bridge = fixtureBridge(release, loadBrTable());
const titleOf = (c: string): string | null => bridge.titleOf(c);
/** From the card of `targetCode`; by default the main (OneCategory) one, or the ICD-10 code when there is none. */
const terms = (code: string, targetCode?: string): string[] => {
  const lk = bridge.lookup(code);
  const target = lk.targets.find((t) => (targetCode ? t.code === targetCode : t.table === "one")) ?? null;
  return initialTerms(lk, target, titleOf);
};

describe("initialTerms", () => {
  it("searches a one-stem target by its Portuguese title, then by its code", () => {
    expect(terms("W000")).toEqual(["Queda não intencional no mesmo nível ou de menos de 1 metro de altura", "PA60"]);
    expect(terms("I10")).toEqual(["Hipertensão essencial não especificada", "BA00.Z"]);
  });

  it("searches a cluster by the Brazilian title, which names the case, then the first stem", () => {
    expect(terms("A41.3")).toEqual(["Sepse por Haemophilus influenzae", "1C41"]);
  });

  it("searches from the alternative whose card it is", () => {
    expect(terms("L73.9", "1B75.Z")).toEqual([bridge.titleOf("1B75.Z"), "1B75.Z"]);
  });

  it("searches a block (no code) by its English title, as the bridge gives it, then the Brazilian title", () => {
    const lk = bridge.lookup("I10");
    // What the bridge builds for a block target: no code, so no Portuguese title.
    const block: Target = { ...lk.targets[0]!, code: null, kind: "block", titlePt: null, titleEn: "Hypertensive diseases" };
    expect(initialTerms(lk, block, titleOf)).toEqual(["Hypertensive diseases", lk.brTitle]);
  });

  describe("from the ICD-10 code (no card)", () => {
    it("searches from the first alternative when there is no mapping", () => {
      expect(terms("L73.9")).toEqual([bridge.titleOf("ED9Y"), "ED9Y"]);
    });

    it("searches by the Brazilian title when there is no target, else nothing", () => {
      expect(terms("O93.0")).toEqual(["Morte materna associada a acidente de transito"]);
      expect(terms("Z99.99")).toEqual([]);
    });
  });
});

describe("ectSettings", () => {
  it("runs in Portuguese on WHO's cloud API for the release, with full postcoordination", () => {
    expect(ectSettings("2026-01")).toMatchObject({
      apiServerUrl: "https://id.who.int",
      apiSecured: true,
      language: "pt",
      minorVersion: "2026-01",
      autoBind: false,
      searchByCodeOrURI: true,
      otherPostcoordination: true,
    });
    expect(ectSettings("2026-01")).not.toHaveProperty("simplifiedMode");
  });
});

describe("compareToMapped", () => {
  it("lists the parts added to WHO's mapped code", () => {
    expect(compareToMapped("PA60&XE3LV&XE266", "PA60&XE3LV")).toEqual({ added: ["XE266"], removed: [], sameStem: true });
  });

  it("adds nothing when the code is the mapped one", () => {
    expect(compareToMapped("1C41/1G40&XN1P6", "1C41/1G40&XN1P6")).toEqual({ added: [], removed: [], sameStem: true });
  });

  it("lists the mapped parts left out", () => {
    expect(compareToMapped("PA60&XE266", "PA60&XE3LV")).toEqual({ added: ["XE266"], removed: ["XE3LV"], sameStem: true });
  });

  it("tells a different stem apart", () => {
    expect(compareToMapped("5A11", "5A14")).toEqual({ added: ["5A11"], removed: ["5A14"], sameStem: false });
  });

  it("has nothing to compare without a mapped code", () => {
    expect(compareToMapped("PA60", null)).toBeNull();
  });
});
