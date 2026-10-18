/**
 * Readers for the WHO tables: the mapping.zip .txt files we use and the SimpleTabulation.
 *
 * mapping.zip .txt format (checked on releases 2024-01, 2025-01, 2026-01): tab-separated,
 * CRLF, no BOM, no quotes; the header has one extra cell at the end (release date) and the
 * column names differ between files, so rows are read by position. foundation_10To11 has two
 * unnamed data columns (relation and an integer).
 */

import { normalize10 } from "./codes";
import { emptyToNull, parseWithHeader, stripBom } from "./dsv";
import type { Entity11, Row } from "./types";

export const MAPPING_FILES = {
  one: "10To11MapToOneCategory.txt",
  multiple: "10To11MapToMultipleCategories.txt",
  rev: "11To10MapToOneCategory.txt",
  foundationOne: "foundation_10To11MapToOneCategory.txt",
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
 * Coded entities of the SimpleTabulation indexed by MMS code, keeping only what the app reads.
 * Depth prefixes ("- - - ") are stripped from titles. `titleEn` exists only in the "pt" file.
 */
export function readSimpleTabulation(text: string): Map<string, Entity11> {
  const { rows, col } = parseWithHeader(text, "\t");
  const iCode = col("Code");
  const iTitle = col("Title");
  const iTitleEn = col("TitleEN");
  const iResidual = col("IsResidual");
  const out = new Map<string, Entity11>();
  for (const r of rows) {
    const code = emptyToNull(r[iCode]);
    if (!code) continue;
    out.set(code, {
      title: stripDepthPrefix(r[iTitle]),
      titleEn: stripDepthPrefix(r[iTitleEn]),
      isResidual: emptyToNull(r[iResidual]) === "True",
    });
  }
  return out;
}

function stripDepthPrefix(title: string | undefined): string | null {
  let t = (title ?? "").trim();
  while (t.startsWith("- ")) t = t.slice(2);
  return emptyToNull(t);
}
