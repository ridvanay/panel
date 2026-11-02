import { describe, expect, it } from "vitest";
import { MEETING_DICTIONARIES, fmt, meetingErrorMessage } from "@/lib/i18n/use-meeting-strings";
import { meetingStrings as en } from "@/lib/i18n/site-dictionaries/en/meeting";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { ApiClientError } from "@/lib/api/error";

/** Paket AG İş 3 — `meeting` sözlüğü: 9 dilde aynı anahtarlar, boş değer yok, yer tutucular korunur (consultation sözlüğü deseni). */
describe("meeting sözlüğü eşitliği (9 dil)", () => {
  const keys = Object.keys(en).sort();
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

  it("9 dil de kayıtlı", () => {
    expect(Object.keys(MEETING_DICTIONARIES).sort()).toEqual(["ar", "de", "en", "es", "fr", "ro", "ru", "sr-latn", "tr"]);
  });

  it.each(Object.entries(MEETING_DICTIONARIES))("%s: EN ile aynı anahtarlar, boş değer yok, yer tutucular korunur", (code, dict) => {
    expect(Object.keys(dict).sort()).toEqual(keys);
    for (const key of keys as (keyof typeof en)[]) {
      expect(dict[key].trim().length, `${code}.${key}`).toBeGreaterThan(0);
      expect(placeholders(dict[key]), `${code}.${key}`).toBe(placeholders(en[key]));
    }
  });

  it("sr-latn Latin alfabesi; ar Arapça harf içerir; tr/ar/ru/de çevrilmemiş İngilizce değil", () => {
    expect(JSON.stringify(MEETING_DICTIONARIES["sr-latn"])).not.toMatch(/[Ѐ-ӿ]/);
    expect(MEETING_DICTIONARIES.ar!.guestJoinButton).toMatch(/[؀-ۿ]/);
    for (const code of ["tr", "ar", "ru", "de", "es", "fr", "ro", "sr-latn"]) {
      expect(MEETING_DICTIONARIES[code]!.guestInvalidTitle, code).not.toBe(en.guestInvalidTitle);
      expect(MEETING_DICTIONARIES[code]!.guestWaitingTitle, code).not.toBe(en.guestWaitingTitle);
    }
  });

  it("Arapça sağdan sola (RTL), diğerleri soldan sağa", () => {
    expect(localeDirection("ar")).toBe("rtl");
    for (const code of ["tr", "en", "de", "ru", "es", "fr", "ro", "sr-latn"]) expect(localeDirection(code)).toBe("ltr");
  });

  it("S9 başlık uyarısı ve S5 'eski bağlantıyı geçersiz kılar' uyarısı her dilde bulunur ve boş değildir", () => {
    for (const [code, dict] of Object.entries(MEETING_DICTIONARIES)) {
      expect(dict.titleGuestWarning.length, code).toBeGreaterThan(10);
      expect(dict.regenBody.length, code).toBeGreaterThan(20);
      expect(dict.linkOnceWarning.length, code).toBeGreaterThan(20);
    }
    // Türkçe (admin paneli) metinleri kullanıcı kararındaki ifadeyle uyumlu.
    expect(MEETING_DICTIONARIES.tr!.titleGuestWarning).toMatch(/Misafirlere görünür/);
    expect(MEETING_DICTIONARIES.tr!.titleGuestWarning).toMatch(/Hasta adı yazmayın/);
    expect(MEETING_DICTIONARIES.tr!.twoFactorAdvice).toBe("Hesabınızı korumak için iki adımlı doğrulamayı açmanızı öneririz.");
    expect(MEETING_DICTIONARIES.tr!.regenBody).toMatch(/eski bağlantıyı geçersiz kılar/);
  });
});

describe("meetingErrorMessage — ham sunucu metni ekrana verilmez", () => {
  const t = MEETING_DICTIONARIES.en!;
  const err = (status: number, code: string) => new ApiClientError(status, { code: code as never, message: "RAW SERVER TEXT" });

  it("kodlar çevrilmiş mesaja eşlenir", () => {
    expect(meetingErrorMessage(err(403, "MEETING_HOST_FORBIDDEN"), t)).toBe(t.errForbidden);
    expect(meetingErrorMessage(err(404, "MEETING_NOT_FOUND"), t)).toBe(t.errNotFound);
    expect(meetingErrorMessage(err(409, "MEETING_LIMIT_REACHED"), t)).toBe(t.errLimit);
    expect(meetingErrorMessage(err(409, "MEETING_NOT_EDITABLE"), t)).toBe(t.errNotEditable);
    expect(meetingErrorMessage(err(422, "MEETING_HOST_NOT_ELIGIBLE"), t)).toBe(t.errNotEligible);
    expect(meetingErrorMessage(err(429, "RATE_LIMITED"), t)).toBe(t.errRate);
    expect(meetingErrorMessage(err(503, "LIVEKIT_NOT_CONFIGURED"), t)).toBe(t.errUnavailable);
    expect(meetingErrorMessage(err(0, "NETWORK_ERROR"), t)).toBe(t.errNetwork);
  });

  it("bilinmeyen hata genel mesaja düşer; ham metin sızmaz", () => {
    const message = meetingErrorMessage(err(500, "INTERNAL_ERROR"), t);
    expect(message).toBe(t.errGeneric);
    expect(message).not.toContain("RAW");
    expect(meetingErrorMessage(new Error("boom"), t)).toBe(t.errGeneric);
  });

  it("fmt yer tutucuları doldurur", () => {
    expect(fmt(t.hostedByLine, { name: "Ada" })).toBe("Host: Ada");
  });
});
