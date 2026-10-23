import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DoctorImportError,
  cleanAuthors,
  extractDoi,
  extractYear,
  findPrivateInfo,
  parseCvText,
  parseMembership,
  validateParsed,
} from "../../src/lib/doctor-cv-import";
import { DoctorCvEntrySchema } from "../../src/schemas/entities";

/**
 * Paket L (2026-10-23) — CV ayrıştırma: yazar temizliği, yıl/DOI çıkarımı, eklenmeyen kalemler ve
 * gizli bilgi filtresi. Fixture gerçek CV değildir (gerçeği `imports/` altında, git dışında); aynı
 * yapıda sahte veridir.
 */
const SAMPLE = fs.readFileSync(path.resolve(__dirname, "../fixtures/doctor-cv-sample.txt"), "utf8");

describe("doctor-cv-import — yardımcılar", () => {
  it("yazarlardaki dipnot rakamlarını temizler, büyük soyadı ve ayraçları düzeltir", () => {
    expect(cleanAuthors("Vahit MUTLU, Ali Örnek 2, Ayşe Deneme 3, Mehmet Sınama 5")).toBe("Vahit Mutlu, Ali Örnek, Ayşe Deneme, Mehmet Sınama");
    expect(cleanAuthors("Vahit MUTLU , Deneme R., Örnek M.A.,Sınama K.,")).toBe("Vahit Mutlu, Deneme R., Örnek M.A., Sınama K.");
    expect(cleanAuthors("GlobalSurg Collaborative/ Vahit MUTLU")).toBe("GlobalSurg Collaborative / Vahit Mutlu");
    expect(cleanAuthors("Ali Örnek , Vahit MUTLU,, Ayşe Deneme")).toBe("Ali Örnek, Vahit Mutlu, Ayşe Deneme");
  });

  it("DOI'yi çeşitli yazımlardan çıkarır, sondaki noktayı atar", () => {
    expect(extractDoi("Acta Parasitol. 2025 Nov 13;70(6):209. doi: 10.1234/s00000-025-00003-5.")).toBe("10.1234/s00000-025-00003-5");
    expect(extractDoi("BMC Surgery DOI:10.1234/s00000-026-00004-y")).toBe("10.1234/s00000-026-00004-y");
    expect(extractDoi("https://doi.org/10.1234/ex/abc123")).toBe("10.1234/ex/abc123");
    expect(extractDoi("J Compr Surg. 2024;2(1):6-11.")).toBeNull();
  });

  it("yılı DOI/URL içindeki sayılardan değil, metinden bulur", () => {
    expect(extractYear("Current Problems in Surgery 76 DOI:10.1234/j.example.2026.000002")).toBeNull();
    expect(extractYear("https://doi.org/10.1234/EX.00006")).toBeNull();
    expect(extractYear("Obesity Surgery (2025) 35:5471–5479 https://doi.org/10.1234/s00000-025-00005-8")).toBe(2025);
    expect(extractYear("3.Karadeniz Kongresi 20-22 Kasım 2020")).toBe(2020);
    expect(extractYear("Sabuncuoglu Serefeddin Health Science ISBN: 2667-6338,2021/ Vol.3:1")).toBe(2021);
  });

  it("üyelik: rol varsa ayrılır, yoksa 'Member'; yıl uydurulmaz ve şema kabul eder", () => {
    const council = parseMembership("• SSAT – Türkiye Council Member");
    expect(council).toMatchObject({ organization: "SSAT", title: "Türkiye Council Member", startYear: null });
    const plain = parseMembership("• TOSS – Turkish Obesity Surgery Society");
    expect(plain).toMatchObject({ organization: "TOSS – Turkish Obesity Surgery Society", title: "Member" });
    expect(DoctorCvEntrySchema.safeParse(plain).success).toBe(true);
    // Yılsız kalem yalnızca MEMBERSHIP'te serbest.
    expect(DoctorCvEntrySchema.safeParse({ ...plain, kind: "EDUCATION" }).success).toBe(false);
  });
});

describe("doctor-cv-import — parseCvText", () => {
  const parsed = parseCvText(SAMPLE);

  it("eğitim (lise hariç), deneyim, üyelik ve sertifika kalemlerini üretir", () => {
    expect(parsed.cvEntries.map((e) => e.kind)).toEqual(["EDUCATION", "EXPERIENCE", "MEMBERSHIP", "MEMBERSHIP", "CERTIFICATE"]);
    expect(parsed.cvEntries[1]).toMatchObject({ startYear: 2023, endYear: null });
    expect(parsed.skipped).toContainEqual(expect.objectContaining({ section: "EDUCATION", title: "Secondary Education" }));
  });

  it("yayınları türüne göre ayrıştırır; yılı olmayanı eklemez ve listeler", () => {
    const byKind = (kind: string) => parsed.publications.filter((p) => p.kind === kind);
    expect(byKind("INTERNATIONAL_ARTICLE")).toHaveLength(2);
    expect(byKind("NATIONAL_ARTICLE")).toHaveLength(1);
    expect(byKind("BOOK_CHAPTER")).toHaveLength(3);
    expect(byKind("PROCEEDING")).toHaveLength(2);
    expect(parsed.skipped).toContainEqual(expect.objectContaining({ title: "Evaluation of surgical competence outcomes" }));

    const first = byKind("INTERNATIONAL_ARTICLE")[0]!;
    expect(first).toMatchObject({ year: 2026, doi: "10.1234/EX.S000001", authors: "Vahit Mutlu, Ali Örnek, Ayşe Deneme" });
    // doi.org bağlantısı `url`'e kopyalanmaz (DOI zaten bağlantı üretir); https olmayan URL hiç alınmaz.
    expect(byKind("INTERNATIONAL_ARTICLE")[1]).toMatchObject({ year: 2024, doi: "10.1234/ex/abc123", url: null });
    expect(byKind("NATIONAL_ARTICLE")[0]!.url).toBe("https://example.org/journal/issue/1/2");

    const [chapter, editorship, turkish] = byKind("BOOK_CHAPTER");
    expect(chapter).toMatchObject({ title: "Sağlıkta Güvenlik Unsurları: Hasta Güvenliği", year: 2023 });
    expect(editorship!.venue).toMatch(/^Editor · General Surgery Emergencies/);
    expect(turkish).toMatchObject({ title: "Pankreas Fistülleri", year: 2018 });
    expect(turkish!.venue).toMatch(/^Gastrointestinal Fistüller/);

    // Çok satırlı başlık birleşir; bölüm sonuna sızan "Mesleki Özgeçmiş" yer adına karışmaz.
    const [multiLine, last] = byKind("PROCEEDING");
    expect(multiLine!.title).toBe(
      "Multivariate Analysis of Baseline Body Mass Index (BMI), Gender, and Age on Weight Loss in Patients with Hyperlipidemia (HL) Undergoing Bariatric Surgery"
    );
    expect(last!.venue).not.toContain("Mesleki");
  });

  it("bio en fazla 2 cümle; about doğum cümlesini içermez, çekince ifadesi korunur", () => {
    expect(parsed.bio).toBe("General surgeon with a clinical focus on bariatric surgery. He trained at Example University and now works in Istanbul.");
    expect(parsed.aboutHtml).not.toMatch(/born|1989/);
    expect(parsed.aboutHtml).toMatch(/^<p>Dr\. Vahit Mutlu studied medicine/);
    expect(parsed.aboutHtml).toContain("His professional biography reports experience in more than 1,000 bariatric procedures.");
  });

  it("gizli bilgi filtresi: başlıktaki telefon/e-posta hiçbir alana geçmez", () => {
    expect(findPrivateInfo(parsed)).toEqual([]);
    expect(JSON.stringify(parsed)).not.toMatch(/530|example\.com/);
    expect(() => validateParsed(parsed)).not.toThrow();
  });

  it("telefon, e-posta veya doğum bilgisi sızarsa yazma reddedilir", () => {
    expect(findPrivateInfo({ bio: "Call +90 530 211 44 32" })).toEqual(["telefon"]);
    expect(findPrivateInfo({ x: "mail dr.someone@gmail.com" })).toEqual(["e-posta"]);
    expect(findPrivateInfo({ x: "He was born in 1989." })).toEqual(["doğum bilgisi"]);
    // Yerel/uluslararası numara biçimleri ve mailto: da yakalanır.
    expect(findPrivateInfo({ x: "Tel: 0532 123 45 67" })).toEqual(["telefon"]);
    expect(findPrivateInfo({ x: "Office +44 20 7946 0958" })).toEqual(["telefon"]);
    expect(findPrivateInfo({ url: "mailto:someone" })).toEqual(["e-posta"]);
    // Yanlış alarm yok: künye sayfa/cilt aralıkları, ISBN, "doğum sonrası" başlığı.
    expect(findPrivateInfo({ x: "Obesity Surgery (2025) 35:5471–5479; ISBN: 978-625-8103-82-3; Doğum sonrası takip" })).toEqual([]);
    expect(() => validateParsed({ ...parsed, bio: "Contact: dr.someone@gmail.com" })).toThrow(DoctorImportError);
  });
});
