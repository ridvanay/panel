import { describe, expect, it } from "vitest";
import { CUSTOM_VARIABLE_KEY_PATTERN, slugifyVariableKey } from "@/lib/email-blocks/variable-key";

describe("slugifyVariableKey", () => {
  it("Türkçe karakterleri ASCII'ye indirger ve boşlukları alt çizgiye çevirir", () => {
    expect(slugifyVariableKey("Telefon Numarası")).toBe("telefon_numarasi");
  });

  it("Çalışan Adı → çalışan_adı ASCII'siz hale gelir (backend PLACEHOLDER_PATTERN \\w ile eşleşir)", () => {
    const key = slugifyVariableKey("Çalışan Adı");
    expect(CUSTOM_VARIABLE_KEY_PATTERN.test(key)).toBe(true);
  });

  it("rakamla başlayan girdinin önüne harf ekler (anahtar bir HARFLE başlamalı)", () => {
    const key = slugifyVariableKey("2. Telefon");
    expect(key[0]).toMatch(/[a-z]/);
    expect(CUSTOM_VARIABLE_KEY_PATTERN.test(key)).toBe(true);
  });

  it("40 karakteri aşan girdiyi kırpar", () => {
    const long = "a".repeat(60);
    expect(slugifyVariableKey(long).length).toBeLessThanOrEqual(40);
  });

  it("boş girdi için boş string döner", () => {
    expect(slugifyVariableKey("   ")).toBe("");
  });
});

describe("CUSTOM_VARIABLE_KEY_PATTERN", () => {
  it("backend ^[a-z][a-z0-9_]{0,39}$ ile birebir aynı davranır", () => {
    expect(CUSTOM_VARIABLE_KEY_PATTERN.test("user_name")).toBe(true);
    expect(CUSTOM_VARIABLE_KEY_PATTERN.test("2fa")).toBe(false); // rakamla başlıyor
    expect(CUSTOM_VARIABLE_KEY_PATTERN.test("Kullanici")).toBe(false); // büyük harf
    expect(CUSTOM_VARIABLE_KEY_PATTERN.test("a".repeat(41))).toBe(false); // 40 karakter sınırı
  });
});
