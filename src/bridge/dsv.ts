/**
 * Minimal delimiter-separated parser with Python `csv` module semantics (QUOTE_MINIMAL,
 * doublequote): a field is quoted only when it starts with a quote; "" inside quotes is a
 * literal quote; newlines inside quotes continue the field; after the closing quote, any
 * characters up to the delimiter are appended (non-strict).
 *
 * Fields are taken with `slice`, never built character by character: on the 37k-row
 * SimpleTabulation that is the difference between ~300 MB of transient heap and a few MB.
 *
 * Used for the SimpleTabulation (tab, quoted titles) and the embedded Brazilian CSV.
 * The mapping .txt files have no quotes and are split directly in tables.ts.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const n = text.length;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;

  const scanUnquoted = (from: number): number => {
    let k = from;
    while (k < n) {
      const c = text[k];
      if (c === delimiter || c === "\n" || c === "\r") break;
      k++;
    }
    return k;
  };

  while (i < n) {
    let field: string;
    if (text[i] === '"') {
      let start = i + 1;
      let parts: string[] | null = null;
      for (;;) {
        const q = text.indexOf('"', start);
        if (q === -1) {
          // unclosed quote: the rest of the text is the field
          field = (parts ? parts.join("") : "") + text.slice(start);
          i = n;
          break;
        }
        if (text[q + 1] === '"') {
          (parts ??= []).push(text.slice(start, q + 1));
          start = q + 2;
          continue;
        }
        const end = scanUnquoted(q + 1); // non-strict trailing characters
        field = (parts ? parts.join("") : "") + text.slice(start, q) + text.slice(q + 1, end);
        i = end;
        break;
      }
    } else {
      const end = scanUnquoted(i);
      field = text.slice(i, end);
      i = end;
    }
    row.push(field);
    if (i >= n) break;
    if (text[i] === delimiter) {
      i++;
      if (i >= n) row.push(""); // trailing delimiter: one more empty field
      continue;
    }
    if (text[i] === "\r" && text[i + 1] === "\n") i++;
    i++;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function emptyToNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/** Parse with a header row and return the rows plus a column accessor by header name. */
export function parseWithHeader(
  text: string, delimiter: string,
): { rows: string[][]; col: (name: string) => number } {
  const all = parseDelimited(stripBom(text), delimiter);
  const header = all[0] ?? [];
  return { rows: all.slice(1), col: (name) => header.indexOf(name) };
}
