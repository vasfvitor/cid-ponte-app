import { describe, expect, it } from "vitest";

import { isSimple, isValid11, kind10, normalize10, parse11, split11, undot10 } from "../src/bridge";
import { parseDelimited } from "../src/bridge/dsv";
import { browserUrl, codingToolUrl } from "../src/data/sources";

describe("normalize10", () => {
  it("adds the dot and uppercases", () => {
    expect(normalize10("i219")).toBe("I21.9");
    expect(normalize10(" I21.9 ")).toBe("I21.9");
    expect(normalize10("I21 9")).toBe("I21.9");
    expect(normalize10("A00")).toBe("A00");
    expect(normalize10("b1800")).toBe("B18.00");
  });
  it("passes blocks, chapters and junk through", () => {
    expect(normalize10("A00-A09")).toBe("A00-A09");
    expect(normalize10("xxii")).toBe("XXII");
    expect(normalize10("ZZZZ")).toBe("ZZZZ");
  });
  it("empty becomes null", () => {
    expect(normalize10("")).toBeNull();
    expect(normalize10("   ")).toBeNull();
    expect(normalize10(null)).toBeNull();
  });
  it("undot and kind", () => {
    expect(undot10("I21.9")).toBe("I219");
    expect(kind10("I21.9")).toBe("subcategory");
    expect(kind10("I21")).toBe("category");
    expect(kind10("A00-A09")).toBe("block");
    expect(kind10("IX")).toBe("chapter");
  });
});

describe("parse11", () => {
  it("decomposes clusters and extensions", () => {
    const t = parse11("1C41/1G40&XN1P6")!;
    expect(t.stems).toEqual(["1C41", "1G40"]);
    expect(t.extensions).toEqual(["XN1P6"]);
    expect(isSimple(t)).toBe(false);
    expect(split11("1C41/1G40&XN1P6")).toEqual(["1C41", "1G40", "XN1P6"]);
  });
  it("simple stem", () => {
    const t = parse11("BA00.Z")!;
    expect(isSimple(t)).toBe(true);
    expect(parse11("")).toBeNull();
    expect(parse11(null)).toBeNull();
  });
  it("syntax check", () => {
    expect(isValid11("BA00.Z")).toBe(true);
    expect(isValid11("5A11")).toBe(true);
    expect(isValid11("XN1P6")).toBe(true);
    expect(isValid11("I219")).toBe(false);
    expect(isValid11("OA00")).toBe(false);
  });
});

describe("parseDelimited (python csv semantics)", () => {
  it("handles quotes, escaped quotes, CRLF and embedded newlines", () => {
    const text = 'a\tb\tc\r\n1\t"x, ""y"""\tz\r\n2\t"multi\nline"\tw\r\n';
    expect(parseDelimited(text, "\t")).toEqual([
      ["a", "b", "c"],
      ["1", 'x, "y"', "z"],
      ["2", "multi\nline", "w"],
    ]);
  });
  it("quote in the middle of a field is literal", () => {
    expect(parseDelimited('a,5" tall,b', ",")).toEqual([["a", '5" tall', "b"]]);
  });
  it("no trailing newline, trailing delimiter, unclosed quote", () => {
    expect(parseDelimited("a,b", ",")).toEqual([["a", "b"]]);
    expect(parseDelimited("a,\n", ",")).toEqual([["a", ""]]);
    expect(parseDelimited("a,", ",")).toEqual([["a", ""]]);
    expect(parseDelimited('a,"open\nx', ",")).toEqual([["a", "open\nx"]]);
  });
});

describe("WHO links (formats checked against icd.who.int on 2026-10-18)", () => {
  it("coding tool and browser URLs", () => {
    expect(codingToolUrl("2026-01")).toBe("https://icd.who.int/ct/icd11_mms/pt/2026-01");
    expect(browserUrl("2026-01", "http://id.who.int/icd/entity/761947693")).toBe(
      "https://icd.who.int/browse/2026-01/mms/pt#761947693",
    );
    expect(browserUrl("2026-01", null)).toBeNull();
  });
});
