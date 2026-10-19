import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGAL_PAGE_MAP,
  buildLegalBlocks,
  contentTextLength,
  extractTitle,
  fillPlaceholders,
  loadLegalDocument,
  loadValues,
  markdownToHtml,
} from "../../src/lib/legal-pages-publisher";

/** Paket J — yasal sayfa yükleyicisinin saf parçaları: yer tutucu, markdown, başlık, bloklar. */

const LEGAL_DIR = path.resolve(__dirname, "../../../docs/legal");
const FULL_VALUES = {
  SIRKET_UNVANI: { tr: "Örnek Sağlık A.Ş.", en: "Example Health Inc." },
  ADRES: { tr: "Örnek Mah. 1, İstanbul", en: "Ornek St. 1, Istanbul" },
  TELEFON: { tr: "+90 212 000 00 00", en: "+90 212 000 00 00" },
  SUNUCU_KONUMU: { tr: "Almanya (Hetzner)", en: "Germany (Hetzner)" },
};

describe("fillPlaceholders", () => {
  it("dile göre doldurur", () => {
    const r = fillPlaceholders("A {{ADRES}} / {{ SUNUCU_KONUMU }}", FULL_VALUES, "en");
    expect(r).toEqual({ text: "A Ornek St. 1, Istanbul / Germany (Hetzner)", missing: [] });
  });

  it("boş ya da tanımsız değer eksik sayılır ve metinde kalır", () => {
    const r = fillPlaceholders("{{ADRES}} {{TELEFON}} {{YOK}}", { ADRES: { tr: "x", en: "" }, TELEFON: { tr: "  ", en: "y" } }, "tr");
    expect(r.text).toBe("x {{TELEFON}} {{YOK}}");
    expect(r.missing).toEqual(["TELEFON", "YOK"]);
  });

  it("biçimi bozuk {{...}} da çözülmemiş sayılır", () => {
    expect(fillPlaceholders("bkz. {{şirket adı}}", FULL_VALUES, "tr").missing).toEqual(["şirket adı"]);
  });
});

describe("markdownToHtml", () => {
  it("başlık, paragraf, liste, numaralı liste, alıntı ve satır içi biçim", () => {
    const html = markdownToHtml(
      [
        "## 1. Bölüm",
        "Satır bir",
        "satır iki **kalın** ve *italik*.",
        "",
        "- madde **a**",
        "- madde b",
        "",
        "1. bir",
        "2. iki",
        "",
        "> **Uyarı:** acil durum",
        "### Alt",
        "[site](https://wmhealthistanbul.com) ve [kötü](javascript:alert(1))",
      ].join("\n")
    );
    expect(html).toContain("<h2>1. Bölüm</h2>");
    expect(html).toContain("<p>Satır bir satır iki <strong>kalın</strong> ve <em>italik</em>.</p>");
    expect(html).toContain("<ul><li>madde <strong>a</strong></li><li>madde b</li></ul>");
    expect(html).toContain("<ol><li>bir</li><li>iki</li></ol>");
    expect(html).toContain("<blockquote><p><strong>Uyarı:</strong> acil durum</p></blockquote>");
    expect(html).toContain("<h3>Alt</h3>");
    expect(html).toContain('<a href="https://wmhealthistanbul.com">site</a>');
    expect(html).not.toContain(`href="javascript:`); // güvenli olmayan şema bağlantıya dönüşmez, düz metin kalır
  });

  it("HTML'i kaçışlar (metindeki etiketler çalıştırılmaz)", () => {
    expect(markdownToHtml("<script>alert(1)</script> & \"x\"")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</p>");
  });

  it("gövdedeki # başlık h2'ye indirgenir", () => {
    expect(markdownToHtml("# Ek")).toBe("<h2>Ek</h2>");
  });
});

describe("extractTitle / buildLegalBlocks", () => {
  it("ilk # satırı başlık olur ve gövdeden çıkar; başlık yoksa hata", () => {
    expect(extractTitle("\n# KVKK Metni\n\nGövde")).toEqual({ title: "KVKK Metni", body: "\n\nGövde" });
    expect(() => extractTitle("## yok")).toThrow(/Başlık/);
  });

  it("bloklar şemadan geçer ve sanitize edilir", () => {
    const blocks = buildLegalBlocks("Başlık", "<p>ok</p><img src=x onerror=alert(1)>", "t") as Array<{ type: string; data: Record<string, string> }>;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "text"]);
    expect(blocks[1]!.data.html).not.toContain("onerror");
    expect(contentTextLength(blocks)).toBe("Başlık".length + "ok".length);
  });
});

describe("docs/legal gerçek dosyaları", () => {
  it("README'deki dört slug eşlemesi", () => {
    expect(LEGAL_PAGE_MAP.map((m) => m.slug)).toEqual(["kvkk-aydinlatma-metni-2", "acik-riza-metni-2", "kullanim-kosullari-2", "distance-service-agreement"]);
  });

  it("values.json boşken her dosya eksik anahtarları raporlar (gerçek yükleme engellenir)", async () => {
    const values = await loadValues(LEGAL_DIR);
    const doc = await loadLegalDocument(LEGAL_DIR, "kvkk-aydinlatma-metni", "tr", values);
    expect(doc.missing).toEqual(expect.arrayContaining(["ADRES", "SIRKET_UNVANI", "SUNUCU_KONUMU", "TELEFON"]));
  });

  it("değerler doluyken 8 dosyanın hepsi eksiksiz, geçerli bloklara dönüşür", async () => {
    for (const { file } of LEGAL_PAGE_MAP) {
      for (const lang of ["tr", "en"] as const) {
        const doc = await loadLegalDocument(LEGAL_DIR, file, lang, FULL_VALUES);
        expect(doc.missing, `${file}.${lang}`).toEqual([]);
        expect(doc.title.length).toBeGreaterThan(3);
        expect(JSON.stringify(doc.blocks)).not.toContain("{{");
        expect(contentTextLength(doc.blocks)).toBeGreaterThan(500);
      }
    }
  });
});
