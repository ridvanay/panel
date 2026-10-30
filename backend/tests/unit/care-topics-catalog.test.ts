import { describe, expect, it } from "vitest";
import { BODY_AREAS, CARE_TOPIC_CATALOG } from "../../src/lib/care-topics/catalog";
import { CARE_TOPIC_TEXTS, careTopicContentHash, isUnchangedSinceSeed, stableStringify } from "../../src/lib/care-topics/seed";
import { foldTerm, textContainsTerm } from "../../src/lib/matcher-text";

/**
 * Paket W-ek — katalog bütünlüğü (seed girdisi): 9 dilde metin ve 8–15 eş anlamlı, kullanıcı
 * düzeltmeleri, ve KIRMIZI BAYRAK TETİKLEYİCİLERİNİN başka konunun eş anlamlısıyla ÇAKIŞMAMASI
 * (normal bir şikayeti yazan hastaya yanlış 112 uyarısı çıkmasın).
 */
const LANGS = ["en", "tr", "de", "fr", "es", "ru", "ar", "ro", "sr-latn"];
const bySlug = new Map(CARE_TOPIC_CATALOG.map((t) => [t.slug, t]));
const termsOf = (slug: string, lang?: string) =>
  (lang ? [lang] : LANGS).flatMap((l) => {
    const text = CARE_TOPIC_TEXTS[l]![slug];
    return text ? [text.label, ...text.synonyms] : [];
  });

describe("care-topics kataloğu (Paket W-ek)", () => {
  it("332 kayıt: 314 konu + 18 kırmızı bayrak; slug'lar tekil; 19 bölge", () => {
    expect(CARE_TOPIC_CATALOG).toHaveLength(332);
    expect(CARE_TOPIC_CATALOG.filter((t) => t.isRedFlag)).toHaveLength(18);
    expect(new Set(CARE_TOPIC_CATALOG.map((t) => t.slug)).size).toBe(332);
    expect(BODY_AREAS).toHaveLength(19);
    for (const area of BODY_AREAS) expect(CARE_TOPIC_CATALOG.some((t) => t.bodyArea === area)).toBe(true);
  });

  it("her konu 9 dilde etiket + açıklama + 8–15 eş anlamlı (\"something-else\" hariç)", () => {
    const problems: string[] = [];
    for (const topic of CARE_TOPIC_CATALOG) {
      for (const lang of LANGS) {
        const text = CARE_TOPIC_TEXTS[lang]![topic.slug];
        if (!text?.label) {
          problems.push(`${topic.slug}:${lang} etiket yok`);
          continue;
        }
        if (topic.slug === "something-else") continue;
        if (text.synonyms.length < 8 || text.synonyms.length > 15) problems.push(`${topic.slug}:${lang} ${text.synonyms.length} eş anlamlı`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("koordinatöre giden (ağırlıksız) her konunun doğal uzmanlık ipucu var; kırmızı bayrak eşlenmez", () => {
    const missing = CARE_TOPIC_CATALOG.filter((t) => !t.isRedFlag && Object.keys(t.weights).length === 0 && !t.targetSpecialtyHint && t.slug !== "something-else");
    expect(missing.map((t) => t.slug)).toEqual([]);
    expect(CARE_TOPIC_CATALOG.filter((t) => t.isRedFlag && Object.keys(t.weights).length > 0)).toEqual([]);
  });

  it("kullanıcı düzeltmeleri: adenomyosis ONC 40; leg-pain-cramps koordinatör; claudication IR 40; iki öneri kırmızı bayrak eklendi", () => {
    expect(bySlug.get("adenomyosis")!.weights).toEqual({ "interventional-radiology-specialist": 40, "ivf-and-reproductive-health": 30, "surgical-oncology": 40 });
    expect(bySlug.get("leg-pain-cramps")!.weights).toEqual({});
    expect(bySlug.get("leg-pain-cramps")!.targetSpecialtyHint).toBe("Kardiyoloji / Damar cerrahisi");
    expect(bySlug.get("claudication")!.weights).toEqual({ "interventional-radiology-specialist": 40 });
    expect(bySlug.get("rf-sudden-testicular-pain")!.isRedFlag).toBe(true);
    expect(bySlug.get("rf-infant-fever")!.isRedFlag).toBe(true);
    expect(bySlug.get("varicose-veins")!.bodyArea).toBe("heart-vessels");
  });

  it("daraltılmış tetikleyiciler: \"ilaç içti\", tek başına \"bayıldı/bayıldım\", \"gözüm karardı\" kırmızı bayrak değil", () => {
    const folded = (slug: string) => termsOf(slug).map(foldTerm);
    expect(folded("rf-poisoning")).not.toContain(foldTerm("ilaç içti"));
    expect(folded("rf-poisoning")).toEqual(expect.arrayContaining([foldTerm("aşırı doz"), foldTerm("çamaşır suyu içti")]));
    expect(folded("rf-loss-of-consciousness")).not.toContain(foldTerm("bayıldı"));
    expect(folded("rf-loss-of-consciousness")).not.toContain(foldTerm("bayıldım"));
    expect(folded("rf-loss-of-consciousness")).toEqual(expect.arrayContaining([foldTerm("kendine gelmiyor"), foldTerm("uyandıramıyorum")]));
    expect(folded("rf-sudden-vision-loss")).not.toContain(foldTerm("gözüm karardı"));
    // Geçmiş bayılma normal konuda.
    expect(termsOf("fainting-episodes", "tr").map(foldTerm).some((t) => t.includes("bayil"))).toBe(true);
  });

  it("ÇAKIŞMA YOK: hiçbir kırmızı bayrak terimi (hiçbir dilde) kırmızı bayrak olmayan bir konunun etiketinde/eş anlamlısında geçmez", () => {
    const redTerms = CARE_TOPIC_CATALOG.filter((t) => t.isRedFlag).flatMap((t) => termsOf(t.slug).map((term) => ({ slug: t.slug, term: foldTerm(term) })));
    const conflicts: string[] = [];
    for (const topic of CARE_TOPIC_CATALOG.filter((t) => !t.isRedFlag)) {
      for (const raw of termsOf(topic.slug)) {
        const term = foldTerm(raw);
        for (const red of redTerms) if (textContainsTerm(term, red.term)) conflicts.push(`"${raw}" (${topic.slug}) ⊃ "${red.term}" (${red.slug})`);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("örnek tetikleyiciler hâlâ kırmızı bayrak: \"göğsüm sıkışıyor\", \"nefes alamıyorum\"", () => {
    const red = CARE_TOPIC_CATALOG.filter((t) => t.isRedFlag).flatMap((t) => termsOf(t.slug).map(foldTerm));
    for (const phrase of ["göğsüm sıkışıyor", "nefes alamıyorum"]) expect(red.some((term) => textContainsTerm(foldTerm(phrase), term))).toBe(true);
  });
});

describe("seed içerik özeti", () => {
  it("anahtar sırası özeti değiştirmez (Postgres jsonb yeniden sıralar); içerik değişince özet değişir", () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    const base = { bodyArea: "head", translations: { tr: { label: "A", description: "", synonyms: ["x"] }, en: { label: "B", description: "", synonyms: [] } }, isRedFlag: false, targetSpecialtyHint: null, weights: { neurosurgery: 80 } };
    const reordered = { ...base, translations: { en: base.translations.en, tr: base.translations.tr } };
    expect(careTopicContentHash(reordered)).toBe(careTopicContentHash(base));
    expect(careTopicContentHash({ ...base, weights: { neurosurgery: 70 } })).not.toBe(careTopicContentHash(base));
    expect(careTopicContentHash({ ...base, targetSpecialtyHint: "Nöroloji" })).not.toBe(careTopicContentHash(base));
  });

  it("Paket W ile yazılmış kayıt (seedHash yok): metin aynı ve ağırlıklar o DB'de var olan uzmanlıklara süzülmüşse değişmemiş sayılır", () => {
    const content = { bodyArea: "chest", translations: { en: { label: "X", description: "", synonyms: [] } }, isRedFlag: false, targetSpecialtyHint: null, weights: { "thoracic-surgery": 100 } };
    const legacy = { hash: careTopicContentHash({ ...content, weights: {} }), weights: { "thoracic-surgery": 100, "plastic-and-aesthetic-surgery": 30 } };
    const onlyThoracic = new Map([["thoracic-surgery", "id1"]]);
    expect(isUnchangedSinceSeed(null, careTopicContentHash(content), content, legacy, onlyThoracic)).toBe(true);
    // Admin ağırlığı değiştirmiş.
    const edited = { ...content, weights: { "thoracic-surgery": 90 } };
    expect(isUnchangedSinceSeed(null, careTopicContentHash(edited), edited, legacy, onlyThoracic)).toBe(false);
    // Admin metni değiştirmiş.
    const relabeled = { ...content, translations: { en: { label: "Y", description: "", synonyms: [] } } };
    expect(isUnchangedSinceSeed(null, careTopicContentHash(relabeled), relabeled, legacy, onlyThoracic)).toBe(false);
    // Eski kayıt yoksa ya da seedHash farklıysa değişmiş.
    expect(isUnchangedSinceSeed(null, careTopicContentHash(content), content, undefined, onlyThoracic)).toBe(false);
    expect(isUnchangedSinceSeed("0".repeat(64), careTopicContentHash(content), content, legacy, onlyThoracic)).toBe(false);
  });
});
