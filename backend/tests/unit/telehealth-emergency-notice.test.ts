import { describe, expect, it } from "vitest";
import {
  UpdateEmergencyNoticeRequestSchema,
  applyEmergencyNoticeUpdate,
  hasRequiredKeyword,
  mergeTelehealthSettings,
  parseEmergencyNotice,
} from "../../src/modules/telehealth/lib/emergency-notice";

const SUMMARY_EN = "Not for emergencies. In an emergency, call your local emergency number.";
const FULL_EN =
  "This platform is not for emergencies and is not a substitute for emergency medical care. In an emergency, call your local emergency number.";
const FULL_TR = "Bu platform acil durumlar için kullanılamaz ve acil tıbbi bakımın yerine geçmez.";
/** Anahtar kelime kuralı OLMAYAN bir dilde saf uzunluk sınırı testi için. */
const pad = (n: number) => "x".repeat(n);

describe("parseEmergencyNotice", () => {
  it("kayıt yoksa/bozuksa şerit AÇIK ve admin metni yok (varsayılan)", () => {
    for (const raw of [undefined, null, "x", 42, [], {}, { emergencyNotice: "bozuk" }, { emergencyNotice: { enabled: "false" } }]) {
      expect(parseEmergencyNotice(raw)).toEqual({ enabled: true, summary: {}, full: {} });
    }
  });

  it("anahtar kelimesi olmayan kayıtlı EN/TR metni atılır (sözlük varsayılanına düşer), diğer diller korunur", () => {
    const parsed = parseEmergencyNotice({
      emergencyNotice: { summary: { en: "Please read carefully.", tr: "Lütfen dikkatle okuyun.", de: "Nicht für Notfälle." }, full: {} },
    });
    expect(parsed.summary).toEqual({ de: "Nicht für Notfälle." });
  });

  it("yalnızca açıkça false ise kapalı", () => {
    expect(parseEmergencyNotice({ emergencyNotice: { enabled: false } }).enabled).toBe(false);
  });

  it("kurala uymayan metinleri (kısa, uzun, HTML, geçersiz dil kodu) sessizce atar", () => {
    const parsed = parseEmergencyNotice({
      emergencyNotice: {
        summary: { en: SUMMARY_EN, tr: "kısa", de: "<b>Nicht für Notfälle</b> bitte", "EN!": SUMMARY_EN, fr: 5 },
        full: { en: `  ${FULL_EN}  `, tr: `acil ${pad(297)}`, de: pad(301) },
      },
    });
    expect(parsed.summary).toEqual({ en: SUMMARY_EN });
    expect(parsed.full).toEqual({ en: FULL_EN });
  });
});

describe("UpdateEmergencyNoticeRequestSchema", () => {
  const parse = (body: unknown) => UpdateEmergencyNoticeRequestSchema.safeParse(body);

  it("geçerli anahtar ve metinleri kabul eder, boşlukları kırpar", () => {
    const result = parse({ enabled: false, summary: { en: `  ${SUMMARY_EN} ` }, full: { tr: FULL_TR } });
    expect(result.success).toBe(true);
    expect(result.success && result.data.summary?.en).toBe(SUMMARY_EN);
  });

  it("null (varsayılana dön) kabul edilir", () => {
    expect(parse({ summary: { en: null }, full: { tr: null } }).success).toBe(true);
  });

  it.each([
    ["boş özet", { summary: { en: "" } }],
    ["yalnızca boşluk", { summary: { en: "          " } }],
    ["9 karakterlik özet", { summary: { en: "123456789" } }],
    ["91 karakterlik özet", { summary: { de: pad(91) } }],
    ["19 karakterlik tam metin", { full: { de: pad(19) } }],
    ["301 karakterlik tam metin", { full: { de: pad(301) } }],
    ["EN özet 'emergency' içermiyor", { summary: { en: "Please call your doctor first." } }],
    ["EN tam metin 'emergency' içermiyor", { full: { en: "This platform does not replace urgent medical care at all." } }],
    ["TR özet 'acil' içermiyor", { summary: { tr: "Lütfen önce doktorunuzu arayın." } }],
    ["TR tam metin 'acil' içermiyor", { full: { tr: "Bu platform tıbbi bakımın yerine geçmez, doktorunuza danışın." } }],
    ["HTML etiketi", { full: { en: `<script>alert(1)</script> ${FULL_EN}` } }],
    ["HTML yorum", { summary: { en: "<!-- gizli --> Not for emergencies" } }],
    ["geçersiz dil kodu", { summary: { "en_US!": SUMMARY_EN } }],
    ["boş gövde", {}],
    ["enabled string", { enabled: "false" }],
  ])("reddeder: %s", (_label, body) => {
    expect(parse(body).success).toBe(false);
  });

  it("sınır değerleri kabul eder (özet 10/90, tam metin 20/300)", () => {
    expect(parse({ summary: { de: pad(10) } }).success).toBe(true);
    expect(parse({ summary: { de: pad(90) } }).success).toBe(true);
    expect(parse({ full: { de: pad(20) } }).success).toBe(true);
    expect(parse({ full: { de: pad(300) } }).success).toBe(true);
    expect(parse({ full: { en: `emergency ${pad(290)}` } }).success).toBe(true);
  });

  it("anahtar kelime hatası ilgili dile işaret eder ve anlaşılır mesaj verir", () => {
    const result = parse({ summary: { tr: "Lütfen önce doktorunuzu arayın." } });
    expect(result.success).toBe(false);
    const issue = !result.success ? result.error.issues[0] : undefined;
    expect(issue?.path).toEqual(["summary", "tr"]);
    expect(issue?.message).toBe('TR metni "acil" kelimesini içermelidir.');
  });
});

describe("hasRequiredKeyword", () => {
  it("büyük/küçük harf duyarsız; Türkçe İ/I varyantları kabul", () => {
    expect(hasRequiredKeyword("en", "EMERGENCY only")).toBe(true);
    // "emergencies" ≠ "emergency" (alt dize değil) — kural kelimenin kendisini ister.
    expect(hasRequiredKeyword("en", "Emergencies only")).toBe(false);
    expect(hasRequiredKeyword("tr", "ACİL DURUM")).toBe(true);
    expect(hasRequiredKeyword("tr", "ACIL DURUM")).toBe(true);
    expect(hasRequiredKeyword("tr", "Acil")).toBe(true);
    expect(hasRequiredKeyword("tr", "emergency")).toBe(false);
    expect(hasRequiredKeyword("en", "acil")).toBe(false);
  });

  it("EN/TR dışındaki dillerde kontrol uygulanmaz", () => {
    expect(hasRequiredKeyword("de", "Nicht für Notfälle")).toBe(true);
    expect(hasRequiredKeyword("fr", "x")).toBe(true);
  });
});

describe("applyEmergencyNoticeUpdate / mergeTelehealthSettings", () => {
  it("kısmi güncelleme: belirtilmeyen alanlar korunur, null o dili siler", () => {
    const current = { enabled: true, summary: { en: SUMMARY_EN, tr: "Acil durumlar için kullanılamaz." }, full: { en: FULL_EN } };
    const next = applyEmergencyNoticeUpdate(current, { summary: { tr: null } });
    expect(next).toEqual({ enabled: true, summary: { en: SUMMARY_EN }, full: { en: FULL_EN } });
    expect(applyEmergencyNoticeUpdate(current, { enabled: false }).summary).toEqual(current.summary);
  });

  it("birleştirme ham JSON'daki diğer alanları korur (tema kaydı uyarıyı silmez, uyarı kaydı temayı silmez)", () => {
    const raw = { primaryColor: "#123456", emergencyNotice: { enabled: false, summary: { en: SUMMARY_EN }, full: {} }, future: 1 };
    const afterTheme = mergeTelehealthSettings(raw, { primaryColor: "#654321", accentColor: "#abcdef" });
    expect(afterTheme).toEqual({ ...raw, primaryColor: "#654321", accentColor: "#abcdef" });
    const afterNotice = mergeTelehealthSettings(afterTheme, { emergencyNotice: { enabled: true, summary: {}, full: {} } });
    expect(afterNotice).toMatchObject({ primaryColor: "#654321", accentColor: "#abcdef", future: 1 });
  });
});
