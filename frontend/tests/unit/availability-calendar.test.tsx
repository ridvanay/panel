import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AvailabilityCalendar } from "@/components/site/telehealth/availability-calendar";
import type { AvailabilitySlot } from "@/lib/api/types";

/**
 * `.claude/design-notes-telehealth.md` §2.2 — randevu tarih-saat seçim akışı. Bu test dosyası
 * §2.2.2 (Sabah/Öğleden Sonra/Akşam gruplaması, boş grup render EDİLMEZ) ve §2.2.5 (seçim onay
 * şeridinin formdan AYRI, DUPLICATE olmayan tek bir gösterim noktası olması) davranışını
 * doğrular. Ziyaretçi saat dilimi (`Intl.DateTimeFormat().resolvedOptions().timeZone`) yalnızca
 * SIFIR argümanlı çağrıda sahte `UTC` değerine sabitlenir — `formatDayLabel`/`formatTime`'ın
 * KENDİ `Intl.DateTimeFormat(locale, options)` çağrıları GERÇEK biçimlendiriciyi kullanmaya
 * devam eder (bu yüzden `tr-TR` çıktısı testte de gerçek ürün çıktısıyla AYNIDIR).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/api/telehealth", () => ({
  getDoctorSlots: vi.fn(async () => []),
  createAppointment: vi.fn(),
}));

const OriginalDateTimeFormat = Intl.DateTimeFormat;

function makeSlots(): AvailabilitySlot[] {
  return [
    // Sabah — müsait
    { startsAt: "2026-09-20T09:00:00.000Z", endsAt: "2026-09-20T09:30:00.000Z", available: true },
    // Öğleden Sonra — müsait
    { startsAt: "2026-09-20T14:00:00.000Z", endsAt: "2026-09-20T14:30:00.000Z", available: true },
    // Öğleden Sonra — dolu (gelecek, rezerve edilmiş)
    { startsAt: "2026-09-20T15:00:00.000Z", endsAt: "2026-09-20T15:30:00.000Z", available: false },
    // Akşam grubu KASITLI OLARAK BOŞ — "Akşam" başlığı render EDİLMEMELİ.
  ];
}

function renderCalendar(slots: AvailabilitySlot[] = makeSlots()) {
  return render(
    <AvailabilityCalendar
      doctorSlug="dr-test"
      doctorTimeZone="UTC"
      lang="tr"
      defaultLocaleCode="tr"
      initialSlots={slots}
      kvkkPage={null}
    />
  );
}

describe("AvailabilityCalendar", () => {
  beforeEach(() => {
    // `function` (constructor olarak çağrılabilir) KULLANILIR — `new Intl.DateTimeFormat(...)`
    // biçimindeki gerçek çağrı yolları (`formatDayLabel`/`formatTime`/`formatDayKey`) bozulmasın.
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locale?: unknown, options?: unknown) {
      if (locale === undefined && options === undefined) {
        return { resolvedOptions: () => ({ timeZone: "UTC" }) } as unknown as Intl.DateTimeFormat;
      }
      return new OriginalDateTimeFormat(locale as string | string[] | undefined, options as Intl.DateTimeFormatOptions | undefined);
    } as unknown as typeof Intl.DateTimeFormat);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("§2.2.2 — saatleri Sabah/Öğleden Sonra gruplarına ayırır, boş 'Akşam' grubu RENDER EDİLMEZ", () => {
    renderCalendar();
    expect(screen.getByText("Sabah")).toBeInTheDocument();
    expect(screen.getByText("Öğleden Sonra")).toBeInTheDocument();
    expect(screen.queryByText("Akşam")).not.toBeInTheDocument();
  });

  it("§2.2.4/§3 — dolu slot 'Dolu' etiketiyle render edilir, tıklanamaz (`aria-disabled`)", () => {
    renderCalendar();
    const doluSlot = screen.getByLabelText("15:00 — dolu, seçilemez");
    expect(doluSlot).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Dolu")).toBeInTheDocument();
  });

  it("§2.2.3 — seçili güne göre grid başlığı '... için uygun saatler' metnini gösterir", () => {
    renderCalendar();
    expect(screen.getByText(/için uygun saatler$/)).toBeInTheDocument();
  });

  it("müsait bir saat seçildiğinde `aria-checked` 'true' olur ve `Check` ikonlu seçili sınıfı uygulanır", () => {
    renderCalendar();
    fireEvent.click(screen.getByLabelText("09:00 — müsait"));
    const selected = screen.getByLabelText("09:00 — seçili");
    expect(selected).toHaveAttribute("aria-checked", "true");
    expect(selected.className).toContain("bg-primary");
  });

  it("§2.2.5 — saat seçildiğinde onay şeridi görünür ve formdaki eski 'Seçilen saat: ...' satırı YOKTUR (duplicate değil)", () => {
    renderCalendar();
    fireEvent.click(screen.getByLabelText("14:00 — müsait"));

    // Eski tekrar eden satır tamamen kaldırılmalı.
    expect(screen.queryByText(/^Seçilen saat:/)).not.toBeInTheDocument();

    // Yeni onay şeridi "Değiştir" bağlantısıyla birlikte render edilir ve seçilen saati taşır.
    const changeButton = screen.getByRole("button", { name: "Değiştir" });
    const strip = changeButton.parentElement;
    expect(strip).toHaveTextContent("14:00");
  });

  it("'Değiştir' seçimi temizler, booking formu (dolayısıyla onay şeridi) kaybolur", () => {
    renderCalendar();
    fireEvent.click(screen.getByLabelText("09:00 — müsait"));
    expect(screen.getByRole("button", { name: "Randevuyu Onayla" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Değiştir" }));
    expect(screen.queryByRole("button", { name: "Randevuyu Onayla" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("09:00 — müsait")).toBeInTheDocument();
  });

  it("müsait saat YOKSA bilgi mesajı gösterir, hiçbir grup/şerit render EDİLMEZ", () => {
    renderCalendar([]);
    expect(screen.getByText("Önümüzdeki günlerde müsait bir saat bulunmuyor.")).toBeInTheDocument();
    expect(screen.queryByText("Sabah")).not.toBeInTheDocument();
  });
});
