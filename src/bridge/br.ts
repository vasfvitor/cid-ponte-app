/**
 * Brazilian ICD-10 (CID-10), version 2019 from CC BR-FIC, and the Brazilian rules the WHO
 * map does not cover. Source and attribution: public/data/FONTES.md.
 *
 * - 4th-character place-of-occurrence subdivisions (W00–Y34 .0–.9): WHO maps only the
 *   3-character category. `mappableParent()` returns that category.
 * - National codes, or codes Brazil kept after WHO removed them, with no path at all in the
 *   WHO map: `NO_BR_PATH`.
 */

import { category10, normalize10 } from "./codes";
import { parseDelimited, stripBom } from "./dsv";

// Brazilian CID-10 codes whose code *and* parent category are absent from WHO map 2026-01.
// v2019 (active) and V2008. Verified in cid-ponte docs/cobertura.md; keep in sync.
export const NO_BR_PATH: ReadonlySet<string> = new Set([
  // v2019
  "O93", "O93.0", "O93.1", "O93.2", "O93.3", "O93.4", "O93.5", "O93.6", "O93.7", "O93.8",
  "O93.9",
  "U06", "U06.9", "U92", "U92.1", "U80", "U81", "U89", "U99", "I84",
  // V2008 (in addition to the above)
  "A90", "A91", "B59", "U88",
  "I84.0", "I84.1", "I84.2", "I84.3", "I84.4", "I84.5", "I84.6", "I84.7", "I84.8", "I84.9",
  "U80.0", "U80.1", "U80.8", "U81.0", "U81.8", "U89.8", "U89.9",
]);

export interface BrCode {
  code: string;
  codeNoDot: string;
  category: string;
  grouping: string | null;
  title: string;
  dagger: boolean; // "cruz" (+): etiology code
  asterisk: boolean; // "asterisco" (*): manifestation code
  active: boolean;
  includedOn: string | null;
}

export interface BrInfo {
  code: string;
  entry: BrCode | null;
  exists: boolean;
  active2019: boolean;
  title: string | null;
}

/** The embedded CID-10 v2019 table (all records, including inactive ones). */
export class BrTable {
  private constructor(private readonly rows: Map<string, BrCode>) {}

  static empty(): BrTable {
    return new BrTable(new Map());
  }

  /** Parse public/data/cid10_v2019.csv (UTF-8, header: codigo,codigo_sp,categoria,...). */
  static parseCsv(text: string): BrTable {
    const rows = parseDelimited(stripBom(text), ",");
    const header = rows[0] ?? [];
    const idx = (name: string): number => header.indexOf(name);
    const iCode = idx("codigo");
    const iNoDot = idx("codigo_sp");
    const iCat = idx("categoria");
    const iGroup = idx("agrupamento");
    const iTitle = idx("titulo");
    const iDagger = idx("cruz");
    const iAsterisk = idx("asterisco");
    const iActive = idx("ativo");
    const iIncluded = idx("dt_inclusao");
    const map = new Map<string, BrCode>();
    for (const r of rows.slice(1)) {
      const code = r[iCode];
      if (!code) continue;
      map.set(code, {
        code,
        codeNoDot: r[iNoDot] ?? code.replace(".", ""),
        category: r[iCat] ?? code.slice(0, 3),
        grouping: r[iGroup] || null,
        title: r[iTitle] ?? "",
        dagger: r[iDagger] === "1",
        asterisk: r[iAsterisk] === "1",
        active: r[iActive] === "1",
        includedOn: r[iIncluded] || null,
      });
    }
    return new BrTable(map);
  }

  get size(): number {
    return this.rows.size;
  }

  /** Accepts any form ("I219", "I21.9"); normalizes and looks up. */
  info(code: string | null | undefined): BrInfo {
    const c = normalize10(code) ?? "";
    const entry = this.rows.get(c) ?? null;
    return {
      code: c,
      entry,
      exists: entry !== null,
      active2019: entry !== null && entry.active,
      title: entry ? entry.title : null,
    };
  }
}

/**
 * 3-character category to use when the code itself is not in `known` (the set of icd10Code
 * values of the WHO map). Returns the category if the code is an absent subcategory whose
 * category is present; otherwise null.
 */
export function mappableParent(code: string, known: { has(c: string): boolean }): string | null {
  const c = normalize10(code) ?? "";
  if (known.has(c) || !c.includes(".")) return null;
  const cat = category10(c);
  return known.has(cat) ? cat : null;
}
