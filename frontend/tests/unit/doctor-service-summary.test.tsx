import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DoctorServiceSummaryPanel } from "@/components/site/telehealth/doctor-service-summary";
import { AvailabilityCalendar } from "@/components/site/telehealth/availability-calendar";
import { BookingSelectionProvider } from "@/components/site/telehealth/booking-selection-context";
import { formatPriceFromCents } from "@/lib/format-price";
import type { AvailabilitySlot, DoctorProfile } from "@/lib/api/types";

/**
 * `.claude/design-notes-telehealth.md` §2.4 — "Hizmet Özeti" paneli (§2.1.4'ün sade fiyat+CTA
 * panelini genişletir; dosya `doctor-price-panel.tsx` → `doctor-service-summary.tsx`, bileşen
 * `DoctorPricePanel` → `DoctorServiceSummaryPanel` olarak YENİDEN ADLANDIRILDI). `IntersectionObserver`
 * `tests/setup.ts`'teki sessiz polyfill ile sağlanır (jsdom'da doğal olarak YOK).
 *
 * Grid görevi (2026-09-14) Görev 1 — eski `ctaHref` ("Randevu Al" ANKOR) KALDIRILDI; panel artık
 * `booking-wizard.tsx`'in TEK dinamik "Devam Et" butonunu barındırır (`currentStep`/`onContinue`/
 * `continueDisabled`/`continueLoading`/`showContinueButton`/`locked` prop'ları). Bu dosya YENİ
 * kontratı doğrular.
 *
 * `booking-selection-context.tsx`'in ziyaretçi dilimi tespiti (`Intl.DateTimeFormat().
 * resolvedOptions().timeZone`) test makinesinin GERÇEK yerel dilimini okur — `availability-
 * calendar.test.tsx` İLE AYNI gerekçeyle bu SIFIR argümanlı çağrı sahte `UTC` değerine
 * sabitlenir (aksi halde saat biçimlendirme testleri makineye göre KAYAR).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/api/telehealth", () => ({
  getDoctorSlots: vi.fn(async () => []),
  createAppointment: vi.fn(),
}));

const OriginalDateTimeFormat = Intl.DateTimeFormat;

beforeEach(() => {
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

function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "doctor-1",
    userId: null,
    specialtyId: "specialty-1",
    specialty: {
      id: "specialty-1",
      name: "Kardiyoloji",
      slug: "kardiyoloji",
      icon: "heart",
      description: null,
      order: 0,
      isActive: true,
      imageMediaId: null,
      imageUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    title: "Dr.",
    fullName: "Elif Aydemir",
    slug: "dr-elif-aydemir",
    subSpecialty: null,
    bio: "Örnek biyografi.",
    aboutHtml: null,
    practiceStartYear: null,
    experienceYears: null,
    cvEntries: [],
    publications: [],
    languages: ["tr", "en"],
    timeZone: "UTC",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
    currency: "TRY",
    avatarMediaId: null,
    avatarMedia: null,
    isVerified: false,
    verifiedAt: null,
    isActive: true,
    order: 0,
    availability: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(
  doctor: DoctorProfile = makeDoctor(),
  props: Partial<{
    currentStep: 2 | 3 | 4 | 5;
    onContinue: () => void;
    continueDisabled: boolean;
    continueLoading: boolean;
    showContinueButton: boolean;
    locked: boolean;
  }> = {}
) {
  return render(
    <BookingSelectionProvider doctorTimeZone={doctor.timeZone}>
      <DoctorServiceSummaryPanel
        doctor={doctor}
        currentStep={props.currentStep ?? 2}
        onContinue={props.onContinue ?? vi.fn()}
        continueDisabled={props.continueDisabled ?? true}
        continueLoading={props.continueLoading ?? false}
        showContinueButton={props.showContinueButton ?? true}
        locked={props.locked ?? false}
      />
    </BookingSelectionProvider>
  );
}

describe("DoctorServiceSummaryPanel", () => {
  it("§2.4.1 üst etiket 'Hizmet Özeti'ni gösterir", () => {
    renderPanel();
    expect(screen.getByText("Hizmet Özeti")).toBeInTheDocument();
  });

  it("§2.4.2 doktor profili satırı — ad/unvan + uzmanlık", () => {
    renderPanel();
    expect(screen.getAllByText("Dr. Elif Aydemir").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kardiyoloji").length).toBeGreaterThan(0);
  });

  it("§2.4.3 hizmet satırı — uzmanlıktan türetilen isim + süre; uzmanlık YOKSA 'Genel Danışmanlık' fallback'i", () => {
    renderPanel();
    expect(screen.getByText("Kardiyoloji Seansı")).toBeInTheDocument();
    expect(screen.getByText("30 Dk.")).toBeInTheDocument();

    renderPanel(makeDoctor({ specialty: null, specialtyId: null }));
    expect(screen.getByText("Genel Danışmanlık Seansı")).toBeInTheDocument();
  });

  it("§2.4.4 hiçbir randevu seçilmemişse 'Tarih ve saatleri seçin' placeholder'ını gösterir", () => {
    renderPanel();
    expect(screen.getByText("Tarih ve saatleri seçin")).toBeInTheDocument();
  });

  it("fiyatı `doctor.currency`'ye göre biçimlendirir (iki kez render edilir — masaüstü panel + mobil çubuk)", () => {
    renderPanel(makeDoctor({ sessionPriceCents: 45000, currency: "TRY" }));
    expect(screen.getAllByText(formatPriceFromCents(45000, "TRY")).length).toBeGreaterThan(0);
  });

  it("`sessionPriceCents: null` (ücretsiz doktor) — fiyat yerine 'Ücretsiz / Bilgi Alınız' gösterilir, '/ seans' eki gizlenir", () => {
    renderPanel(makeDoctor({ sessionPriceCents: null }));
    expect(screen.getAllByText("Ücretsiz / Bilgi Alınız").length).toBeGreaterThan(0);
    expect(screen.queryByText("/ seans")).not.toBeInTheDocument();
  });

  it("Grid görevi (2026-09-14) — TEK 'Devam Et' butonu render edilir (masaüstü panel + mobil çubuk, iki kez), `continueDisabled` ile devre dışı kalır", () => {
    renderPanel(undefined, { continueDisabled: true });
    // Mobil alt çubuk ilk render'da `aria-hidden="true"` (bkz. aşağıdaki "mobil alt çubuk..."
    // testi) — bu yüzden `hidden: true` GEREKİR, aksi halde erişilebilirlik ağacından gizli
    // ikinci kopya `getAllByRole` tarafından GÖRÜLMEZ.
    const buttons = screen.getAllByRole("button", { name: "Devam Et", hidden: true });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();
  });

  it("Grid görevi (2026-09-14) — `continueDisabled=false` iken 'Devam Et' tıklanınca `onContinue` çağrılır", () => {
    const onContinue = vi.fn();
    renderPanel(undefined, { continueDisabled: false, onContinue });
    fireEvent.click(screen.getAllByRole("button", { name: "Devam Et" })[0]!);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("Grid görevi (2026-09-14) — `showContinueButton=false` (adım 4/5) iken 'Devam Et' HİÇ render edilmez, mobil çubuk da gizlenir", () => {
    const { container } = renderPanel(undefined, { showContinueButton: false, currentStep: 4 });
    expect(screen.queryByRole("button", { name: "Devam Et" })).not.toBeInTheDocument();
    expect(container.querySelector(".fixed.inset-x-0")).toBeNull();
  });

  it("Grid görevi (2026-09-14) — `locked=true` iken 'Değiştir' ve tekil slot kaldırma aksiyonları GİZLENİR (salt-okunur özet)", () => {
    const doctor = makeDoctor();
    const slots: AvailabilitySlot[] = [
      { startsAt: "2026-09-18T10:00:00.000Z", endsAt: "2026-09-18T10:30:00.000Z", available: true },
    ];

    render(
      <BookingSelectionProvider doctorTimeZone={doctor.timeZone}>
        <AvailabilityCalendar doctorSlug={doctor.slug} doctorTimeZone={doctor.timeZone} initialSlots={slots} />
        <DoctorServiceSummaryPanel
          doctor={doctor}
          currentStep={4}
          onContinue={vi.fn()}
          continueDisabled={false}
          continueLoading={false}
          showContinueButton={false}
          locked
        />
      </BookingSelectionProvider>
    );

    fireEvent.click(screen.getByLabelText("10:00 — müsait"));
    expect(screen.queryByRole("button", { name: "Değiştir" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("10:00 slotunu kaldır")).not.toBeInTheDocument();
    expect(screen.getAllByText(/10:00/).length).toBeGreaterThanOrEqual(1);
  });

  it("mobil alt çubuk ilk render'da gizli kabul edilir (`aria-hidden=\"true\"`)", () => {
    const { container } = renderPanel();
    // `.fixed` — monogram fallback'in KENDİ `aria-hidden="true"`sından (doktorun avatar
    // kutusu) AYIRT ETMEK için; mobil çubuk BENZERSİZ olarak `fixed inset-x-0` taşır.
    const bar = container.querySelector('.fixed[aria-hidden="true"]');
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain("translate-y-full");
  });

  it("§2.4 — 'Seçilen Randevu' satırı `AvailabilityCalendar` ile AYNI `selectedSlot`'u (context üzerinden) yansıtır", () => {
    const doctor = makeDoctor();
    const slots: AvailabilitySlot[] = [
      { startsAt: "2026-09-18T10:00:00.000Z", endsAt: "2026-09-18T10:30:00.000Z", available: true },
    ];

    render(
      <BookingSelectionProvider doctorTimeZone={doctor.timeZone}>
        <AvailabilityCalendar doctorSlug={doctor.slug} doctorTimeZone={doctor.timeZone} initialSlots={slots} />
        <DoctorServiceSummaryPanel
          doctor={doctor}
          currentStep={2}
          onContinue={vi.fn()}
          continueDisabled
          continueLoading={false}
          showContinueButton
          locked={false}
        />
      </BookingSelectionProvider>
    );

    expect(screen.getByText("Tarih ve saatleri seçin")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("10:00 — müsait"));

    // Takvimin seçim durumu VE Hizmet Özeti panelinin "Seçilen Randevu" kutusu AYNI context'ten
    // (`useBookingSelection`) beslendiği için İKİSİ DE "10:00"i gösterir — panel prop-drilling
    // OLMADAN, tek doğruluk kaynağından senkronize güncellenir.
    expect(screen.queryByText("Tarih ve saatleri seçin")).not.toBeInTheDocument();
    expect(screen.getAllByText(/10:00/).length).toBeGreaterThanOrEqual(2);
  });
});
