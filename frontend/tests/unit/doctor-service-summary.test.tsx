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
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    title: "Dr.",
    fullName: "Elif Aydemir",
    slug: "dr-elif-aydemir",
    bio: "Örnek biyografi.",
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

function renderPanel(doctor: DoctorProfile = makeDoctor()) {
  return render(
    <BookingSelectionProvider doctorTimeZone={doctor.timeZone}>
      <DoctorServiceSummaryPanel doctor={doctor} ctaHref="#randevu" />
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

  it("§2.4.4 hiçbir randevu seçilmemişse 'Tarih ve saat seçin' placeholder'ını gösterir", () => {
    renderPanel();
    expect(screen.getByText("Tarih ve saat seçin")).toBeInTheDocument();
  });

  it("fiyatı `doctor.currency`'ye göre biçimlendirir (iki kez render edilir — masaüstü panel + mobil çubuk)", () => {
    renderPanel(makeDoctor({ sessionPriceCents: 45000, currency: "TRY" }));
    expect(screen.getAllByText(formatPriceFromCents(45000, "TRY")).length).toBeGreaterThan(0);
  });

  it("CTA `#randevu`'ya işaret eder, DEVRE DIŞI bırakılmaz (iki kez render edilir)", () => {
    renderPanel();
    const links = screen.getAllByRole("link", { name: "Randevu Al", hidden: true });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "#randevu");
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
        <AvailabilityCalendar doctorSlug={doctor.slug} doctorTimeZone={doctor.timeZone} lang="tr" defaultLocaleCode="tr" initialSlots={slots} kvkkPage={null} />
        <DoctorServiceSummaryPanel doctor={doctor} ctaHref="#randevu" />
      </BookingSelectionProvider>
    );

    expect(screen.getByText("Tarih ve saat seçin")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("10:00 — müsait"));

    // Takvimin onay şeridi VE Hizmet Özeti panelinin "Seçilen Randevu" kutusu AYNI context'ten
    // (`useBookingSelection`) beslendiği için İKİSİ DE "10:00"i gösterir — panel prop-drilling
    // OLMADAN, tek doğruluk kaynağından senkronize güncellenir.
    expect(screen.queryByText("Tarih ve saat seçin")).not.toBeInTheDocument();
    expect(screen.getAllByText(/10:00/).length).toBeGreaterThanOrEqual(2);
  });
});
