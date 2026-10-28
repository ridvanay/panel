import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DoctorImportError } from "../../src/lib/doctor-cv-import";
import { parseNarrativeCv, parseVancouver, splitList, splitNarrativeSections, validateNarrative } from "../../src/lib/doctor-cv-generic";

/**
 * Paket U (A3) — anlatı biçimli CV ayrıştırması: tekrarlanan bölüm tekilleştirme, yılsız kayıtların
 * atlanması, gizli bilgi filtresi, kayıt sayıları. Fixture kişisel bilgi içermez (uydurma adlar).
 */
const SAMPLE = fs.readFileSync(path.resolve(__dirname, "../fixtures/doctor-cv-narrative-sample.txt"), "utf8");

const PROSE_SAMPLE = [
  "Orthodontist Dr. Test Doctor",
  "",
  "He began his undergraduate studies at Example University Faculty of Dentistry in 2005 and graduated in 2011.",
  "",
  "In 2014, he began his specialty training in the Department of Orthodontics at the same university’s Faculty of Dentistry. He completed his training in 2018 with his thesis titled “A Sample Thesis Title,” qualifying as an orthodontist.",
  "",
  "Following his specialty training, he worked as an orthodontist at Example Oral Health Center. In 2020, he left public service and continued providing orthodontic treatment at private dental clinics. He currently practices at his own clinic, Example Clinic, where he provides orthodontic care to his patients.",
  "",
  "He is a member of the Example Dental Association, the Example Orthodontic Society, and the Example Chamber of Dentists.",
].join("\n");

describe("doctor-cv-generic — bölümler", () => {
  it("aynı başlık iki kez geçerse kalemler bir kez eklenir", () => {
    const { items, headingCounts, duplicatesRemoved } = splitNarrativeSections(SAMPLE);
    expect(headingCounts.get("CAREER")).toBe(2);
    expect(headingCounts.get("MEMBERSHIP")).toBe(2);
    expect(items.get("CAREER")).toHaveLength(7);
    expect(items.get("MEMBERSHIP")).toEqual(["Example Society of Radiology (ESR-X)", "Example Medical Chamber"]);
    expect(duplicatesRemoved).toBe(3);
  });

  it("liste ayırma: 'A, B, and C' ve baştaki 'the'", () => {
    expect(splitList("the A Society, the B Society, and the C Chamber")).toEqual(["A Society", "B Society", "C Chamber"]);
  });
});

describe("doctor-cv-generic — kalem sayıları ve kurallar", () => {
  const parsed = parseNarrativeCv(SAMPLE);
  const kinds = (k: string) => parsed.cvEntries.filter((e) => e.kind === k);

  it("CV kalemleri: eğitim 2, deneyim 4, unvan 2, üyelik 2; tekrar yok", () => {
    expect(kinds("EDUCATION").map((e) => [e.title, e.startYear, e.endYear])).toEqual([
      ["Doctor of Medicine (MD)", 1997, 1997],
      ["Residency in Radiology", 1998, 2002],
    ]);
    expect(kinds("EXPERIENCE")).toHaveLength(4);
    expect(kinds("AWARD").map((e) => [e.title, e.startYear])).toEqual([
      ["Associate Professor", 2020],
      ["Professor", 2026],
    ]);
    expect(kinds("MEMBERSHIP")).toHaveLength(2);
    expect(kinds("CERTIFICATE")).toHaveLength(0);
  });

  it("bitişi belirtilmeyen iş yıl uydurmadan tek yıl + not; çok kurumlu aralık tek kalem; güncel iş devam ediyor", () => {
    const [first, multi, , current] = kinds("EXPERIENCE");
    expect(first).toMatchObject({ startYear: 1997, endYear: 1997, description: "End year not stated in the CV." });
    expect(multi).toMatchObject({ organization: "Alpha Hospital, Beta Hospital, Gamma Hospital", startYear: 2004, endYear: 2016 });
    expect(multi!.description).toMatch(/individual years are not stated/);
    expect(current).toMatchObject({ organization: "Example City Hospital", startYear: 2024, endYear: null });
  });

  it("yılsız sertifika ve tıbbi olmayan belge eklenmez, nedenleriyle listelenir", () => {
    const reasons = parsed.skipped.map((s) => `${s.section}: ${s.reason}`).join("\n");
    expect(reasons).toMatch(/CERTIFICATE: Yıl belirtilmemiş/);
    expect(reasons).toMatch(/Tıbbi yeterlilik değil/);
  });

  it("yayınlar: yılsız künyeler atlanır (yıl uydurulmaz); sayılar ve DOI", () => {
    const count = (k: string) => parsed.publications.filter((p) => p.kind === k).length;
    expect([count("INTERNATIONAL_ARTICLE"), count("NATIONAL_ARTICLE"), count("BOOK_CHAPTER"), count("PROCEEDING")]).toEqual([2, 1, 1, 2]);
    const skippedPubs = parsed.skipped.filter((s) => s.reason.includes("Künyede yıl yok")).map((s) => s.title);
    expect(skippedPubs).toEqual(["#2 An article whose citation has no year", "#3 A congress paper without any year"]);
    const q = parsed.publications.find((p) => p.title.startsWith("Is the question mark"))!;
    expect(q).toMatchObject({ title: "Is the question mark handled? Inter-rater reliability in assessment", venue: "Example Research in MRI. 2022;1(2):42–46", year: 2022, doi: "10.1000/example.2022.001" });
    expect(parsed.publications.every((p) => p.year >= 1950)).toBe(true);
  });

  it("künye: tarih bölütü yayın yerinden ayrılır; yıl yayın yerinin adındaysa o bölüt yayın yeridir", () => {
    expect(parseVancouver("PROCEEDING", "Doe J. A paper. Example Congress. June 8–11, 2000. City.").publication).toMatchObject({
      title: "A paper",
      venue: "Example Congress. June 8–11, 2000. City",
      year: 2000,
    });
    expect(parseVancouver("PROCEEDING", "Doe J. A paper. CIRSE 2003. September 20–24, 2003. Belek.").publication).toMatchObject({ title: "A paper", venue: "CIRSE 2003. September 20–24, 2003. Belek", year: 2003 });
    expect(parseVancouver("NATIONAL_ARTICLE", "Doe J. A title. Some Journal. 9(2):213–219.").publication).toBeNull();
  });

  it("düz anlatı (başlıksız) CV: eğitim + tez, deneyim yılları, özel muayenehane birleşimi, üyelikler", () => {
    const prose = parseNarrativeCv(PROSE_SAMPLE);
    expect(prose.cvEntries.map((e) => [e.kind, e.startYear, e.endYear ?? null, e.organization])).toEqual([
      ["EDUCATION", 2005, 2011, "Example University Faculty of Dentistry"],
      ["EDUCATION", 2014, 2018, "Example University Faculty of Dentistry"],
      ["EXPERIENCE", 2018, 2020, "Example Oral Health Center"],
      ["EXPERIENCE", 2020, null, "Example Clinic"],
      ["MEMBERSHIP", null, null, "Example Dental Association"],
      ["MEMBERSHIP", null, null, "Example Orthodontic Society"],
      ["MEMBERSHIP", null, null, "Example Chamber of Dentists"],
    ]);
    expect(prose.cvEntries[1]!.description).toBe("Thesis: A Sample Thesis Title");
    expect(prose.cvEntries[3]!.description).toMatch(/year it opened is not stated/);
    expect(prose.publications).toEqual([]);
  });
});

describe("doctor-cv-generic — gizli bilgi filtresi", () => {
  it("telefon / e-posta / doğum bilgisi içeren CV yazılmaz", () => {
    const withPhone = SAMPLE.replace("Example Medical Chamber", "Example Medical Chamber +90 532 123 45 67");
    expect(() => validateNarrative(parseNarrativeCv(withPhone), false)).toThrow(DoctorImportError);
    const withMail = SAMPLE.replace("Example Medical Chamber", "Example Medical Chamber (test.doctor@example.com)");
    expect(() => validateNarrative(parseNarrativeCv(withMail), false)).toThrow(/e-posta/);
    // Doğum bilgisi anlatıda: yalnızca --with-about ile yazılacağı için o zaman reddedilir.
    const withBirth = SAMPLE.replace("is a medical doctor", "was born in 1970 and is a medical doctor");
    expect(() => validateNarrative(parseNarrativeCv(withBirth), false)).not.toThrow();
    expect(() => validateNarrative(parseNarrativeCv(withBirth), true)).toThrow(/doğum bilgisi/);
  });

  it("temiz örnek şemadan geçer; anlatı biyografisi üyelik/yayın içermez", () => {
    const parsed = parseNarrativeCv(SAMPLE);
    expect(() => validateNarrative(parsed, true)).not.toThrow();
    expect(parsed.aboutHtml).toContain("<p>Prof. Dr. Test Doctor is a medical doctor");
    expect(parsed.aboutHtml).not.toContain("ESR-X");
    expect(parsed.aboutHtml).not.toContain("Example J Radiol");
  });
});
