import { readFileSync } from "node:fs";

import { BrTable } from "../src/bridge";

export const fixturesDir = (release: string): URL =>
  new URL(`./fixtures/oms/${release}/`, import.meta.url);

export const readFixture = (release: string, name: string): string =>
  readFileSync(new URL(name, fixturesDir(release)), "utf8");

export const loadBrTable = (): BrTable =>
  BrTable.parseCsv(readFileSync(new URL("../public/data/cid10_v2019.csv", import.meta.url), "utf8"));
