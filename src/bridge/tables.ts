/**
 * Readers for the WHO tables: the five .txt files of mapping.zip and the SimpleTabulation.
 *
 * mapping.zip .txt format (checked on releases 2024-01, 2025-01, 2026-01): tab-separated,
 * CRLF, no BOM, no quotes; the header has one extra cell at the end (release date) and the
 * column names differ between files, so rows are read by position. foundation_10To11 has two
 * unnamed data columns (relation and an integer); foundation_11To10 has one column fewer than
 * its header.
 */

import { normalize10 } from "./codes";
import { emptyToNull, parseDelimited, stripBom } from "./dsv";
import type { Entity11, Row } from "./types";

export const MAPPING_FILES = {
  one: "10To11MapToOneCategory.txt",
  multiple: "10To11MapToMultipleCategories.txt",
  rev: "11To10MapToOneCategory.txt",
  foundationOne: "foundation_10To11MapToOneCategory.txt",
  foundationRev: "foundation_11To10MapToOneCategory.txt",
} as const;

export type MappingTable = keyof typeof MAPPING_FILES;

const ONE_COLUMNS = [
  "icd10_class_kind", "icd10_depth", "icd10_code", "icd10_chapter", "icd10_title",
  "icd11_class_kind", "icd11_depth", "icd11_foundation_uri", "icd11_linearization_uri",
  "icd11_code", "icd11_chapter", "icd11_title",
];

const COLUMNS: Record<MappingTable, readonly string[]> = {
  one: ONE_COLUMNS,
  multiple: ONE_COLUMNS,
  rev: [
    "icd11_linearization_uri", "icd11_code", "icd11_chapter", "icd11_title",
    "icd10_code", "icd10_chapter", "icd10_title",
  ],
  foundationOne: [
    "icd10_class_kind", "icd10_depth", "icd10_code", "icd10_chapter", "icd10_title",
    "icd11_foundation_uri", "icd11_title", "relation", "relation_n",
  ],
  foundationRev: [
    "icd11_foundation_uri", "icd11_code", "icd11_chapter", "icd11_title",
    "icd10_code", "icd10_title",
  ],
};

export function simpleTabulationFile(lang = "pt"): string {
  return `SimpleTabulation-ICD-11-MMS-${lang}.txt`;
}

/** Rows of one mapping table. `icd10_code` comes out normalized; empty cells become null. */
export function readMappingTable(text: string, table: MappingTable): Row[] {
  const cols = COLUMNS[table];
  const body = stripBom(text);
  const lines = body.includes("\r\n") ? body.split("\r\n") : body.split("\n");
  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cells = line.split("\t");
    const row: Row = {};
    cols.forEach((c, i) => {
      row[c] = emptyToNull(cells[i]);
    });
    if ("icd10_code" in row) row["icd10_code"] = normalize10(row["icd10_code"]);
    out.push(row);
  }
  return out;
}

/**
 * Coded entities of the SimpleTabulation indexed by MMS code. Depth prefixes ("- - - ")
 * are stripped from titles. `titleEn` exists only in the "pt" file (TitleEN column).
 */
export function readSimpleTabulation(text: string): Map<string, Entity11> {
  const rows = parseDelimited(stripBom(text), "\t");
  const header = rows[0] ?? [];
  const col = (name: string): number => header.indexOf(name);
  const iCode = col("Code");
  const iTitle = col("Title");
  const iTitleEn = col("TitleEN");
  const iFound = col("Foundation URI");
  const iLin = col("Linearization URI");
  const iKind = col("ClassKind");
  const iChapter = col("ChapterNo");
  const iResidual = col("IsResidual");
  const iLeaf = col("isLeaf");
  const cell = (r: string[], i: number): string | undefined => (i >= 0 ? r[i] : undefined);

  const out = new Map<string, Entity11>();
  for (const r of rows.slice(1)) {
    const code = (cell(r, iCode) ?? "").trim();
    if (!code) continue;
    out.set(code, {
      code,
      title: stripDepthPrefix(cell(r, iTitle)),
      titleEn: iTitleEn >= 0 ? stripDepthPrefix(cell(r, iTitleEn)) : null,
      foundationUri: emptyToNull(cell(r, iFound)),
      linearizationUri: emptyToNull(cell(r, iLin)),
      classKind: emptyToNull(cell(r, iKind)),
      chapter: emptyToNull(cell(r, iChapter)),
      isResidual: (cell(r, iResidual) ?? "").trim() === "True",
      isLeaf: (cell(r, iLeaf) ?? "").trim() === "True",
    });
  }
  return out;
}

function stripDepthPrefix(title: string | undefined): string | null {
  if (title === undefined) return null;
  let t = title.trim();
  while (t.startsWith("- ")) t = t.slice(2);
  return t || null;
}
