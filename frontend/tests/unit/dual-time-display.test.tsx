import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PATIENT_TIME_ZONE_STORAGE_KEY,
  dualSlotTime,
  gmtLabel,
  isSameClockAsTurkey,
  listTimeZones,
  searchTimeZones,
  turkeyLeadMinutes,
} from "@/lib/dual-time";
import { DualDateTimeSummary, DualSlotLabel, TimeZoneBar } from "@/components/site/telehealth/dual-time";
import { BookingSelectionProvider, useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";

/**
 * Paket P (İş 1) — hastanın saati + Türkiye saati: yaz saati geçişleri (Avrupa Ekim sonu, ABD Kasım
 * başı, Avustralya, Körfez), gün kayması, iki satırlı slot, tek satır (Türkiye'deki hasta), seçim
 * özeti, saat dilimi seçici (arama + tarayıcıda saklama + profile kayıt) ve Arapçada `dir="ltr"`.
 */
const updateMe = vi.fn(async (_input: unknown) => ({}));
vi.mock("@/lib/api/users", () => ({ updateMe: (input: unknown) => updateMe(input) }));
let authUser: { id: string; timeZone?: string | null } | null = null;
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => ({ user: authUser, status: authUser ? "authenticated" : "unauthenticated" }) }));

function withLocale(node: React.ReactNode, code = "tr") {
  return (
    <LocaleAlternatesProvider activeLocaleCode={code} defaultLocaleCode="tr">
      {node}
    </LocaleAlternatesProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  updateMe.mockClear();
  authUser = null;
});
afterEach(() => vi.restoreAllMocks());

describe("lib/dual-time", () => {
  it("Avrupa yaz saati bitişi (25 Ekim 2026): Berlin GMT+2 → GMT+1; Türkiye farkı 1 → 2 saat", () => {
    expect(gmtLabel("2026-10-24T14:00:00Z", "Europe/Berlin")).toBe("GMT+2");
    expect(gmtLabel("2026-10-26T14:00:00Z", "Europe/Berlin")).toBe("GMT+1");
    expect(turkeyLeadMinutes("2026-10-24T14:00:00Z", "Europe/Berlin")).toBe(60);
    expect(turkeyLeadMinutes("2026-10-26T14:00:00Z", "Europe/Berlin")).toBe(120);
  });

  it("ABD yaz saati bitişi (1 Kasım 2026): New York GMT-4 → GMT-5", () => {
    expect(gmtLabel("2026-10-31T14:00:00Z", "America/New_York")).toBe("GMT-4");
    expect(gmtLabel("2026-11-02T14:00:00Z", "America/New_York")).toBe("GMT-5");
  });

  it("Avustralya (Sydney GMT+11) Türkiye'den ileride — Türkiye önceki gün; Körfez'de Riyad Türkiye ile aynı saat", () => {
    const d = dualSlotTime("2026-10-28T14:00:00Z", "Australia/Sydney", "tr-TR");
    expect(d.patientDayKey).toBe("2026-10-29");
    expect(d.turkeyDayKey).toBe("2026-10-28");
    expect(d.turkeyDayShift).toBe(-1);
    expect(isSameClockAsTurkey("2026-12-01T10:00:00Z", "Asia/Riyadh")).toBe(true);
    expect(gmtLabel("2026-12-01T10:00:00Z", "Asia/Dubai")).toBe("GMT+4");
  });

  it("gün kayması: Berlin 23:30 → Türkiye ertesi gün 01:30", () => {
    const d = dualSlotTime("2026-11-10T22:30:00Z", "Europe/Berlin", "tr-TR");
    expect(d.patientTime).toBe("23:30");
    expect(d.turkeyTime).toBe("01:30");
    expect(d.turkeyDayShift).toBe(1);
  });

  it("arama: şehir, IANA kimliği ve ülke adıyla (TR/EN/yerel); yaygın dilimler listenin başında", () => {
    expect(searchTimeZones("Almanya")).toContain("Europe/Berlin");
    expect(searchTimeZones("germany")).toContain("Europe/Berlin");
    expect(searchTimeZones("buenos").some((tz) => tz.endsWith("Buenos_Aires"))).toBe(true);
    expect(searchTimeZones("Россия")).toContain("Europe/Moscow");
    expect(listTimeZones()[0]).toBe("Europe/Istanbul");
  });
});

describe("slot ve özet gösterimi", () => {
  it("iki satır: ana satır hastanın saati, alt satır Türkiye; Türkiye'deki hasta için tek satır", () => {
    const { unmount } = render(withLocale(<DualSlotLabel iso="2026-10-28T14:00:00Z" timeZone="Europe/Berlin" intlLocale="tr-TR" />));
    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.getByTestId("slot-turkey-time")).toHaveTextContent("17:00 Türkiye");
    unmount();
    render(withLocale(<DualSlotLabel iso="2026-10-28T14:00:00Z" timeZone="Europe/Istanbul" intlLocale="tr-TR" />));
    expect(screen.getByText("17:00")).toBeInTheDocument();
    expect(screen.queryByTestId("slot-turkey-time")).not.toBeInTheDocument();
  });

  it("gün değişiyorsa açıkça: 'Türkiye: ertesi gün 01:30'", () => {
    render(withLocale(<DualSlotLabel iso="2026-11-10T22:30:00Z" timeZone="Europe/Berlin" intlLocale="tr-TR" />));
    expect(screen.getByTestId("slot-turkey-time")).toHaveTextContent("Türkiye: ertesi gün 01:30");
  });

  it("seçim özeti üç bilgi: hastanın tarihi/saati, Türkiye tarihi/saati, fark ('Türkiye sizden 2 saat ileride')", () => {
    render(withLocale(<DualDateTimeSummary iso="2026-10-28T14:00:00Z" timeZone="Europe/Berlin" intlLocale="tr-TR" />));
    const summary = screen.getByTestId("dual-summary");
    expect(summary).toHaveTextContent("Sizin saatiniz (Berlin):");
    expect(summary).toHaveTextContent("28 Ekim Çarşamba · 15:00");
    expect(summary).toHaveTextContent("Türkiye saati:");
    expect(summary).toHaveTextContent("28 Ekim Çarşamba · 17:00");
    expect(summary).toHaveTextContent("Türkiye sizden 2 saat ileride");
  });

  it("Arapça: saatler dir=ltr ile izole, metinler Arapça", () => {
    render(withLocale(<DualSlotLabel iso="2026-10-28T14:00:00Z" timeZone="Europe/Berlin" intlLocale="ar" />, "ar"));
    const bdi = document.querySelector("bdi[dir='ltr']");
    expect(bdi).not.toBeNull();
    expect(screen.getByTestId("slot-turkey-time").textContent).toContain("بتوقيت تركيا");
  });
});

function Probe() {
  const { visitorTimeZone, displayTimeZone } = useBookingSelection();
  return <p data-testid="probe">{`${visitorTimeZone ?? "-"}|${displayTimeZone}`}</p>;
}

describe("saat dilimi seçici", () => {
  it("bilgi satırı + 'Değiştir' → ülke adıyla arama → seçim tarayıcıda saklanır ve giriş yapılmışsa profile yazılır", async () => {
    authUser = { id: "u1", timeZone: null };
    const user = userEvent.setup();
    function Bar() {
      const { visitorTimeZone, detectedTimeZone, setPatientTimeZone } = useBookingSelection();
      return <TimeZoneBar timeZone={visitorTimeZone} detectedTimeZone={detectedTimeZone} onChange={setPatientTimeZone} />;
    }
    render(
      withLocale(
        <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
          <Bar />
          <Probe />
        </BookingSelectionProvider>
      )
    );
    const bar = await screen.findByTestId("time-zone-bar");
    expect(bar).toHaveTextContent("Saatler sizin saat diliminize göre gösteriliyor:");
    expect(bar).toHaveTextContent("Türkiye saati: GMT+3");
    await user.click(within(bar).getByRole("button", { name: "Değiştir — Saat diliminizi seçin" }));
    await user.type(screen.getByPlaceholderText("Şehir veya ülke ile arayın"), "Almanya");
    await user.click(screen.getByRole("button", { name: /^Berlin/ }));
    expect(screen.getByTestId("probe")).toHaveTextContent("Europe/Berlin|Europe/Berlin");
    expect(window.localStorage.getItem(PATIENT_TIME_ZONE_STORAGE_KEY)).toBe("Europe/Berlin");
    expect(updateMe).toHaveBeenCalledWith({ timeZone: "Europe/Berlin" });
  });

  it("öncelik: bu tarayıcıda saklanan seçim > profil > tarayıcı", async () => {
    authUser = { id: "u1", timeZone: "Asia/Dubai" };
    const { unmount } = render(
      withLocale(
        <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
          <Probe />
        </BookingSelectionProvider>
      )
    );
    // Saklı seçim yok, profil var → profil (tarayıcı dilimi yalnızca profil yoksa).
    expect((await screen.findByTestId("probe")).textContent?.startsWith("Asia/Dubai")).toBe(true);
    unmount();
    window.localStorage.setItem(PATIENT_TIME_ZONE_STORAGE_KEY, "America/New_York");
    render(
      withLocale(
        <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
          <Probe />
        </BookingSelectionProvider>
      )
    );
    expect(await screen.findByText(/^America\/New_York\|/)).toBeInTheDocument();
  });
});
