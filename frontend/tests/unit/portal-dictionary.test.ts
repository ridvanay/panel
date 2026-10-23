import { describe, expect, it } from "vitest";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";
import { siteDictionary as es } from "@/lib/i18n/site-dictionaries/es";
import { siteDictionary as de } from "@/lib/i18n/site-dictionaries/de";
import { siteDictionary as ar } from "@/lib/i18n/site-dictionaries/ar";
import { siteDictionary as ru } from "@/lib/i18n/site-dictionaries/ru";
import { getSiteDictionary, hasSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { validateEmergencyNoticeText } from "@/lib/emergency-notice";

/**
 * Paket A2 (2026-10-18) — site sözlüklerinin (portal dahil) eksiksiz olması. Paket L (2026-10-23):
 * es/de/ar/ru eklendi. Tip sistemi EKSİK anahtarı derlemede yakalar; bu test ayrıca FAZLA anahtarı,
 * boş değeri ve `{param}` yer tutucularının her dilde EN ile aynı olmasını çalışma zamanında doğrular.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

const enFlat = flatten(en as unknown as Tree);
const OTHERS = { tr, es, de, ar, ru } as const;

describe.each(Object.entries(OTHERS))("site sözlüğü — %s / EN eşliği", (code, dict) => {
  const flat = flatten(dict as unknown as Tree);

  it("EN ile aynı anahtar kümesine sahip", () => {
    expect([...flat.keys()].sort()).toEqual([...enFlat.keys()].sort());
  });

  it("hiçbir değer boş değil", () => {
    expect([...flat].filter(([, value]) => value.trim() === "").map(([key]) => key)).toEqual([]);
  });

  it("yer tutucular ({param}) EN ile aynı", () => {
    const mismatched = [...enFlat.keys()].filter((key) => placeholders(enFlat.get(key)!).join() !== placeholders(flat.get(key) ?? "").join());
    expect(mismatched).toEqual([]);
  });

  it("acil durum metinleri admin doğrulama sınırlarına uyar", () => {
    expect(validateEmergencyNoticeText(dict.telehealth.emergencyNoticeSummary, "summary", code)).toBeNull();
    expect(validateEmergencyNoticeText(dict.telehealth.emergencyNoticeFull, "full", code)).toBeNull();
    expect(dict.telehealth.emergencyNoticeFull).toContain("112");
  });

  it("şablon HTML'leri EN ile aynı etiket iskeletine sahip", () => {
    const tags = (html: string) => html.replace(/>[^<]*</g, "><");
    expect(tags(dict.portal.richEditor.templateEpicrisisHtml)).toBe(tags(en.portal.richEditor.templateEpicrisisHtml));
    expect(tags(dict.portal.richEditor.templatePrescriptionHtml)).toBe(tags(en.portal.richEditor.templatePrescriptionHtml));
  });
});

describe("site sözlükleri — yükleme", () => {
  it("altı dilin sözlüğü vardır; bilinmeyen dil EN'e düşer", async () => {
    for (const code of ["en", "tr", "es", "de", "ar", "ru"]) expect(hasSiteDictionary(code)).toBe(true);
    expect(hasSiteDictionary("fr")).toBe(false);
    expect((await getSiteDictionary("ru")).nav.login).toBe(ru.nav.login);
    expect((await getSiteDictionary("fr")).nav.login).toBe(en.nav.login);
  });

  it("portal bölümü kapsamlı (hasta, doktor, sihirbaz, hata kodları)", () => {
    for (const section of ["patientNav", "patientBookings", "doctorConsole", "doctorEarnings", "wizard", "identity", "intake", "calendar", "errors"]) {
      expect(en.portal).toHaveProperty(section);
    }
    expect(tr.portal.appointmentStatus.ENDED).toBe("Sona erdi");
    expect(en.portal.appointmentStatus.ENDED).toBe("Ended");
  });
});
