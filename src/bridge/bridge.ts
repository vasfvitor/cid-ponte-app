/** `Bridge`: applies the WHO 10↔11 tables to Brazilian ICD-10 codes. Port of cid-ponte's `Mapa`. */

import { BrTable, NO_BR_PATH, mappableParent } from "./br";
import { normalize10, parse11 } from "./codes";
import { MAPPING_FILES, readMappingTable, readSimpleTabulation, simpleTabulationFile } from "./tables";
import type {
  Cardinality, Entity11, Lookup, Normalization, Origin10, Reason, Row, TableName, Target,
} from "./types";

export interface BridgeSources {
  release: string;
  one: Row[];
  multiple: Row[];
  rev: Row[];
  foundationOne: Row[];
  titles?: Map<string, Entity11>;
  br?: BrTable;
}

export interface Explanation extends Lookup {
  one: Row[];
  multiple: Row[];
  foundation: Row[];
}

type Resolved = { effective: string; via: Normalization } | { effective: null; via: Reason };

export class Bridge {
  readonly release: string;
  private readonly one = new Map<string, Row>();
  private readonly oneOrder: string[] = [];
  private readonly multiple = new Map<string, Row[]>();
  private readonly rev = new Map<string, Row[]>();
  private readonly foundation = new Map<string, Row>();
  private readonly titles: Map<string, Entity11>;
  private readonly br: BrTable;

  constructor(src: BridgeSources) {
    this.release = src.release;
    this.titles = src.titles ?? new Map();
    this.br = src.br ?? BrTable.empty();
    for (const row of src.one) {
      const c = row["icd10_code"];
      if (c !== null && c !== undefined && !this.one.has(c)) {
        this.one.set(c, row);
        this.oneOrder.push(c);
      }
    }
    for (const row of src.multiple) {
      const c = row["icd10_code"];
      if (c) push(this.multiple, c, row);
    }
    for (const row of src.rev) {
      const c = row["icd11_code"];
      if (c) push(this.rev, c, row);
    }
    for (const row of src.foundationOne) {
      const c = row["icd10_code"];
      if (c && !this.foundation.has(c)) this.foundation.set(c, row);
    }
  }

  /** Build from the raw text of the extracted files, keyed by file name as inside the zips. */
  static fromTexts(release: string, files: Record<string, string>, br?: BrTable): Bridge {
    const need = (name: string): string => {
      const t = files[name];
      if (t === undefined) throw new Error(`missing file: ${name}`);
      return t;
    };
    const st = files[simpleTabulationFile("pt")];
    return new Bridge({
      release,
      one: readMappingTable(need(MAPPING_FILES.one), "one"),
      multiple: readMappingTable(need(MAPPING_FILES.multiple), "multiple"),
      rev: readMappingTable(need(MAPPING_FILES.rev), "rev"),
      foundationOne: readMappingTable(need(MAPPING_FILES.foundationOne), "foundationOne"),
      titles: st !== undefined ? readSimpleTabulation(st) : undefined,
      br,
    });
  }

  // ------------------------------------------------------------ queries

  /** ICD-10 codes present in the OneCategory table (categories, blocks, chapters). */
  get codes10(): ReadonlySet<string> {
    return new Set(this.one.keys());
  }

  /** SimpleTabulation entity of an MMS code (titles, residual flag), if loaded. */
  entity(code11: string): Entity11 | undefined {
    return this.titles.get(code11);
  }

  get hasTitles(): boolean {
    return this.titles.size > 0;
  }

  private resolve(code: string | null | undefined): Resolved {
    const c = normalize10(code);
    if (!c) return { effective: null, via: "empty" };
    if (this.one.has(c)) return { effective: c, via: "exact" };
    if (NO_BR_PATH.has(c)) return { effective: null, via: "no_br_path" };
    const parent = mappableParent(c, this.one);
    if (parent) return { effective: parent, via: "parent_category" };
    return { effective: null, via: "unknown" };
  }

  private cardinality(effective: string): Cardinality {
    const row = this.one.get(effective)!;
    const kind = row["icd11_class_kind"];
    if (kind === null || kind === undefined) return "no_mapping";
    if (kind === "block") return "block";
    const distinct = new Set<string>();
    for (const r of this.multiple.get(effective) ?? []) {
      const c = r["icd11_code"];
      if (c) distinct.add(c);
    }
    return distinct.size >= 2 ? "1:N" : "1:1";
  }

  private target(
    row: Row, table: TableName, effective: string, normalization: Normalization,
    cardinality: Cardinality,
  ): Target {
    const code = row["icd11_code"] ?? null;
    // composite targets (1C41/1G40&XN1P6) are not in the SimpleTabulation: use the main stem
    let t = code ? this.titles.get(code) : undefined;
    if (!t && code) {
      const p = parse11(code);
      t = p ? this.titles.get(p.stems[0]!) : undefined;
    }
    const f = this.foundation.get(effective);
    const n = f?.["relation_n"];
    return {
      code,
      titleEn: row["icd11_title"] ?? null,
      titlePt: t ? t.title : null,
      kind: row["icd11_class_kind"] ?? null,
      table,
      foundationUri: row["icd11_foundation_uri"] ?? null,
      linearizationUri: row["icd11_linearization_uri"] ?? null,
      relation: f?.["relation"] ?? null,
      relationN: n !== null && n !== undefined && n !== "" ? Number.parseInt(n, 10) : null,
      cardinality,
      normalization,
    };
  }

  /**
   * ICD-11 targets of an ICD-10 code. `mode="one"` returns the OneCategory target;
   * `mode="all"` adds the distinct MultipleCategories targets. Empty when there is no target;
   * `lookup().reason` says why.
   */
  targets(code: string, mode: "one" | "all" = "one"): Target[] {
    const r = this.resolve(code);
    if (r.effective === null) return [];
    const card = this.cardinality(r.effective);
    const row = this.one.get(r.effective)!;
    const out: Target[] = [];
    if (row["icd11_code"] || row["icd11_class_kind"]) {
      out.push(this.target(row, "one", r.effective, r.via, card));
    }
    if (mode === "all") {
      const seen = new Set(out.map((t) => t.code));
      for (const m of this.multiple.get(r.effective) ?? []) {
        const c = m["icd11_code"];
        if (c && !seen.has(c)) {
          out.push(this.target(m, "multiple", r.effective, r.via, card));
          seen.add(c);
        }
      }
    }
    return out;
  }

  /** Everything the map and the Brazilian table know about an ICD-10 code, plus its targets. */
  lookup(input: string, mode: "one" | "all" = "all"): Lookup {
    const c = normalize10(input) ?? "";
    const r = this.resolve(c);
    const info = this.br.info(c);
    let reason: Reason;
    if (r.effective === null) reason = r.via;
    else if (!this.one.get(r.effective)!["icd11_class_kind"]) reason = "no_mapping";
    else reason = r.via === "exact" ? "mapped" : "parent_category";
    return {
      input,
      code: c,
      reason,
      effectiveCode: r.effective,
      brTitle: info.title,
      existsInBr: info.exists,
      active2019: info.active2019,
      targets: this.targets(c, mode),
    };
  }

  /** `lookup()` plus the raw WHO rows (one / multiple / foundation) behind it. */
  explain(input: string): Explanation {
    const base = this.lookup(input, "all");
    const key = base.effectiveCode ?? base.code;
    const one = this.one.get(key);
    const foundation = this.foundation.get(key);
    return {
      ...base,
      one: one ? [one] : [],
      multiple: [...(this.multiple.get(key) ?? [])],
      foundation: foundation ? [foundation] : [],
    };
  }

  /** ICD-10 codes an ICD-11 code points back to (11To10 table). */
  reverse(code11: string): Origin10[] {
    const out: Origin10[] = [];
    for (const r of this.rev.get(code11.trim().toUpperCase()) ?? []) {
      const c = r["icd10_code"];
      if (!c) continue;
      const i = this.br.info(c);
      out.push({ code: c, titleEn: r["icd10_title"] ?? null, brTitle: i.title, existsInBr: i.exists });
    }
    return out;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
