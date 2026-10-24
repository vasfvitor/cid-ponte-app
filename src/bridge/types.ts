/**
 * Output contract of the bridge. Mirrors cid-ponte (Python) field by field; the golden
 * fixtures in tests/fixtures are generated from the Python package and must match exactly.
 *
 * Fields that come from WHO: code, titleEn, kind, foundationUri, linearizationUri, relation,
 * relationN. titlePt comes from WHO's official "pt" release.
 * Fields added by this project (WHO terms of use, clause 1.2.5): cardinality, normalization,
 * reason, existsInBr, active2019, brTitle.
 */

export type Reason =
  | "mapped"
  // A subcategory absent from the map falls back to its 3-char category, for one of three reasons:
  | "place_of_occurrence" // 4th character is place of occurrence (W00–Y34 except Y06–Y07)
  | "parent_category" // another Brazilian subcategory WHO does not list (e.g. K35.0)
  | "not_in_br" // not a Brazilian code at all (e.g. a typo like I21.7)
  | "no_mapping" // WHO row exists but declares no target
  | "no_br_path" // Brazilian national code with no path in the WHO map
  | "unknown" // not in the map, not a known Brazilian exception
  | "empty";

export type Cardinality = "1:1" | "1:N" | "block" | "no_mapping";
export type Normalization = "exact" | "parent_category";
export type TableName = "one" | "multiple";

export interface Target {
  code: string | null; // null when the target is a block (no code)
  titleEn: string | null;
  titlePt: string | null;
  kind: string | null; // WHO ClassKind of the target: category | block
  table: TableName;
  foundationUri: string | null;
  linearizationUri: string | null;
  // Equivalent | Subclass (WHO foundation table). Only on the OneCategory target: the
  // foundation table describes that one; null on MultipleCategories alternatives.
  relation: string | null;
  relationN: number | null; // 0 = stated on the entity itself, -k = inherited k levels up
  cardinality: Cardinality; // 1:N = 2+ distinct targets over OneCategory ∪ MultipleCategories
  normalization: Normalization;
}

export interface Lookup {
  input: string;
  code: string; // normalized ICD-10 code (dotted), "" when empty
  reason: Reason;
  effectiveCode: string | null; // code actually used in the map (same, or the parent category)
  brTitle: string | null;
  existsInBr: boolean;
  active2019: boolean;
  targets: Target[];
}

export interface Origin10 {
  code: string;
  titleEn: string | null;
  brTitle: string | null;
  existsInBr: boolean;
}

/** What the app keeps from a SimpleTabulation entity (WHO), indexed by MMS code. */
export interface Entity11 {
  title: string | null; // pt
  titleEn: string | null;
  isResidual: boolean;
}

/** A raw row of one of the WHO mapping tables, keyed by the column names in tables.ts. */
export type Row = Record<string, string | null>;
