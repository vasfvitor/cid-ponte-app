/** Code syntax: ICD-10 normalization and ICD-11 target parsing. Pure functions, no data. */

// ICD-10: letter + 2 digits, optional dot and 1–2 characters (BR uses up to the 4th; WHO has B18.00)
const ICD10 = /^([A-Z]\d{2})[.\s]?([A-Z0-9]{0,2})$/;
// Block (A00-A09) or chapter (I, XXII) — appear in the icd10Code column of WHO tables
const BLOCK = /^[A-Z]\d{2}-[A-Z]\d{2}$/;
const CHAPTER = /^[IVX]+$/;

/**
 * Normalize an ICD-10 code to dotted form: "i219" -> "I21.9", "A00" -> "A00".
 * Accepts undotted (SUS microdata), dotted, with space, lowercase. Blocks and chapters pass
 * through with trim/upper only. Empty becomes null. Unrecognized strings come back
 * trimmed/uppercased for the caller to decide.
 */
export function normalize10(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const c = String(code).trim().toUpperCase();
  if (!c) return null;
  const m = ICD10.exec(c);
  if (!m) return c;
  const cat = m[1]!;
  const sub = m[2]!;
  return sub ? `${cat}.${sub}` : cat;
}

/** "I21.9" -> "I219" (form used by CAUSABAS / DIAG_PRINC fields in SUS data). */
export function undot10(code: string): string {
  return code.replace(".", "");
}

/** 3-character category: "W00.0" -> "W00". */
export function category10(code: string): string {
  return code.slice(0, 3);
}

export type Kind10 = "category" | "subcategory" | "block" | "chapter" | "other";

export function kind10(code: string): Kind10 {
  if (BLOCK.test(code)) return "block";
  if (CHAPTER.test(code)) return "chapter";
  const m = ICD10.exec(code);
  if (!m) return "other";
  return m[2] ? "subcategory" : "category";
}

// ---------------------------------------------------------------- ICD-11

// MMS stem: 4 characters (no O/I in first position), optional .X or .XX.
// Extension (chapter X): X + 3 to 5 characters (XT5R, XN1P6, XA8EC5).
const STEM11 = /^(?:[0-9A-HJ-NP-WYZ][A-Z0-9]{3}(?:\.[A-Z0-9]{1,2})?|X[A-Z0-9]{3,5})$/;

/**
 * An ICD-11 target as it appears in WHO tables, decomposed.
 * `raw` is the original string ("1C41/1G40&XN1P6"); `stems` are the stem codes (cluster
 * members, separated by "/"); `extensions` the extension codes ("&"), in order.
 */
export interface Target11 {
  raw: string;
  stems: string[];
  extensions: string[];
}

/** Single stem, no extension — fits in an ordinary code field. */
export function isSimple(t: Target11): boolean {
  return t.stems.length === 1 && t.extensions.length === 0;
}

/** Decompose a target: "/" separates stems (cluster), "&" attaches extensions. */
export function parse11(raw: string | null | undefined): Target11 | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim();
  if (!s) return null;
  const stems: string[] = [];
  const extensions: string[] = [];
  for (const member of s.split("/")) {
    const parts = member.split("&");
    if (parts[0]) stems.push(parts[0]);
    for (const p of parts.slice(1)) if (p) extensions.push(p);
  }
  if (stems.length === 0) return null;
  return { raw: s, stems, extensions };
}

/** All codes of a target: "1C41/1G40&XN1P6" -> ["1C41", "1G40", "XN1P6"]. */
export function split11(raw: string | null | undefined): string[] {
  const t = parse11(raw);
  return t ? [...t.stems, ...t.extensions] : [];
}

/** Syntax of a single MMS stem or extension code (does not consult the classification). */
export function isValid11(code: string): boolean {
  return STEM11.test(code);
}
