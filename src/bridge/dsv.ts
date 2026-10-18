/**
 * Minimal delimiter-separated parser with Python `csv` module semantics (QUOTE_MINIMAL,
 * doublequote): a field is quoted only when it starts with a quote; "" inside quotes is a
 * literal quote; newlines inside quotes continue the field; after the closing quote, any
 * characters up to the delimiter are appended (non-strict).
 *
 * Used for the SimpleTabulation (tab, quoted titles) and the embedded Brazilian CSV.
 * The mapping .txt files have no quotes and are split directly in tables.ts.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  const n = text.length;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (ch === '"' && field === "") {
      // quoted field
      i++;
      let closed = false;
      while (i < n) {
        const q = text[i]!;
        if (q === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        field += q;
        i++;
      }
      if (!closed) break;
      // non-strict: append anything up to the delimiter / newline
      while (i < n && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") {
        field += text[i]!;
        i++;
      }
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function emptyToNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}
