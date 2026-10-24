import { readFileSync } from "node:fs";

import { BrTable, Bridge, MAPPING_FILES, simpleTabulationFile } from "../src/bridge";

export const fixturesDir = (release: string): URL =>
  new URL(`./fixtures/oms/${release}/`, import.meta.url);

export const readFixture = (release: string, name: string): string =>
  readFileSync(new URL(name, fixturesDir(release)), "utf8");

export const loadBrTable = (): BrTable =>
  BrTable.parseCsv(readFileSync(new URL("../public/data/cid10_v2019.csv", import.meta.url), "utf8"));

/** A Bridge over the WHO fixture excerpts of `release` (mapping + pt titles). */
export function fixtureBridge(release: string, br?: BrTable): Bridge {
  const files = [...Object.values(MAPPING_FILES), simpleTabulationFile("pt")];
  return Bridge.fromTexts(release, Object.fromEntries(files.map((f) => [f, readFixture(release, f)])), br);
}
