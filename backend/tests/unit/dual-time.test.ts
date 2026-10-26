import { describe, expect, it } from "vitest";
import {
  cityLabel,
  formatDoctorSlot,
  formatPatientSlot,
  formatWall,
  gmtLabel,
  isValidTimeZone,
  offsetMinutes,
  sameWallClock,
} from "../../src/lib/dual-time";

/**
 * Paket P (İş 1) — hastanın saati + Türkiye saati. Sabit ofset YOK; yaz saati geçişleri `Intl` ile.
 * Kontrol edilen geçişler (2026): Avrupa yaz saatinden 25 Ekim'de, ABD 1 Kasım'da çıkar; Avustralya
 * (Sydney) 4 Ekim'de yaz saatine girer; Körfez'de yaz saati yoktur.
 */
const at = (iso: string) => new Date(iso);

describe("dual-time", () => {
  it("IANA doğrulaması", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("Europe/Berlin; DROP")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("Avrupa: 25 Ekim 2026 yaz saati bitişi — Berlin GMT+2 → GMT+1, Türkiye hep GMT+3", () => {
    expect(gmtLabel(at("2026-10-24T14:00:00Z"), "Europe/Berlin")).toBe("GMT+2");
    expect(gmtLabel(at("2026-10-26T14:00:00Z"), "Europe/Berlin")).toBe("GMT+1");
    expect(gmtLabel(at("2026-10-26T14:00:00Z"), "Europe/Istanbul")).toBe("GMT+3");
    expect(formatPatientSlot(at("2026-10-24T14:00:00Z"), "Europe/Berlin")).toBe(
      "24.10.2026 16:00 your time (Berlin, GMT+2) · Turkey time: 24.10.2026 17:00 (GMT+3)"
    );
    expect(formatPatientSlot(at("2026-10-26T14:00:00Z"), "Europe/Berlin")).toBe(
      "26.10.2026 15:00 your time (Berlin, GMT+1) · Turkey time: 26.10.2026 17:00 (GMT+3)"
    );
    // Londra: geçiş gecesi 01:00 UTC.
    expect(offsetMinutes(at("2026-10-25T00:59:00Z"), "Europe/London")).toBe(60);
    expect(offsetMinutes(at("2026-10-25T01:00:00Z"), "Europe/London")).toBe(0);
    expect(gmtLabel(at("2026-10-25T01:00:00Z"), "Europe/London")).toBe("GMT");
  });

  it("ABD: 1 Kasım 2026 yaz saati bitişi — New York GMT-4 → GMT-5", () => {
    expect(formatWall(at("2026-10-31T14:00:00Z"), "America/New_York")).toBe("31.10.2026 10:00");
    expect(gmtLabel(at("2026-10-31T14:00:00Z"), "America/New_York")).toBe("GMT-4");
    expect(formatWall(at("2026-11-02T14:00:00Z"), "America/New_York")).toBe("02.11.2026 09:00");
    expect(gmtLabel(at("2026-11-02T14:00:00Z"), "America/New_York")).toBe("GMT-5");
  });

  it("Avustralya: Sydney GMT+11 (yaz saati) — Türkiye'den sonraki güne düşer", () => {
    expect(formatPatientSlot(at("2026-10-28T14:00:00Z"), "Australia/Sydney")).toBe(
      "29.10.2026 01:00 your time (Sydney, GMT+11) · Turkey time: 28.10.2026 17:00 (GMT+3)"
    );
  });

  it("gün kayması: Berlin 23:30 = Türkiye ertesi gün 01:30", () => {
    expect(formatPatientSlot(at("2026-11-10T22:30:00Z"), "Europe/Berlin")).toBe(
      "10.11.2026 23:30 your time (Berlin, GMT+1) · Turkey time: 11.11.2026 01:30 (GMT+3)"
    );
  });

  it("Körfez: Dubai GMT+4 (yaz saati yok); Riyad Türkiye ile aynı saat → tek saat", () => {
    expect(gmtLabel(at("2026-07-01T10:00:00Z"), "Asia/Dubai")).toBe("GMT+4");
    expect(gmtLabel(at("2026-12-01T10:00:00Z"), "Asia/Dubai")).toBe("GMT+4");
    expect(sameWallClock(at("2026-12-01T10:00:00Z"), "Asia/Riyadh", "Europe/Istanbul")).toBe(true);
    expect(formatPatientSlot(at("2026-12-01T10:00:00Z"), "Asia/Riyadh")).toBe("01.12.2026 13:00 Turkey time (GMT+3)");
    expect(gmtLabel(at("2026-12-01T10:00:00Z"), "Asia/Kolkata")).toBe("GMT+5:30");
  });

  it("hasta Türkiye'de ya da dilim bilinmiyorsa tek saat; geçersiz dilim yok sayılır", () => {
    expect(formatPatientSlot(at("2026-12-01T10:00:00Z"), "Europe/Istanbul")).toBe("01.12.2026 13:00 Turkey time (GMT+3)");
    expect(formatPatientSlot(at("2026-12-01T10:00:00Z"), null)).toBe("01.12.2026 13:00 Turkey time (GMT+3)");
    expect(formatPatientSlot(at("2026-12-01T10:00:00Z"), "Not/AZone")).toBe("01.12.2026 13:00 Turkey time (GMT+3)");
  });

  it("doktor e-postası: doktor dilimi + hasta saati", () => {
    expect(formatDoctorSlot(at("2026-12-01T10:00:00Z"), "Europe/Istanbul", "Europe/Berlin")).toBe(
      "01.12.2026 13:00 (Istanbul, GMT+3) · Patient: Berlin 01.12.2026 11:00 (GMT+1)"
    );
    expect(formatDoctorSlot(at("2026-12-01T10:00:00Z"), "Europe/Istanbul", null)).toBe("01.12.2026 13:00 (Istanbul, GMT+3)");
    expect(cityLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
});
