import { describe, expect, it } from "vitest";
import { foldTerm, matchScore, textContainsTerm } from "../../src/lib/matcher-text";
import { boundedEditDistance, fuzzyMatchScore } from "../../src/lib/matcher-fuzzy";
import { rankDoctors, scoreSpecialties } from "../../src/modules/matcher/matcher.service";
import { ageBandFor, cleanFreeText, toE164 } from "../../src/modules/matcher/matcher.routes";
import { CARE_TOPIC_CATALOG } from "../../src/lib/care-topics/catalog";
import { CARE_TOPIC_TEXTS } from "../../src/lib/care-topics/seed";

describe("Paket W — arama normalleştirmesi", () => {
  it("Türkçe İ/ı, büyük/küçük harf ve aksan duyarsız", () => {
    expect(foldTerm("MİDE YANMASI")).toBe("mide yanmasi");
    expect(foldTerm("mide yanması")).toBe("mide yanmasi");
    expect(foldTerm("Mıde Yanmasi")).toBe("mide yanmasi");
    expect(foldTerm("KASIK FITIĞI")).toBe(foldTerm("kasık fıtığı"));
    expect(foldTerm("Göğüs ağrısı")).toBe("gogus agrisi");
    expect(foldTerm("Sodbrennen")).toBe("sodbrennen");
    expect(foldTerm("Fußschmerzen")).toBe("fussschmerzen");
    expect(foldTerm("ИЗЖОГА")).toBe("изжога");
    expect(foldTerm("ёлка")).toBe("елка");
    expect(foldTerm("حُرْقَة المَعِدَة")).toBe(foldTerm("حرقة المعدة"));
    expect(foldTerm("أَلَم")).toBe("الم");
    expect(foldTerm("dolor de estómago")).toBe("dolor de estomago");
  });

  it("otomatik tamamlama puanı ve serbest metin eşleşmesi kelime sınırına saygılı", () => {
    expect(matchScore("mide", foldTerm("mide yanması"))).toBe(2);
    expect(matchScore(foldTerm("mide yanması"), foldTerm("Mide yanması"))).toBe(3);
    expect(matchScore("yanma", foldTerm("mide yanması"))).toBe(2);
    expect(matchScore("xyz", "mide")).toBe(0);
    expect(textContainsTerm(foldTerm("Dün akşam nefes alamıyorum dedi"), foldTerm("nefes alamıyorum"))).toBe(true);
    expect(textContainsTerm(foldTerm("felçli değil"), foldTerm("felç"))).toBe(false);
    expect(textContainsTerm(foldTerm("ani felç geçirdi"), foldTerm("felç"))).toBe(true);
  });

  it("9 dilde eş anlamlılar: TR 'mide yanması', DE 'Sodbrennen', AR 'حرقة المعدة', RU 'изжога' reflü konusuna gider", () => {
    const syn = (lang: string) => {
      const t = CARE_TOPIC_TEXTS[lang]!["reflux-heartburn"]!;
      return [t.label, ...t.synonyms].map(foldTerm);
    };
    expect(syn("tr")).toContain(foldTerm("mide yanması"));
    expect(syn("de")).toContain(foldTerm("Sodbrennen"));
    expect(syn("ar").some((s) => s.includes(foldTerm("حرقة")))).toBe(true);
    expect(syn("ru")).toContain(foldTerm("изжога"));
  });

  it("katalog: 9 dilde her konunun metni var; sr-latn Latin, ro virgül altı; kırmızı bayrak uzmanlığa eşlenmez", () => {
    const slugs = CARE_TOPIC_CATALOG.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const [lang, texts] of Object.entries(CARE_TOPIC_TEXTS)) {
      expect(Object.keys(texts).sort(), lang).toEqual([...slugs].sort());
      for (const slug of slugs) expect(texts[slug]!.label.trim().length, `${lang}:${slug}`).toBeGreaterThan(0);
    }
    expect(JSON.stringify(CARE_TOPIC_TEXTS["sr-latn"])).not.toMatch(/[Ѐ-ӿ]/);
    expect(JSON.stringify(CARE_TOPIC_TEXTS.ro)).not.toMatch(/[şţ]/);
    for (const t of CARE_TOPIC_CATALOG.filter((x) => x.isRedFlag)) expect(Object.keys(t.weights)).toEqual([]);
    expect(CARE_TOPIC_CATALOG.filter((x) => x.isRedFlag).map((x) => x.slug)).toHaveLength(18);
    // Karar: baş ağrısı koordinatöre; ercp/esd/poem uzmanlık olarak önerilmez; diş konuları ortodontiye bağlanmaz.
    expect(CARE_TOPIC_CATALOG.find((x) => x.slug === "headache-migraine")!.weights).toEqual({});
    for (const t of CARE_TOPIC_CATALOG) for (const s of ["ercp", "esd", "poem"]) expect(t.weights[s]).toBeUndefined();
    for (const slug of ["dental-abscess", "dental-implant", "toothache", "gum-recession"]) {
      expect(CARE_TOPIC_CATALOG.find((x) => x.slug === slug)!.weights).toEqual({ dentalcare: 100 });
    }
    expect(CARE_TOPIC_CATALOG.find((x) => x.slug === "uterine-fibroids")!.weights).toEqual({ "surgical-oncology": 70, "interventional-radiology-specialist": 50, "ivf-and-reproductive-health": 30 });
  });
});

describe("Paket W — puanlama ve sıralama (saf fonksiyonlar)", () => {
  it("uzmanlık puanı seçilen konuların ağırlık toplamı", () => {
    const scores = scoreSpecialties([{ weights: [{ specialtyId: "gas", weight: 100 }, { specialtyId: "obe", weight: 40 }] }, { weights: [{ specialtyId: "obe", weight: 70 }] }]);
    expect(Object.fromEntries(scores)).toEqual({ gas: 100, obe: 110 });
  });

  it("hekim sırası: birincil > ek, dil, en yakın slot, uzmanlık sırası, ad (kurucu önceliği yok)", () => {
    const base = { primaryMatch: true, speaksLanguage: true, earliestAt: "2026-11-02T10:00:00Z", specialtyRank: 0 };
    const ranked = rankDoctors([
      { ...base, displayName: "E. Ek", primaryMatch: false },
      { ...base, displayName: "D. Dilsiz", speaksLanguage: false },
      { ...base, displayName: "G. Geç", earliestAt: "2026-11-05T10:00:00Z" },
      { ...base, displayName: "Y. Yok", earliestAt: null },
      { ...base, displayName: "B. Erken" },
      { ...base, displayName: "A. Erken" },
    ]);
    expect(ranked.map((d) => d.displayName)).toEqual(["A. Erken", "B. Erken", "G. Geç", "Y. Yok", "D. Dilsiz", "E. Ek"]);
  });

  it("telefon E.164, serbest metin temizliği, yaş bandı", () => {
    expect(toE164("TR", "0532 123 45 67")).toBe("+905321234567");
    expect(toE164("DE", "+49 151 2345 6789")).toBe("+4915123456789");
    expect(toE164("TR", "+49 151 2345 6789")).toBeNull();
    expect(toE164("TR", "12")).toBeNull();
    expect(toE164("ZZ", "5321234567")).toBeNull();
    expect(cleanFreeText("<script>alert(1)</script>Boyun <b>ağrısı</b>")).toBe("alert(1) Boyun ağrısı");
    expect(cleanFreeText("x".repeat(900))).toHaveLength(500);
    expect([ageBandFor(5), ageBandFor(17), ageBandFor(18), ageBandFor(80)]).toEqual(["0-17", "0-17", "18-29", "75+"]);
  });
});

describe("Paket W-ek — yazım hatası toleranslı arama puanı", () => {
  it("sınırlı düzenleme mesafesi (yer değiştirme = 1, sınır aşılınca max+1)", () => {
    expect(boundedEditDistance("donmesi", "donmesi", 1)).toBe(0);
    expect(boundedEditDistance("donemsi", "donmesi", 1)).toBe(1);
    expect(boundedEditDistance("schwindl", "schwindel", 1)).toBe(1);
    expect(boundedEditDistance("abc", "xyzabc", 1)).toBe(2);
  });

  it("tam > önek > içerir > yazım hatası; eşleşmeyen 0", () => {
    const term = foldTerm("Baş dönmesi");
    expect(fuzzyMatchScore(foldTerm("baş dönmesi"), term)).toBe(30);
    expect(fuzzyMatchScore(foldTerm("bas donmesi"), term)).toBe(30);
    expect(fuzzyMatchScore(foldTerm("baş dön"), term)).toBe(20);
    const typo = fuzzyMatchScore(foldTerm("bas donemsi"), term);
    expect(typo).toBeGreaterThan(0);
    expect(typo).toBeLessThan(10);
    expect(fuzzyMatchScore(foldTerm("schwindl"), foldTerm("Schwindel"))).toBeGreaterThan(0);
    expect(fuzzyMatchScore(foldTerm("migren"), term)).toBe(0);
    expect(fuzzyMatchScore("ab", "abc def")).toBe(20);
    expect(fuzzyMatchScore("xy", term)).toBe(0);
  });
});
