import { describe, expect, it } from "vitest";
import { buildOtherScriptPatterns, findOtherScriptCandidates, fullNamePattern, otherScriptMappingsFor, replaceNameInContent } from "../../src/lib/doctor-name-content";

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
    // Kısaltma sonrası tekrar eden parantez ("D. Yıldırım (D. Yıldırım)") kaldırılır: 2 ad + 1 temizlik.
    expect(value).toBe("Prof. Dr. D. Yıldırım is …");
    expect(count).toBe(3);
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

describe("canlıdaki adlarla aday desenleri (regresyon: Kiril soyad kısaltması grubu ortadan kesiyordu)", () => {
  const NAMES = ["Kadir KOLCUOĞLU", "Ali FIRAT", "Hakan SOFU", "Doğukan YILDIRIM", "Kamil ÖZDİL", "Ayşe Zehra ÖZDEMİR KAYA", "Hasan Tuna Türkmen", "Vahit MUTLU"];

  it.each(NAMES)("%s: Kiril ve Arapça desenler hatasız kurulur; tam ad deseni kurulur", (name) => {
    const { patterns, surnamePatterns, errors } = buildOtherScriptPatterns(name);
    expect(errors).toEqual([]);
    expect(patterns).toHaveLength(2);
    expect(surnamePatterns).toHaveLength(1);
    expect(() => fullNamePattern(name)).not.toThrow();
    // Desenler gerçekten çalışır (çökmez) ve Latin metinde aday üretmez.
    expect(findOtherScriptCandidates(`Prof. Dr. ${name} — Проф. д-р текст — أ. د. نص`, name)).toEqual([]);
  });

  it("ğ/ç/ş/ı/ö/ü içeren soyadlar Kiril ve Arapça yazımda aday olarak bulunur", () => {
    expect(findOtherScriptCandidates("Ортодонт д-р Кадир Колджуоглу", "Kadir KOLCUOĞLU")).toEqual(["Кадир Колджуоглу"]);
    expect(findOtherScriptCandidates("Проф. д-р Догукан Йылдырым", "Doğukan YILDIRIM")).toEqual(["Догукан Йылдырым"]);
    expect(findOtherScriptCandidates("Проф. д-р Камиль Озкан", "Kamil ÖZDİL")).toEqual([]);
    expect(findOtherScriptCandidates("Доц. д-р Айше Захра Оздемир Кая", "Ayşe Zehra ÖZDEMİR KAYA")).toEqual(["Айше Захра Оздемир Кая"]);
  });

  // Gerçek Arapça yazımlar — mantıksal (okuma) sırasıyla; ekranda sağdan sola görünür.
  const ARABIC_NAMES: [string, string, string][] = [
    ["Kadir KOLCUOĞLU", "قادر كولجو أوغلو", "كولجو أوغلو"],
    ["Ali FIRAT", "علي فرات", "فرات"],
    ["Hakan SOFU", "هاكان صوفو", "صوفو"],
    ["Doğukan YILDIRIM", "دوغوكان يلدريم", "يلدريم"],
    ["Kamil ÖZDİL", "كامل أوزديل", "أوزديل"],
    ["Ayşe Zehra ÖZDEMİR KAYA", "عائشة زهراء أوزدمير قايا", "قايا"],
    ["Hasan Tuna Türkmen", "حسن طونا تركمان", "تركمان"],
    ["Vahit MUTLU", "وحيد موتلو", "موتلو"],
  ];

  it.each(ARABIC_NAMES)("%s: Arapça tam ad (%s) aday olarak bulunur", (name, arabic) => {
    expect(findOtherScriptCandidates(`أ. د. ${arabic} طبيب`, name)).toEqual([arabic]);
  });

  it.each(ARABIC_NAMES)("%s: Arapça soyad tek başına (%s) aday olarak bulunur", (name, _arabic, surname) => {
    expect(findOtherScriptCandidates(`يعمل الدكتور ${surname} في إسطنبول`, name)).toEqual([surname]);
  });

  it("علي فرات ve tek başına فرات bulunur; tam ad eşleşmesinin içindeki soyad ikinci kez listelenmez", () => {
    expect(findOtherScriptCandidates("أ. د. علي فرات طبيب. ويقول فرات إن", "Ali FIRAT")).toEqual(["علي فرات", "فرات"]);
    // Mantıksal sıra: ع (U+0639) ل (U+0644) ي (U+064A) — ters dizilim ("يلع") eşleşmez.
    expect([..."علي"].map((c) => c.codePointAt(0))).toEqual([0x0639, 0x0644, 0x064a]);
    expect(findOtherScriptCandidates("يلع تارف", "Ali FIRAT")).toEqual([]);
  });
});

describe("tekrarlayan parantez ve başka alfabe için sabit eşleme", () => {
  const dogukan = (text: string) => replaceNameInContent(text, "Doğukan YILDIRIM", "D. Yıldırım", otherScriptMappingsFor("Doğukan YILDIRIM"));

  it("X (X) → X: parantez içi önündeki adla aynıysa kaldırılır; farklı parantez kalır", () => {
    expect(dogukan("Prof. Dr. Doğukan Yıldırım (Dogukan Yildirim) is …").value).toBe("Prof. Dr. D. Yıldırım is …");
    expect(dogukan("Prof. Dr. D. Yıldırım (D. Yıldırım)").value).toBe("Prof. Dr. D. Yıldırım");
    expect(dogukan("Prof. Dr. Doğukan Yıldırım (Memorial Ataşehir)").value).toBe("Prof. Dr. D. Yıldırım (Memorial Ataşehir)");
  });

  it("Rusça ve Arapça ad + arkasındaki Latin parantez eşlemeye göre değişir", () => {
    expect(dogukan("Проф. д-р Догукан Йылдырым (Doğukan Yıldırım) — гинеколог").value).toBe("Проф. д-р Д. Йылдырым — гинеколог");
    expect(dogukan("أ. د. دوغوكان يلدريم (Doğukan Yıldırım) طبيب").value).toBe("أ. د. يلدريم طبيب");
    // Parantezsiz yazım da değişir; Latin kısmı zaten kısaltılmış parantez de kaldırılır.
    expect(dogukan("Догукан Йылдырым").value).toBe("Д. Йылдырым");
    expect(dogukan("دوغوكان يلدريم (D. Yıldırım)").value).toBe("يلدريم");
  });

  it("Kamil Özdil ve Ayşe Zehra Özdemir Kaya eşlemeleri; yalnızca tam yazım değişir", () => {
    const kamil = (t: string) => replaceNameInContent(t, "Kamil ÖZDİL", "K. Özdil", otherScriptMappingsFor("Kamil ÖZDİL")).value;
    expect(kamil("Проф. д-р Камиль Оздиль")).toBe("Проф. д-р К. Оздиль");
    expect(kamil("أ. د. كامل أوزديل")).toBe("أ. د. أوزديل");
    expect(kamil("Камиль Оздилев")).toBe("Камиль Оздилев");
    const ayse = (t: string) => replaceNameInContent(t, "Ayşe Zehra ÖZDEMİR KAYA", "A. Z. Özdemir Kaya", otherScriptMappingsFor("Ayşe Zehra ÖZDEMİR KAYA")).value;
    expect(ayse("Доц. д-р Айше Зехра Оздемир Кая")).toBe("Доц. д-р А. З. Оздемир Кая");
    expect(ayse("عائشة زهراء أوزدمير كايا (Ayşe Zehra Özdemir Kaya)")).toBe("أوزدمير كايا");
    // Eşlemedeki yazımdan farklıysa (ق ile) değişmez — yalnızca listelenir.
    expect(ayse("عائشة زهراء أوزدمير قايا")).toBe("عائشة زهراء أوزدمير قايا");
  });

  it("eşleme yalnızca kendi doktoruna uygulanır; eşlemede olmayan adlar değişmez", () => {
    expect(otherScriptMappingsFor("Doğukan YILDIRIM")).toHaveLength(2);
    expect(otherScriptMappingsFor("Dogukan Yildirim")).toHaveLength(2);
    expect(otherScriptMappingsFor("Hakan SOFU")).toEqual([]);
    expect(replaceNameInContent("Хакан Софу и Догукан Йылдырым", "Hakan SOFU", "H. Sofu", otherScriptMappingsFor("Hakan SOFU")).value).toBe("Хакан Софу и Догукан Йылдырым");
  });

  it("HTML: eşleme de yalnızca metin düğümlerinde", () => {
    expect(dogukan('<p title="Догукан Йылдырым">Догукан Йылдырым (Doğukan Yıldırım)</p>').value).toBe('<p title="Догукан Йылдырым">Д. Йылдырым</p>');
  });
});
