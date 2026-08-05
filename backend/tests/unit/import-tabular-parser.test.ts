import { describe, expect, it } from "vitest";
import { parseTabular } from "../../src/modules/import/parsers/tabular.parser";
import { ValidationError } from "../../src/lib/errors";

describe("parseTabular (CSV)", () => {
  it("parses a BOM-prefixed, quoted CSV with embedded commas", () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const csv = Buffer.concat([bom, Buffer.from('title,contentHtml\n"Hello, World","<p>a, b</p>"\n')]);
    const { sourceFields, records } = parseTabular(csv, "CSV");
    expect(sourceFields).toEqual(["title", "contentHtml"]);
    expect(records).toEqual([{ title: "Hello, World", contentHtml: "<p>a, b</p>" }]);
  });

  it("tolerates ragged column counts (relax_column_count)", () => {
    const csv = Buffer.from("title,slug\nHello,hello,extra\n");
    const { records } = parseTabular(csv, "CSV");
    expect(records).toHaveLength(1);
  });

  it("skips empty lines", () => {
    const csv = Buffer.from("title,slug\nHello,hello\n\n\nWorld,world\n");
    const { records } = parseTabular(csv, "CSV");
    expect(records).toHaveLength(2);
  });

  it("rejects a CSV with an unclosed quote (malformed CSV — `Quote Not Closed`)", () => {
    // `csv-parse` bunu bir yapısal ayrıştırma hatası olarak fırlatır — `parseTabular` bunu
    // yakalayıp `ValidationError`'a çevirmeli (uçtan uca 422'ye eşlenir, bkz.
    // tests/integration/import.test.ts::"Bozuk/malformed CSV").
    const csv = Buffer.from('title,slug\n"Kapanmayan tirnak,slug1\nIkinciSatir,slug2\n');
    expect(() => parseTabular(csv, "CSV")).toThrow(ValidationError);
  });

  it("does not throw on stray invalid-UTF-8 bytes inside a field (tolerant, not a crash)", () => {
    // Gerçek bir "geçersiz encoding" senaryosu: `csv-parse` bunu bir HATA olarak fırlatmaz,
    // baytları olduğu gibi (garbled) bir string'e çevirir — bu BİLİNÇLİ/beklenen bir davranıştır,
    // sunucunun çökmesi/500 dönmesi YERİNE satır yine de işlenebilir bir kayda dönüşür.
    const buf = Buffer.concat([Buffer.from("title,slug\n"), Buffer.from([0xff, 0xfe, 0x00]), Buffer.from(",bad\n")]);
    expect(() => parseTabular(buf, "CSV")).not.toThrow();
  });
});

describe("parseTabular (JSON)", () => {
  it("accepts a bare array", () => {
    const { records, sourceFields } = parseTabular(Buffer.from(JSON.stringify([{ title: "A" }, { title: "B" }])), "JSON");
    expect(records).toHaveLength(2);
    expect(sourceFields).toEqual(["title"]);
  });

  it("accepts an { items: [...] } wrapper", () => {
    const { records } = parseTabular(Buffer.from(JSON.stringify({ items: [{ title: "A" }] })), "JSON");
    expect(records).toHaveLength(1);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseTabular(Buffer.from("{not valid json"), "JSON")).toThrow(ValidationError);
  });

  it("rejects a JSON object that is neither an array nor { items }", () => {
    expect(() => parseTabular(Buffer.from(JSON.stringify({ foo: "bar" })), "JSON")).toThrow(ValidationError);
  });

  it("rejects a non-object entry inside the array", () => {
    expect(() => parseTabular(Buffer.from(JSON.stringify(["not-an-object"])), "JSON")).toThrow(ValidationError);
  });
});
