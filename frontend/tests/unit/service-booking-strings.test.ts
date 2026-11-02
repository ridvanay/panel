import { describe, expect, it } from "vitest";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";
import { siteDictionary as ar } from "@/lib/i18n/site-dictionaries/ar";
import { siteDictionary as de } from "@/lib/i18n/site-dictionaries/de";
import { siteDictionary as es } from "@/lib/i18n/site-dictionaries/es";
import { siteDictionary as fr } from "@/lib/i18n/site-dictionaries/fr";
import { siteDictionary as ro } from "@/lib/i18n/site-dictionaries/ro";
import { siteDictionary as ru } from "@/lib/i18n/site-dictionaries/ru";
import { siteDictionary as sr } from "@/lib/i18n/site-dictionaries/sr-latn";
import { MEETING_DICTIONARIES } from "@/lib/i18n/use-meeting-strings";

/** AI İş 3 — `serviceBooking` sözlüğü ve misafir toplantı amaç metinleri: 9 dilde aynı anahtarlar/yer tutucular, hekim sözcüğü yok. */
const DICTS = { en, tr, ar, de, es, fr, ro, ru, "sr-latn": sr };
const KEYS = Object.keys(en.serviceBooking).sort();
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("serviceBooking sözlüğü (9 dil)", () => {
  it.each(Object.entries(DICTS))("%s: EN ile aynı anahtarlar, boş değer yok, yer tutucular korunur", (code, dict) => {
    expect(Object.keys(dict.serviceBooking).sort()).toEqual(KEYS);
    for (const key of KEYS as (keyof typeof en.serviceBooking)[]) {
      expect(dict.serviceBooking[key].trim().length, `${code}.${key}`).toBeGreaterThan(0);
      expect(placeholders(dict.serviceBooking[key]), `${code}.${key}`).toBe(placeholders(en.serviceBooking[key]));
    }
  });

  it("tr klasörü EN metin taşır (Türkçe ziyaretçiye kapalı); diğer 7 dil çevrilmiştir", () => {
    expect(tr.serviceBooking).toEqual(en.serviceBooking);
    for (const code of ["ar", "de", "es", "fr", "ro", "ru", "sr-latn"] as const) {
      expect(DICTS[code].serviceBooking.pageTitle, code).not.toBe(en.serviceBooking.pageTitle);
      expect(DICTS[code].serviceBooking.manageInvalidBody, code).not.toBe(en.serviceBooking.manageInvalidBody);
    }
    expect(ar.serviceBooking.pageTitle).toMatch(/[؀-ۿ]/);
    expect(JSON.stringify(sr.serviceBooking)).not.toMatch(/[Ѐ-ӿ]/);
  });

  it("EN: zorunlu ifadeler (ücretsiz, koordinatörle 30 dk görüntülü görüşme, tıbbi muayene notu, katılım bağlantısı)", () => {
    const s = en.serviceBooking;
    expect(s.freeLabel).toBe("Free of charge");
    expect(s.badgeDuration).toBe("30-minute video consultation with a patient coordinator");
    expect(s.medicalNote).toBe("This is not a medical examination. Medical assessment and treatment decisions are made by physicians at authorized healthcare facilities.");
    expect(s.successJoin).toContain("A link to join has been sent to your e-mail.");
    expect(s.successJoin).toContain("opens 15 minutes before");
    expect(s.coordinatorTitle).toBe("Patient Coordinator");
    expect(s.callbackLink).toBe("Request a call back");
    expect(s.requestPickTimePrompt).toBe("Prefer to pick a time?");
    expect(s.requestPickTimeLink).toBe("Book a consultation");
  });

  it("EN: izinli beyan dışında hekim sözcüğü yok", () => {
    const text = Object.values(en.serviceBooking).join("\n").replace(/physicians at authorized healthcare facilities/gi, "");
    expect(text).not.toMatch(/\b(doctors?|physicians?|surgeons?)\b|\bDr\./i);
  });
});

describe("misafir toplantı amaç metinleri", () => {
  const purposeKeys = ["guestPurposeTitle", "guestPurposeIntermediary", "guestPurposeNotice", "guestPurposeWaitingTitle", "guestPurposeWaitingBody"] as const;

  it.each(Object.entries(MEETING_DICTIONARIES))("%s: amaç anahtarları dolu", (code, dict) => {
    for (const key of purposeKeys) expect(dict[key].trim().length, `${code}.${key}`).toBeGreaterThan(0);
  });

  it("EN metinleri kontrata birebir uyar; diğer dillerde çevrilmiştir", () => {
    const m = MEETING_DICTIONARIES.en!;
    expect(m.guestPurposeTitle).toBe("Online consultation with your WM Health patient coordinator");
    expect(m.guestPurposeWaitingTitle).toBe("Your coordinator will admit you shortly");
    expect(m.guestPurposeNotice).toContain("This is not a medical examination.");
    for (const code of ["ar", "de", "es", "fr", "ro", "ru", "sr-latn"]) expect(MEETING_DICTIONARIES[code]!.guestPurposeTitle, code).not.toBe(m.guestPurposeTitle);
  });
});
