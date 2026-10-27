import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPassword, sequenceCharCount } from "../../src/lib/password-policy";

/** Paket S — şifre politikası (tek kural seti; frontend kopyası birebir aynı olmalı). */
describe("Paket S — şifre politikası", () => {
  it("spec örnekleri: zayıflar reddedilir, 'Gökyüzü-Mavi7' kabul edilir", () => {
    expect(checkPassword("12345678").failed).toEqual(expect.arrayContaining(["length", "notDigitsOnly", "noSequence", "notCommon"]));
    expect(checkPassword("Password1").failed).toEqual(expect.arrayContaining(["length", "notCommon"]));
    expect(checkPassword("qwerty123!").failed).toEqual(expect.arrayContaining(["noSequence", "notCommon"]));
    expect(checkPassword("aaaaaaaaaa1A").failed).toEqual(["noSequence"]);
    expect(checkPassword("Gökyüzü-Mavi7").failed).toEqual([]);
  });

  it("uzunluk 10–128 (kod noktası); en az üç karakter grubu; Türkçe/başka alfabe harfleri harf sayılır", () => {
    expect(checkPassword("Ab1!Ab1!a").rules.length).toBe(false);
    expect(checkPassword(`Kara-Deniz-77${"x".repeat(120)}`).rules.length).toBe(false);
    expect(checkPassword("şçğüöıİŞĞ7").rules.groups).toBe(true); // küçük + büyük + rakam
    expect(checkPassword("yalnizkucukharf").rules.groups).toBe(false);
    expect(checkPassword("Kara-Deniz-77").failed).toEqual([]);
  });

  it("ardışık/tekrarlı diziler: yarısından fazlası reddedilir (rakam, alfabe, klavye, tekrar)", () => {
    expect(sequenceCharCount("abcdef")).toBe(6);
    expect(sequenceCharCount("qwerty")).toBe(6);
    expect(sequenceCharCount("11111111")).toBe(8);
    expect(sequenceCharCount("Tr4in!Station")).toBe(0);
    expect(checkPassword("abcdefgH1!").rules.noSequence).toBe(false);
    expect(checkPassword("Bahar-1234-Yaz").rules.noSequence).toBe(true); // 4/14
  });

  it("yaygın liste (büyük/küçük harf duyarsız; baştaki/sondaki rakam-sembol atılarak) + siteye özgü kelimeler", () => {
    expect(checkPassword("PASSWORD").rules.notCommon).toBe(false);
    expect(checkPassword("Istanbul2026!").rules.notCommon).toBe(false);
    expect(checkPassword("Wmhealth#2026").rules.notCommon).toBe(false);
    expect(checkPassword("!!Sifre12345").rules.notCommon).toBe(false);
    expect(checkPassword("Gökyüzü-Mavi7").rules.notCommon).toBe(true);
    // NFKC: tam genişlikli karakterler listeyi/kişisel kontrolü aşamaz (inceleme bulgusu).
    expect(checkPassword("Ｐａｓｓｗｏｒｄ１").rules.notCommon).toBe(false);
    expect(checkPassword("ＡＹＳＥ-Mavi-77", { name: "Ayşe Kaya" }).rules.notPersonal).toBe(false);
  });

  it("e-posta yerel kısmı ya da ad (Türkçe harf/aksan duyarsız) içeren şifre reddedilir", () => {
    expect(checkPassword("Ayse.Kaya2026!", { email: "ayse.kaya@example.com" }).rules.notPersonal).toBe(false);
    expect(checkPassword("Kaya-Deniz-77", { email: "ayse.kaya@example.com" }).rules.notPersonal).toBe(false);
    expect(checkPassword("Mehmet!Bahar42", { name: "Mehmet Yılmaz" }).rules.notPersonal).toBe(false);
    expect(checkPassword("YILMAZ-bahar-42", { name: "Mehmet Yılmaz" }).rules.notPersonal).toBe(false);
    expect(checkPassword("Gökyüzü-Mavi7", { email: "ayse@example.com", name: "Ayşe Kaya" }).rules.notPersonal).toBe(true);
  });

  it("güç göstergesi: geçerli şifre en az 3, uzun ve dört gruplu 4; yaygın/kişisel en fazla 1", () => {
    expect(checkPassword("").score).toBe(0);
    expect(checkPassword("Gökyüzü-Mavi7").score).toBe(3);
    expect(checkPassword("Gökyüzü-Mavi-Bulut7").score).toBe(4);
    expect(checkPassword("Password1").score).toBeLessThanOrEqual(1);
  });

  it("frontend kopyası (rehberlik) backend kural setiyle birebir aynı", () => {
    const backend = readFileSync(resolve(__dirname, "../../src/lib/password-policy.ts"), "utf8");
    const frontend = readFileSync(resolve(__dirname, "../../../frontend/src/lib/password-policy.ts"), "utf8");
    expect(frontend.replace(/\r\n/g, "\n")).toBe(backend.replace(/\r\n/g, "\n"));
    const listB = readFileSync(resolve(__dirname, "../../src/lib/common-passwords.ts"), "utf8");
    const listF = readFileSync(resolve(__dirname, "../../../frontend/src/lib/common-passwords.ts"), "utf8");
    expect(listF.replace(/\r\n/g, "\n")).toBe(listB.replace(/\r\n/g, "\n"));
  });
});
