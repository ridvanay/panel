import { describe, expect, it } from "vitest";
import { normalizeGuestName, validateGuestName } from "@/components/site/meeting/guest-name";

/** Paket AG İş 3 — misafir adı doğrulaması: sunucu tasarım §6.5 / §9.1(12) tablosunun birebir aynası. */
describe("validateGuestName", () => {
  it.each(["Zeynep Kaya", "José María", "محمد", "O'Brien", "Anne-Marie", "Ali", "Jo", "Dr. Ayşe K.", "Мария Иванова", "Ana 2"])("kabul: %s", (name) => {
    const result = validateGuestName(name);
    expect(result.ok, name).toBe(true);
  });

  it("1 karakter reddedilir (kısa)", () => {
    expect(validateGuestName("A")).toEqual({ ok: false, reason: "tooShort" });
    expect(validateGuestName("   ")).toEqual({ ok: false, reason: "tooShort" });
  });

  it("41 karakter reddedilir (uzun); 40 karakter kabul", () => {
    expect(validateGuestName("a".repeat(41))).toEqual({ ok: false, reason: "tooLong" });
    expect(validateGuestName("a".repeat(40)).ok).toBe(true);
  });

  it("HTML / yasak karakterler reddedilir", () => {
    for (const name of ["<script>", "Ali<b>", "a&b", 'a"b', "a/b", "a:b", "1Ali", "-Ali"]) {
      expect(validateGuestName(name), name).toEqual({ ok: false, reason: "invalidChars" });
    }
  });

  it("bidi geçersiz kılma, sıfır genişlikli boşluk ve kontrol karakterleri reddedilir", () => {
    for (const name of ["Ali\u202Eveli", "Ali\u200Bveli", "Ali\u2066veli", "Ali\u200Fveli", "Ali\u0000veli", "Ali\u009Fveli"]) {
      expect(validateGuestName(name), JSON.stringify(name)).toEqual({ ok: false, reason: "invalidChars" });
    }
  });

  it("rezerve önekler reddedilir (büyük/küçük harf duyarsız)", () => {
    for (const name of ["meet-host:x", "Meet-guest", "doctor:1", "patient:abc", "interpreter:z", "qa-listener-1", "DOCTOR:1"]) {
      const result = validateGuestName(name);
      expect(result.ok, name).toBe(false);
    }
    expect(validateGuestName("meet-host:x")).toEqual({ ok: false, reason: "reservedPrefix" });
    expect(validateGuestName("doctor:1")).toEqual({ ok: false, reason: "reservedPrefix" });
  });

  it("çıktı NFC, kırpılmış ve iç boşlukları tek", () => {
    const decomposed = "Jose\u0301  Maria"; // e + birleşik vurgu
    const result = validateGuestName(`  ${decomposed}  `);
    expect(result).toEqual({ ok: true, value: "José Maria" });
    if (result.ok) expect(result.value).toBe(result.value.normalize("NFC"));
    expect(normalizeGuestName("a \t b")).toBe("a b");
  });
});
