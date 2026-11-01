import { describe, expect, it } from "vitest";
import { CONSULTATION_DICTIONARIES } from "@/lib/i18n/use-consultation-strings";
import { consultationStrings as en } from "@/lib/i18n/site-dictionaries/en/consultation";
import { getSiteDictionary, hasSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { classifyConnectionError, classifyMediaFailure, failureMessage, isTerminalFailure } from "@/components/site/telehealth/room/connection-errors";
import { ApiClientError } from "@/lib/api/error";

/** Paket AF — `consultation` sözlüğü: 9 dilde aynı anahtarlar, boş değer yok, yer tutucular korunur (paket X deseni). */
describe("consultation sözlüğü eşitliği (9 dil)", () => {
  const keys = Object.keys(en).sort();
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

  it("9 dil de kayıtlı", () => {
    expect(Object.keys(CONSULTATION_DICTIONARIES).sort()).toEqual(["ar", "de", "en", "es", "fr", "ro", "ru", "sr-latn", "tr"]);
  });

  it.each(Object.entries(CONSULTATION_DICTIONARIES))("%s: EN ile aynı anahtarlar, boş değer yok, yer tutucular korunur", (code, dict) => {
    expect(Object.keys(dict).sort()).toEqual(keys);
    for (const key of keys as (keyof typeof en)[]) {
      expect(dict[key].trim().length, `${code}.${key}`).toBeGreaterThan(0);
      expect(placeholders(dict[key]), `${code}.${key}`).toBe(placeholders(en[key]));
    }
  });

  it("sr-latn Latin alfabesi; ar Arapça harf içerir; tr/ar/ru çevrilmemiş İngilizce değil", () => {
    expect(JSON.stringify(CONSULTATION_DICTIONARIES["sr-latn"])).not.toMatch(/[Ѐ-ӿ]/);
    expect(CONSULTATION_DICTIONARIES.ar!.joinButton).toMatch(/[؀-ۿ]/);
    for (const code of ["tr", "ar", "ru", "de", "es", "fr", "ro", "sr-latn"]) {
      expect(CONSULTATION_DICTIONARIES[code]!.reconnectButton, code).not.toBe(en.reconnectButton);
    }
  });

  it("sunucu sözlüğüne (getSiteDictionary) her dilde `consultation` bölümü kayıtlı", async () => {
    for (const code of Object.keys(CONSULTATION_DICTIONARIES)) {
      expect(hasSiteDictionary(code)).toBe(true);
      const dict = await getSiteDictionary(code);
      expect(Object.keys(dict.consultation).sort(), code).toEqual(keys);
    }
  });

  it("Arapça sağdan sola (RTL), diğerleri soldan sağa", () => {
    expect(localeDirection("ar")).toBe("rtl");
    for (const code of ["tr", "en", "de", "ru", "es", "fr", "ro", "sr-latn"]) expect(localeDirection(code)).toBe("ltr");
  });
});

describe("bağlantı hatası sınıflandırması — ham metin ekrana verilmez", () => {
  it("token ucu hataları nedene göre sınıflanır", () => {
    expect(classifyConnectionError(new ApiClientError(401, { code: "UNAUTHORIZED", message: "x" }))).toBe("permission");
    expect(classifyConnectionError(new ApiClientError(403, { code: "FORBIDDEN", message: "x" }))).toBe("permission");
    expect(classifyConnectionError(new ApiClientError(409, { code: "APPOINTMENT_NOT_JOINABLE", message: "x" }))).toBe("notJoinable");
    expect(classifyConnectionError(new ApiClientError(0, { code: "NETWORK_ERROR", message: "x" }))).toBe("unreachable");
    expect(classifyConnectionError(new ApiClientError(502, { code: "INTERNAL_ERROR", message: "x" }))).toBe("unreachable");
  });

  it("SDK hataları: ConnectionError nedeni, DOMException adı, mesaj ipuçları; bilinmeyen → generic", () => {
    expect(classifyConnectionError({ reason: 0, status: 401 })).toBe("permission");
    expect(classifyConnectionError({ reason: 1 })).toBe("unreachable");
    expect(classifyConnectionError({ reason: 5 })).toBe("unreachable");
    expect(classifyConnectionError({ name: "NotAllowedError" })).toBe("mediaPermission");
    expect(classifyConnectionError({ name: "NotFoundError" })).toBe("mediaNotFound");
    expect(classifyConnectionError({ name: "NotReadableError" })).toBe("mediaInUse");
    expect(classifyConnectionError(new Error("Failed to fetch"))).toBe("unreachable");
    expect(classifyConnectionError(new Error("tamamen bilinmeyen"))).toBe("generic");
    expect(classifyConnectionError(undefined)).toBe("generic");
  });

  it("MediaDeviceFailure değerleri; yalnızca yetki/süre nedenleri 'terminal'", () => {
    expect(classifyMediaFailure("PermissionDenied")).toBe("mediaPermission");
    expect(classifyMediaFailure("NotFound")).toBe("mediaNotFound");
    expect(classifyMediaFailure("DeviceInUse")).toBe("mediaInUse");
    expect(classifyMediaFailure("Other")).toBe("media");
    expect(classifyMediaFailure(undefined)).toBe("media");
    expect(isTerminalFailure("permission")).toBe(true);
    expect(isTerminalFailure("notJoinable")).toBe(true);
    expect(isTerminalFailure("unreachable")).toBe(false);
  });

  it("her neden her dilde çevrilmiş (boş olmayan, ham metin içermeyen) bir mesaj üretir", () => {
    const kinds = ["unreachable", "permission", "notJoinable", "mediaPermission", "mediaNotFound", "mediaInUse", "media", "generic"] as const;
    for (const dict of Object.values(CONSULTATION_DICTIONARIES)) {
      for (const kind of kinds) expect(failureMessage(kind, dict).length).toBeGreaterThan(10);
    }
  });
});
