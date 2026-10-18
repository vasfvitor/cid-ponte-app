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

/** Result of resolving an input code against the OneCategory table, computed once per lookup. */
type Resolved =
  | { code: string; effective: string; row: Row; normalization: Normalization }
  | { code: string; effective: null; reason: "empty" | "no_br_path" | "unknown" };

/** WHO marks "No Mapping" with an empty target: no class kind on the row. */
const hasNoMapping = (row: Row): boolean => !row["icd11_class_kind"];

export class Bridge {
  readonly release: string;
  private readonly one = new Map<string, Row>();
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
      if (c && !this.one.has(c)) this.one.set(c, row);
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

  get hasTitles(): boolean {
    return this.titles.size > 0;
  }

  /**
   * SimpleTabulation entity behind an ICD-11 target. Composite targets ("1C41/1G40&XN1P6")
   * are not in the SimpleTabulation, so the main stem (first before "/") is used. This is the
   * one place that rule lives; titles and the residual warning both come from here.
   */
  entityOf(code11: string | null): Entity11 | undefined {
    if (!code11) return undefined;
    const exact = this.titles.get(code11);
    if (exact) return exact;
    const p = parse11(code11);
    return p ? this.titles.get(p.stems[0]!) : undefined;
  }

  private resolve(input: string | null | undefined): Resolved {
    const code = normalize10(input) ?? "";
    if (!code) return { code, effective: null, reason: "empty" };
    const row = this.one.get(code);
    if (row) return { code, effective: code, row, normalization: "exact" };
    if (NO_BR_PATH.has(code)) return { code, effective: null, reason: "no_br_path" };
    const parent = mappableParent(code, this.one);
    if (parent) {
      return { code, effective: parent, row: this.one.get(parent)!, normalization: "parent_category" };
    }
    return { code, effective: null, reason: "unknown" };
  }

  private cardinality(effective: string, row: Row): Cardinality {
    if (hasNoMapping(row)) return "no_mapping";
    if (row["icd11_class_kind"] === "block") return "block";
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
    const f = this.foundation.get(effective);
    const n = f?.["relation_n"];
    return {
      code,
      titleEn: row["icd11_title"] ?? null,
      titlePt: this.entityOf(code)?.title ?? null,
      kind: row["icd11_class_kind"] ?? null,
      table,
      foundationUri: row["icd11_foundation_uri"] ?? null,
      linearizationUri: row["icd11_linearization_uri"] ?? null,
      relation: f?.["relation"] ?? null,
      relationN: n ? Number.parseInt(n, 10) : null,
      cardinality,
      normalization,
    };
  }

  /** OneCategory target first, then the distinct MultipleCategories targets. */
  private targetsFor(r: Resolved & { effective: string }): Target[] {
    const card = this.cardinality(r.effective, r.row);
    const out: Target[] = [];
    // Same predicate as the Python package: a row with a code or a kind yields a target.
    if (r.row["icd11_code"] || r.row["icd11_class_kind"]) {
      out.push(this.target(r.row, "one", r.effective, r.normalization, card));
    }
    const seen = new Set(out.map((t) => t.code));
    for (const m of this.multiple.get(r.effective) ?? []) {
      const c = m["icd11_code"];
      if (c && !seen.has(c)) {
        out.push(this.target(m, "multiple", r.effective, r.normalization, card));
        seen.add(c);
      }
    }
    return out;
  }

  /** Everything the map and the Brazilian table know about an ICD-10 code, plus its targets. */
  lookup(input: string): Lookup {
    const r = this.resolve(input);
    const info = this.br.info(r.code);
    let reason: Reason;
    let targets: Target[] = [];
    if (r.effective === null) {
      reason = r.reason;
    } else {
      reason = hasNoMapping(r.row)
        ? "no_mapping"
        : r.normalization === "exact" ? "mapped" : "parent_category";
      targets = this.targetsFor(r);
    }
    return {
      input,
      code: r.code,
      reason,
      effectiveCode: r.effective,
      brTitle: info.title,
      existsInBr: info.exists,
      active2019: info.active2019,
      targets,
    };
  }

  /** `lookup()` plus the raw WHO rows (one / multiple / foundation) behind it. */
  explain(input: string): Explanation {
    const base = this.lookup(input);
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
