import { describe, expect, it } from "vitest";
import {
  buildBulkTemplate,
  decodeCsvBuffer,
  detectDelimiter,
  escapeCsvCell,
  foldKey,
  parseBulkCsv,
  parseDateCell,
  parseTimeCell,
} from "../../src/modules/telehealth/lib/bulk-availability-csv";

/** Paket Q — toplu çalışma saati/izin CSV'si: şablon üretimi ve Excel uyumlu ayrıştırma. */
const csv = (text: string) => Buffer.from(text, "utf8");

describe("Paket Q — CSV şablonu", () => {
  const doctors = [
    {
      slug: "dr-ayse",
      title: "Dr.",
      fullName: "Ayşe Yılmaz",
      timeZone: "Europe/Istanbul",
      rules: [
        { dayOfWeek: 1, startMinute: 540, endMinute: 720, isActive: true },
        { dayOfWeek: 1, startMinute: 840, endMinute: 1020, isActive: true },
        { dayOfWeek: 2, startMinute: 600, endMinute: 660, isActive: false },
      ],
      timeOff: [
        // Tam gün 20–22 Kasım (TSİ) = 19 Kasım 21:00Z … 22 Kasım 21:00Z
        { startsAt: new Date("2026-11-19T21:00:00Z"), endsAt: new Date("2026-11-22T21:00:00Z"), kind: "CONGRESS", allDay: true, note: "=HYPERLINK(\"x\")" },
        { startsAt: new Date("2026-11-25T07:00:00Z"), endsAt: new Date("2026-11-25T10:30:00Z"), kind: "SURGERY_DAY", allDay: false, note: null },
      ],
    },
  ];

  it("BOM + ';' ayraç + açıklama satırları + mevcut saatler/izinler + CSV injection öneki", () => {
    const buf = buildBulkTemplate(doctors, ";");
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = buf.toString("utf8").slice(1).split("\r\n");
    expect(lines[0]!.startsWith("#")).toBe(true);
    expect(lines.some((l) => l.includes("doktorun KENDİ saat diliminde"))).toBe(true);
    const header = lines.find((l) => !l.startsWith("#"))!;
    expect(header).toBe("doktor_kodu;doktor_adi;kayit_turu;gun;baslangic_tarihi;bitis_tarihi;baslangic_saati;bitis_saati;izin_turu;not");
    expect(lines).toContain("dr-ayse;Dr. Ayşe Yılmaz (Europe/Istanbul);CALISMA;Pzt;;;09:00;12:00;;");
    expect(lines).toContain("dr-ayse;Dr. Ayşe Yılmaz (Europe/Istanbul);CALISMA;Pzt;;;14:00;17:00;;");
    expect(lines.filter((l) => l.includes(";Sal;"))).toHaveLength(0); // pasif kural yazılmaz
    expect(lines).toContain(`dr-ayse;Dr. Ayşe Yılmaz (Europe/Istanbul);IZIN;;20.11.2026;22.11.2026;;;KONGRE;"'=HYPERLINK(""x"")"`);
    expect(lines).toContain("dr-ayse;Dr. Ayşe Yılmaz (Europe/Istanbul);IZIN;;25.11.2026;25.11.2026;10:00;13:30;AMELIYAT;");
  });

  it("virgül ayraçlı şablon; injection önekleri ve kaçış", () => {
    const text = buildBulkTemplate(doctors, ",").toString("utf8");
    expect(text).toContain("doktor_kodu,doktor_adi,kayit_turu");
    for (const trigger of ["=", "+", "-", "@", "\t", "\r"]) expect(escapeCsvCell(`${trigger}1`, ",").startsWith(trigger === "\r" ? '"' : "'")).toBe(true);
    expect(escapeCsvCell("a,b", ",")).toBe('"a,b"');
    expect(escapeCsvCell("a,b", ";")).toBe("a,b");
  });

  it("şablon geri okunduğunda aynı satırları verir (injection öneki kaldırılır)", () => {
    const { rows, errors } = parseBulkCsv(buildBulkTemplate(doctors, ";"));
    expect(errors).toEqual([]);
    expect(rows.filter((r) => r.type === "WORK")).toHaveLength(2);
    const congress = rows.find((r) => r.type === "TIME_OFF" && r.kind === "CONGRESS");
    expect(congress).toMatchObject({ startDate: { year: 2026, month: 11, day: 20 }, endDate: { year: 2026, month: 11, day: 22 }, startMinute: null, note: '=HYPERLINK("x")' });
  });
});

describe("Paket Q — CSV ayrıştırma", () => {
  it("ayraç algılama: ';', ',' ve sekme; tırnak içi ayraç sayılmaz", () => {
    expect(detectDelimiter("# a,b,c,d\ndoktor_kodu;kayit_turu;gun")).toBe(";");
    expect(detectDelimiter("doktor_kodu,kayit_turu,gun")).toBe(",");
    expect(detectDelimiter("doktor_kodu\tkayit_turu\tgun")).toBe("\t");
    expect(detectDelimiter('"a;b;c",x,y')).toBe(",");
  });

  it("başlık sırası serbest; Türkçe/büyük harfli başlık ve gün adları; yorum satırları okunmaz", () => {
    const text = [
      "# açıklama; okunmaz",
      "BİTİŞ_SAATİ,Gün,Kayıt_Türü,Doktor_Kodu,Başlangıç_Saati",
      "12:00,Pazartesi,ÇALIŞMA,DR-A,9:00",
      "17:00:00,çar,calisma,dr-a,14:00:00",
      "18:00,Fri,CALISMA,dr-a,0.5",
      "#  dr-a,Paz,CALISMA",
      ",,,,",
    ].join("\r\n");
    const { rows, errors, rowCount } = parseBulkCsv(csv(text));
    expect(errors).toEqual([]);
    expect(rowCount).toBe(3);
    expect(rows).toEqual([
      { row: 3, doctorSlug: "dr-a", type: "WORK", dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      { row: 4, doctorSlug: "dr-a", type: "WORK", dayOfWeek: 3, startMinute: 840, endMinute: 1020 },
      { row: 5, doctorSlug: "dr-a", type: "WORK", dayOfWeek: 5, startMinute: 720, endMinute: 1080 },
    ]);
  });

  it("sekme ayraçlı dosya ve Excel seri tarihi; bitiş tarihi boşsa başlangıç günü", () => {
    const text = "doktor_kodu\tkayit_turu\tbaslangic_tarihi\tbitis_tarihi\tizin_turu\ndr-a\tIZIN\t46050\t\ttatil";
    const { rows, errors } = parseBulkCsv(csv(text));
    expect(errors).toEqual([]);
    // 46050 → 2026-01-28
    expect(rows[0]).toMatchObject({ type: "TIME_OFF", startDate: { year: 2026, month: 1, day: 28 }, endDate: { year: 2026, month: 1, day: 28 }, kind: "VACATION" });
  });

  it("satır numaralı Türkçe hatalar", () => {
    const text = [
      "doktor_kodu;kayit_turu;gun;baslangic_tarihi;bitis_tarihi;baslangic_saati;bitis_saati;izin_turu",
      "dr-a;CALISMA;Xyz;;;09:00;12:00;",
      "dr-a;CALISMA;Pzt;;;25:00;12:00;",
      "dr-a;CALISMA;Pzt;;;12:00;09:00;",
      "dr-a;IZIN;;31.02.2026;;;;TATIL",
      "dr-a;IZIN;;01.03.2026;;10:00;;TATIL",
      "dr-a;IZIN;;01.03.2026;;;;BAYRAM",
      "dr-a;FOO;;;;;;",
      ";CALISMA;Pzt;;;09:00;10:00;",
    ].join("\n");
    const { rows, errors } = parseBulkCsv(csv(text));
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(errors[0]!.message).toContain("Geçersiz gün");
    expect(errors[1]!.message).toContain("Geçersiz başlangıç saati");
    expect(errors[2]!.message).toContain("Bitiş saati başlangıç saatinden sonra");
    expect(errors[3]!.message).toContain("Geçersiz tarih");
    expect(errors[4]!.message).toContain("birlikte");
    expect(errors[5]!.message).toContain("Geçersiz izin türü");
    expect(errors[6]!.message).toContain("Geçersiz kayit_turu");
    expect(errors[7]!.message).toContain("doktor_kodu boş");
  });

  it("zorunlu başlık eksikse ve satır sınırı aşılırsa dosya geneli hata", () => {
    expect(parseBulkCsv(csv("kod;gun\nx;Pzt")).errors[0]!.message).toContain("zorunlu sütun eksik");
    const many = ["doktor_kodu;kayit_turu;gun;baslangic_saati;bitis_saati", ...Array.from({ length: 5001 }, () => "dr-a;CALISMA;Pzt;09:00;10:00")].join("\n");
    expect(parseBulkCsv(csv(many)).errors[0]!.message).toContain("en fazla 5000 satır");
  });

  it("Windows-1254 (Türkçe Excel 'CSV') kodlaması çözülür", () => {
    // "Çar" Windows-1254: Ç = 0xC7
    const bytes = Buffer.concat([Buffer.from("doktor_kodu;kayit_turu;gun;baslangic_saati;bitis_saati\ndr-a;CALISMA;", "latin1"), Buffer.from([0xc7]), Buffer.from("ar;09:00;10:00", "latin1")]);
    expect(decodeCsvBuffer(bytes)).toContain("Çar");
    expect(parseBulkCsv(bytes).rows[0]).toMatchObject({ dayOfWeek: 3 });
  });

  it("saat/tarih hücreleri", () => {
    expect(parseTimeCell("9:00")).toBe(540);
    expect(parseTimeCell("09:00:00")).toBe(540);
    expect(parseTimeCell("24:00")).toBe(1440);
    expect(parseTimeCell("0,375")).toBe(540);
    expect(parseTimeCell("24:30")).toBe("invalid");
    expect(parseTimeCell("9")).toBe("invalid");
    expect(parseDateCell("5.3.2026")).toEqual({ year: 2026, month: 3, day: 5 });
    expect(parseDateCell("2026-03-05")).toEqual({ year: 2026, month: 3, day: 5 });
    expect(parseDateCell("46050")).toEqual({ year: 2026, month: 1, day: 28 });
    expect(parseDateCell("2026/13/01")).toBe("invalid");
    expect(foldKey("Başlangıç Tarihi")).toBe("baslangic_tarihi");
    expect(foldKey("İZİN")).toBe("izin");
  });
});
