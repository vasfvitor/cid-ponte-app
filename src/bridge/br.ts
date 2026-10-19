/**
 * Brazilian ICD-10 (CID-10), version 2019 from CC BR-FIC, and the Brazilian rules the WHO
 * map does not cover. Source and attribution: public/data/FONTES.md.
 *
 * - 4th-character place-of-occurrence subdivisions (W00–Y34 .0–.9): WHO maps only the
 *   3-character category. `mappableParent()` returns that category.
 * - National codes, or codes Brazil kept after WHO removed them, with no path at all in the
 *   WHO map: `NO_BR_PATH`.
 * - Title search (`BrTable.search`): the WHO Coding Tool searches ICD-11 by text, but nothing
 *   searches the *Brazilian* ICD-10 by name. A physician who remembers "infarto agudo" but not
 *   I21 starts here and then crosses to ICD-11. Indexed with MiniSearch (prefix and typo
 *   tolerant) when the table is built.
 */

import MiniSearch from "minisearch";

import { category10, normalize10 } from "./codes";
import { parseWithHeader } from "./dsv";

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

/** What the app reads from a Brazilian CID-10 record. The CSV has more columns; see FONTES.md. */
export interface BrCode {
  code: string;
  title: string;
  active: boolean;
}

export interface BrInfo {
  exists: boolean;
  active2019: boolean;
  title: string | null;
}

/** Lowercase, no diacritics, single spaces. CC BR-FIC titles come without accents; users type them. */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Indexed extends BrCode {
  folded: string;
}

const toBrCode = ({ code, title, active }: Indexed): BrCode => ({ code, title, active });

/** The embedded CID-10 v2019 table (all records, including inactive ones). */
export class BrTable {
  private readonly index = new MiniSearch<Indexed>({
    idField: "code",
    // Rows carry their folded title, and `search` folds the query: no per-token folding.
    fields: ["folded"],
    processTerm: (term) => term || null,
  });

  private constructor(private readonly rows: Map<string, Indexed>) {
    this.index.addAll([...rows.values()]);
  }

  static empty(): BrTable {
    return new BrTable(new Map());
  }

  /** Parse public/data/cid10_v2019.csv (UTF-8; columns codigo, titulo, ativo among others). */
  static parseCsv(text: string): BrTable {
    const { rows, col } = parseWithHeader(text, ",");
    const iCode = col("codigo");
    const iTitle = col("titulo");
    const iActive = col("ativo");
    const map = new Map<string, Indexed>();
    for (const r of rows) {
      const code = r[iCode];
      if (!code) continue;
      const title = r[iTitle] ?? "";
      map.set(code, { code, title, active: r[iActive] === "1", folded: foldText(title) });
    }
    return new BrTable(map);
  }

  get size(): number {
    return this.rows.size;
  }

  /** Accepts any form ("I219", "I21.9"); normalizes and looks up. */
  info(code: string | null | undefined): BrInfo {
    const entry = this.rows.get(normalize10(code) ?? "");
    return {
      exists: entry !== undefined,
      active2019: entry?.active ?? false,
      title: entry?.title ?? null,
    };
  }

  /**
   * Codes whose title has every word of `query`, accent- and case-insensitive, as a prefix
   * ("infart"). Only when that finds nothing are typos tolerated ("infrato"): with typos on
   * from the start, "hipertireoidismo" would also bring hypothyroidism (hiper/hipo is 2 edits).
   * Ranked by relevance (shorter titles win), with active codes far ahead of inactive ones and
   * titles that start with the query doubled. Subcategories and their category both appear.
   */
  search(query: string, limit = 12): BrCode[] {
    const phrase = foldText(query);
    if (!phrase) return [];
    const options = {
      prefix: true,
      combineWith: "AND",
      boostDocument: (code: string) => {
        const r = this.rows.get(code)!;
        return (r.active ? 1 : 0.01) * (r.folded.startsWith(phrase) ? 2 : 1);
      },
    } as const;
    let hits = this.index.search(phrase, options);
    if (hits.length === 0) {
      // Edits allowed per word: none up to 3 letters, 1 up to 6, then 2 (a swap like "infrato").
      const fuzzy = (term: string): number | false => (term.length <= 3 ? false : term.length <= 6 ? 1 : 2);
      hits = this.index.search(phrase, { ...options, fuzzy });
    }
    return hits.slice(0, limit).map((h) => toBrCode(this.rows.get(h.id as string)!));
  }

  /** Subcategories of a 3-character category ("A41" -> A41.0 … A41.9), by code. */
  subcategories(category: string): BrCode[] {
    const prefix = `${normalize10(category) ?? ""}.`;
    const out: BrCode[] = [];
    for (const r of this.rows.values()) {
      if (r.code.startsWith(prefix)) out.push(toBrCode(r));
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
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

/**
 * Whether a 3-character category takes the place-of-occurrence 4th character: W00–Y34,
 * except Y06–Y07 (there the 4th character is the perpetrator).
 */
export function isPlaceOfOccurrence(category: string): boolean {
  const c = category.slice(0, 3).toUpperCase();
  return c >= "W00" && c <= "Y34" && c !== "Y06" && c !== "Y07";
}
