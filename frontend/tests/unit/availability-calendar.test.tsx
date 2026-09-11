import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AvailabilityCalendar } from "@/components/site/telehealth/availability-calendar";
import { BookingSelectionProvider } from "@/components/site/telehealth/booking-selection-context";
import type { AvailabilitySlot } from "@/lib/api/types";

/**
 * `.claude/design-notes-telehealth.md` §2.3 — randevu ay takvimi ızgarası (§2.2'nin dikey tarih
 * chip listesini SUPERSEDE eder). Bu dosya §2.3.1/§2.3.2 (ay navigasyonu + gün ızgarası, "Erken"
 * mikro-etiketi, seçili gün), §2.3.3 (ÖÖ Sabah/ÖS Öğleden Sonra — İKİ grup, "Akşam" YOK) ve
 * §2.3.6/§2.2.5 (seçim onay şeridinin formdan AYRI, DUPLICATE olmayan tek bir gösterim noktası
 * olması) davranışını doğrular.
 *
 * `AvailabilityCalendar` artık `selectedSlot`/saat dilimini `booking-selection-context.tsx`
 * üzerinden okur ("Hizmet Özeti" paneliyle PAYLAŞILAN durum) — bu yüzden her render
 * `BookingSelectionProvider` İÇİNE sarılır (bkz. `renderCalendar`).
 *
 * `Date.now()` `2026-09-11` (bu turun sistem tarihi) olarak SABİTLENİR — takvimin "geçmiş aya
 * gidilemez" kısıtı (§2.3.1) gerçek duvar saatine göre DEĞİL, bu sabit referansa göre
 * deterministik olarak doğrulanabilsin diye (slot fixture'ları KASITLI olarak 2026 Eylül'ünde).
 * Ziyaretçi saat dilimi (`Intl.DateTimeFormat().resolvedOptions().timeZone`) yalnızca SIFIR
 * argümanlı çağrıda sahte `UTC` değerine sabitlenir — `formatDayLabel`/`formatTime`'ın KENDİ
 * `Intl.DateTimeFormat(locale, options)` çağrıları GERÇEK biçimlendiriciyi kullanmaya devam eder.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/api/telehealth", () => ({
  getDoctorSlots: vi.fn(async () => []),
  createAppointment: vi.fn(),
}));

const OriginalDateTimeFormat = Intl.DateTimeFormat;
const FIXED_NOW = new Date("2026-09-11T12:00:00.000Z").getTime();

/** Kronolojik olarak İLK müsait gün ("Erken" etiketi) `2026-09-18`, sonraki müsait gün `2026-09-20`. */
function makeSlots(): AvailabilitySlot[] {
  return [
    // En yakın müsait gün — takvim hücresinde "Erken" mikro-etiketi taşımalı, varsayılan seçili gün.
    { startsAt: "2026-09-18T10:00:00.000Z", endsAt: "2026-09-18T10:30:00.000Z", available: true },
    // Sonraki müsait gün — Sabah + Öğleden Sonra (bir dolu) slotu birlikte.
    { startsAt: "2026-09-20T09:00:00.000Z", endsAt: "2026-09-20T09:30:00.000Z", available: true },
    { startsAt: "2026-09-20T14:00:00.000Z", endsAt: "2026-09-20T14:30:00.000Z", available: true },
    { startsAt: "2026-09-20T15:00:00.000Z", endsAt: "2026-09-20T15:30:00.000Z", available: false },
  ];
}

function renderCalendar(slots: AvailabilitySlot[] = makeSlots()) {
  return render(
    <BookingSelectionProvider doctorTimeZone="UTC">
      <AvailabilityCalendar doctorSlug="dr-test" doctorTimeZone="UTC" lang="tr" defaultLocaleCode="tr" initialSlots={slots} kvkkPage={null} />
    </BookingSelectionProvider>
  );
}

describe("AvailabilityCalendar", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
    // `function` (constructor olarak çağrılabilir) KULLANILIR — `new Intl.DateTimeFormat(...)`
    // biçimindeki gerçek çağrı yolları (`formatDayLabel`/`formatTime`/`formatDayKey`/takvim
    // biçimlendiricileri) bozulmasın.
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

  it("§2.3.1 — ay etiketini büyük harfle gösterir, varsayılan sayfa en yakın müsait günün ayıdır (Eylül 2026)", () => {
    renderCalendar();
    expect(screen.getByText("EYLÜL 2026")).toBeInTheDocument();
  });

  it("§2.3.1 — görüntülenen ay bugünün ayıyla AYNIYSA 'Önceki ay' `disabled`dır", () => {
    renderCalendar();
    expect(screen.getByLabelText("Önceki ay")).toBeDisabled();
  });

  it("§2.3.1 — 'Sonraki ay' tıklanınca sayfa bir ay ilerler ve artık 'Önceki ay' `disabled` DEĞİLDİR", () => {
    renderCalendar();
    fireEvent.click(screen.getByLabelText("Sonraki ay"));
    expect(screen.getByText("EKİM 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Önceki ay")).not.toBeDisabled();
  });

  it("§2.3.2 — varsayılan seçili gün kronolojik İLK müsait gündür (eski dikey chip listesindeki `dayGroups[0]` varsayılanının BİREBİR karşılığı)", () => {
    renderCalendar();
    // Seçili durumun kendisi §2.3.2'nin "seçili" hücre örneğiyle BİREBİR — "Erken" mikro-etiketi
    // TAŞIMAZ (dolgu/Check ikonu zaten en güçlü sinyal, iki etiketi ÜST ÜSTE BİNDİRMEK gürültü
    // yaratırdı; spesifikasyonun §2.3.2 hücre örnekleri "müsait+en yakın" ile "seçili"yi AYRI/
    // dışlayan iki örnek olarak verir).
    expect(screen.getByLabelText(/18 Eylül .+ — seçili/)).toBeInTheDocument();
  });

  it("§2.3.2 — kronolojik olarak İLK müsait gün, SEÇİLİ DEĞİLKEN 'en yakın randevu tarihi' (Erken) etiketini taşır", () => {
    renderCalendar();
    // Başka bir günü seçince (20 Eylül) 18 Eylül artık "seçili" DEĞİL, "Erken" etiketli müsait
    // hücreye geri döner.
    fireEvent.click(screen.getByLabelText(/20 Eylül .+ — müsait$/));
    expect(screen.getByLabelText(/18 Eylül .+ — müsait, en yakın randevu tarihi/)).toBeInTheDocument();
    expect(screen.getByLabelText(/20 Eylül .+ — seçili/)).toBeInTheDocument();
  });

  it("§2.3.2 — müsait olmayan/geçmiş günler tıklanamaz bir `<span>`dır, `<button>` DEĞİLDİR", () => {
    renderCalendar();
    const emptyCell = screen.getByLabelText(/17 Eylül .+ — müsait saat yok/);
    expect(emptyCell.tagName).toBe("SPAN");
  });

  it("§2.3.3 — saat ızgarası SADECE ÖÖ Sabah/ÖS Öğleden Sonra gruplarını üretir ('Akşam' YOK)", () => {
    renderCalendar();
    // Varsayılan seçili gün 18 Eylül — o günün TEK slotu Sabah grubunda.
    expect(screen.getByText("ÖÖ Sabah")).toBeInTheDocument();
    expect(screen.queryByText("ÖS Öğleden Sonra")).not.toBeInTheDocument();
    expect(screen.queryByText("Akşam")).not.toBeInTheDocument();
  });

  it("bir takvim günü değiştirildiğinde saat ızgarası SEÇİLEN GÜNE göre günceller", () => {
    renderCalendar();
    expect(screen.getByLabelText("10:00 — müsait")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/20 Eylül .+ — müsait$/));

    // Artık 20 Eylül'ün saatleri (Sabah + Öğleden Sonra, biri dolu) görünür, 18 Eylül'ünki YOK.
    expect(screen.queryByLabelText("10:00 — müsait")).not.toBeInTheDocument();
    expect(screen.getByText("ÖÖ Sabah")).toBeInTheDocument();
    expect(screen.getByText("ÖS Öğleden Sonra")).toBeInTheDocument();
    expect(screen.getByLabelText("09:00 — müsait")).toBeInTheDocument();
    expect(screen.getByLabelText("15:00 — dolu, seçilemez")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Dolu")).toBeInTheDocument();
  });

  it("müsait bir saat seçildiğinde `aria-checked` 'true' olur ve `Check` ikonlu seçili sınıfı uygulanır", () => {
    renderCalendar();
    fireEvent.click(screen.getByLabelText("10:00 — müsait"));
    const selected = screen.getByLabelText("10:00 — seçili");
    expect(selected).toHaveAttribute("aria-checked", "true");
    expect(selected.className).toContain("bg-primary");
  });

  it("§2.3.6/§2.2.5 — saat seçildiğinde onay şeridi görünür ve formdaki eski 'Seçilen saat: ...' satırı YOKTUR (duplicate değil)", () => {
    renderCalendar();
    fireEvent.click(screen.getByLabelText("10:00 — müsait"));

    expect(screen.queryByText(/^Seçilen saat:/)).not.toBeInTheDocument();

    const changeButton = screen.getByRole("button", { name: "Değiştir" });
    const strip = changeButton.parentElement;
    expect(strip).toHaveTextContent("10:00");
  });

  it("'Değiştir' seçimi temizler, booking formu (dolayısıyla onay şeridi) kaybolur; gün seçimi KORUNUR", () => {
    renderCalendar();
    fireEvent.click(screen.getByLabelText("10:00 — müsait"));
    expect(screen.getByRole("button", { name: "Randevuyu Onayla" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Değiştir" }));
    expect(screen.queryByRole("button", { name: "Randevuyu Onayla" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("10:00 — müsait")).toBeInTheDocument();
    // Takvimdeki gün seçimi (hangi günün saatlerine bakıldığı) "Değiştir" ile SIFIRLANMAZ.
    expect(screen.getByLabelText(/18 Eylül .+ — seçili/)).toBeInTheDocument();
  });

  it("müsait saat YOKSA bilgi mesajı gösterir, hiçbir takvim/grup render EDİLMEZ", () => {
    renderCalendar([]);
    expect(screen.getByText("Önümüzdeki günlerde müsait bir saat bulunmuyor.")).toBeInTheDocument();
    expect(screen.queryByText("EYLÜL 2026")).not.toBeInTheDocument();
    expect(screen.queryByText("ÖÖ Sabah")).not.toBeInTheDocument();
  });
});
