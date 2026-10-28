import { describe, expect, it } from "vitest";
import { findOtherScriptCandidates, replaceNameInContent } from "../../src/lib/doctor-name-content";

/**
 * Metin içi tam ad kısaltma kuralları: büyük/küçük harf ve Türkçe karakter duyarsız eşleşme, ekler,
 * unvan önekleri, yalnızca ad/soyad, HTML etiket/öznitelik koruması, başka alfabe adayları.
 */
const r = (text: string, full = "Hakan SOFU", display = "H. Sofu") => replaceNameInContent(text, full, display);

describe("replaceNameInContent", () => {
  it.each([
    ["Prof. Dr. Hakan Sofu graduated in 2006.", "Prof. Dr. H. Sofu graduated in 2006."],
    ["HAKAN SOFU", "H. Sofu"],
    ["hakan sofu", "H. Sofu"],
    ["Hakan SOFU’s experience", "H. Sofu’s experience"],
    ["Prof. Dr. Hakan Sofu'nun deneyimi", "Prof. Dr. H. Sofu'nun deneyimi"],
    ["Op. Dr. Hakan  Sofu ve Doç. Dr. Hakan Sofu", "Op. Dr. H. Sofu ve Doç. Dr. H. Sofu"],
    ["Проф. д-р Hakan Sofu", "Проф. д-р H. Sofu"],
    ["أ. د. Hakan Sofu طبيب", "أ. د. H. Sofu طبيب"],
  ])("%s", (input, expected) => {
    expect(r(input).value).toBe(expected);
  });

  it("Türkçe karakter duyarsız: Dogukan Yildirim = Doğukan YILDIRIM", () => {
    const { value, count } = r("Prof. Dr. Doğukan Yıldırım (Dogukan Yildirim) is …", "Doğukan YILDIRIM", "D. Yıldırım");
    expect(value).toBe("Prof. Dr. D. Yıldırım (D. Yıldırım) is …");
    expect(count).toBe(2);
    expect(r("Ali Firat", "Ali FIRAT", "A. Fırat").value).toBe("A. Fırat");
    expect(r("Ayşe Zehra Özdemir Kaya began", "Ayşe Zehra ÖZDEMİR KAYA", "A. Z. Özdemir Kaya").value).toBe("A. Z. Özdemir Kaya began");
  });

  it("tek başına ad ya da soyad ve kelime içi eşleşme değişmez", () => {
    for (const text of ["Dr. Sofu says", "Hakan is", "Hakan Sofuoğlu", "XHakan Sofu", "Hakan, Sofu"]) {
      expect(r(text)).toEqual({ value: text, count: 0 });
    }
  });

  it("HTML: yalnızca metin düğümleri; etiket ve öznitelik içleri korunur", () => {
    const html = '<p title="Hakan Sofu"><a href="/doctors/hakan-sofu" data-name="HAKAN SOFU">Hakan Sofu</a> — <strong>Prof. Dr. Hakan SOFU</strong></p>';
    const { value, count } = r(html);
    expect(value).toBe('<p title="Hakan Sofu"><a href="/doctors/hakan-sofu" data-name="HAKAN SOFU">H. Sofu</a> — <strong>Prof. Dr. H. Sofu</strong></p>');
    expect(count).toBe(2);
  });
});

describe("başka alfabe adayları (yalnızca rapor)", () => {
  it("Kiril ve Arapça yazımlar bulunur, Latin metin aday sayılmaz", () => {
    expect(findOtherScriptCandidates("Проф. д-р Хакан Софу работает", "Hakan SOFU")).toEqual(["Хакан Софу"]);
    expect(findOtherScriptCandidates("<p>Доктор Али Фырат</p>", "Ali FIRAT")).toEqual(["Али Фырат"]);
    expect(findOtherScriptCandidates("أ. د. هاكان صوفو طبيب", "Hakan SOFU")).toEqual(["هاكان صوفو"]);
    expect(findOtherScriptCandidates("Prof. Dr. Hakan Sofu", "Hakan SOFU")).toEqual([]);
  });
});
