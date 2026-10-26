import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";
import { portalStrings as tr } from "@/lib/i18n/site-dictionaries/tr/portal";
import {
  countryFlagSrc,
  countryForTimeZone,
  countryName,
  defaultHour12,
  formatClock,
  isAmbiguousTimeZone,
  zoneAbbreviation,
} from "@/lib/country-display";
import { resetHourFormatStoreForTests, setHourFormatPreference } from "@/lib/hour-format-store";
import { buildIcs, googleCalendarUrl } from "@/lib/calendar-links";
import { PATIENT_TIME_ZONE_STORAGE_KEY } from "@/lib/dual-time";
import { SlotCardContent, TimeZoneBar, buildSlotView, usePatientHour12 } from "@/components/site/telehealth/dual-time";
import { BookingSelectionProvider, useBookingSelection } from "@/components/site/telehealth/booking-selection-context";

/**
 * Paket R — saat diliminden ülke/bayrak/ülke adı, bölgeye göre 12/24 saat (Türkiye hep 24 saat),
 * slot kartı (+1 gün, gece ipucu, ekran okuyucu cümlesi), yaz saati geçişleri, .ics/Google Takvim,
 * IP önerisi (uyuşmazlık bildirimi, UTC'de IP varsayılanı, seçimin hatırlanması).
 */
let browserTz: string | undefined = "Europe/Istanbul";
vi.mock("@/lib/dual-time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dual-time")>()),
  browserTimeZone: () => browserTz,
}));
const getGeoHint = vi.fn(async (): Promise<{ countryCode: string | null; timeZone: string | null } | null> => null);
vi.mock("@/lib/api/geo", () => ({ getGeoHint: () => getGeoHint() }));
vi.mock("@/lib/api/users", () => ({ updateMe: vi.fn(async () => ({})) }));
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => ({ user: null, status: "unauthenticated" }) }));

function withLocale(node: React.ReactNode, code = "tr") {
  return (
    <LocaleAlternatesProvider activeLocaleCode={code} defaultLocaleCode="tr">
      {node}
    </LocaleAlternatesProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetHourFormatStoreForTests();
  browserTz = "Europe/Istanbul";
  getGeoHint.mockReset();
  getGeoHint.mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

describe("saat diliminden ülke", () => {
  it("Europe/Berlin → DE, Asia/Dubai → AE, America/New_York → US; eski ad (Asia/Calcutta) → IN; UTC ülkesiz", () => {
    expect(countryForTimeZone("Europe/Berlin")).toBe("DE");
    expect(countryForTimeZone("Asia/Dubai")).toBe("AE");
    expect(countryForTimeZone("America/New_York")).toBe("US");
    expect(countryForTimeZone("Asia/Calcutta")).toBe("IN");
    expect(countryForTimeZone("UTC")).toBeNull();
    expect(isAmbiguousTimeZone("UTC")).toBe(true);
    expect(isAmbiguousTimeZone("Etc/GMT+3")).toBe(true);
    expect(isAmbiguousTimeZone("Europe/Berlin")).toBe(false);
  });

  it("ülke adları aktif dilde; bayrak yolu; bilinmeyen kodda bayrak yok", () => {
    expect(countryName("DE", "tr-TR")).toBe("Almanya");
    expect(countryName("DE", "en-US")).toBe("Germany");
    expect(countryName("AE", "ar-SA")).toBe("الإمارات العربية المتحدة");
    expect(countryName("US", "de-DE")).toBe("Vereinigte Staaten");
    expect(countryFlagSrc("DE")).toBe("/flags/4x3/de.svg");
    expect(countryFlagSrc("XX")).toBeNull();
  });

  it("dilim kısaltması: CET, GST, EST; Türkiye için yalnızca ofset olduğundan null", () => {
    expect(zoneAbbreviation("2026-12-01T12:00:00Z", "Europe/Berlin")).toBe("CET");
    expect(zoneAbbreviation("2026-12-01T12:00:00Z", "Asia/Dubai")).toBe("GST");
    expect(zoneAbbreviation("2026-12-01T12:00:00Z", "America/New_York")).toBe("EST");
    expect(zoneAbbreviation("2026-12-01T12:00:00Z", "Europe/Istanbul")).toBeNull();
  });
});

describe("saat biçimi (12/24)", () => {
  it("en-US ve en-GB 12 saat; de ve tr 24 saat; Körfez (ar-AE) 24 saat", () => {
    expect(defaultHour12("en-US")).toBe(true);
    expect(defaultHour12("en-GB")).toBe(true);
    expect(defaultHour12("en-AU")).toBe(true);
    expect(defaultHour12("de")).toBe(false);
    expect(defaultHour12("tr")).toBe(false);
    expect(defaultHour12("ar-AE")).toBe(false);
    expect(formatClock("2026-12-01T21:00:00Z", "America/New_York", "en-US", true)).toBe("4:00 PM");
    expect(formatClock("2026-12-01T21:00:00Z", "America/New_York", "en-US", false)).toBe("16:00");
  });

  it("hastanın bölgesi + site dili; kullanıcı tercihi hepsini ezer; Türkiye saati her durumda 24 saat", () => {
    function Probe({ tz }: { tz: string }) {
      const hour12 = usePatientHour12(tz);
      const view = buildSlotView({ startsAt: "2026-12-01T21:00:00Z", endsAt: "2026-12-01T21:30:00Z" }, tz, "en-US", hour12, tr.schedule);
      return <p data-testid="p">{`${hour12 ? 12 : 24}|${view.patientRange}|${view.turkeyRange}`}</p>;
    }
    const { rerender } = render(withLocale(<Probe tz="America/New_York" />, "en"));
    expect(screen.getByTestId("p")).toHaveTextContent("12|4:00 PM – 4:30 PM|00:00 – 00:30");
    rerender(withLocale(<Probe tz="Europe/Berlin" />, "en"));
    expect(screen.getByTestId("p")).toHaveTextContent("24|22:00 – 22:30|00:00 – 00:30");
    act(() => setHourFormatPreference("12"));
    expect(screen.getByTestId("p")).toHaveTextContent("12|10:00 PM – 10:30 PM|00:00 – 00:30");
    rerender(withLocale(<Probe tz="America/New_York" />, "en"));
    act(() => setHourFormatPreference("24"));
    expect(screen.getByTestId("p")).toHaveTextContent("24|16:00 – 16:30|00:00 – 00:30");
  });
});

describe("slot kartı", () => {
  it("Berlin 23:30: '+1 gün' rozeti (İstanbul ertesi gün), gece ipucu (ay), ekran okuyucu tam cümle", () => {
    const view = buildSlotView({ startsAt: "2026-11-10T22:30:00Z", endsAt: "2026-11-10T23:00:00Z" }, "Europe/Berlin", "tr-TR", false, tr.schedule);
    expect(view).toMatchObject({ patientRange: "23:30 – 00:00", turkeyRange: "01:30 – 02:00", turkeyDayShift: 1, night: true });
    expect(view.sentence).toBe("10 Kasım Salı, sizin saatinizle 23:30–00:00, İstanbul saatiyle 01:30–02:00 (ertesi gün). Sizin saatinizle gece");
    render(withLocale(<SlotCardContent view={view} />));
    expect(screen.getByTestId("slot-day-shift")).toHaveTextContent("+1 gün");
    expect(screen.getByTestId("slot-night")).toBeInTheDocument();
    expect(screen.getByTestId("slot-turkey-time")).toHaveTextContent("İstanbul01:30 – 02:00+1 gün");
  });

  it("Sydney sabahı: İstanbul önceki gün (−1 gün); Türkiye saatindeki hasta için tek satır", () => {
    // Sydney 29 Ekim 07:00 (AEDT) = İstanbul 28 Ekim 23:00.
    const sydney = buildSlotView({ startsAt: "2026-10-28T20:00:00Z", endsAt: "2026-10-28T20:30:00Z" }, "Australia/Sydney", "tr-TR", false, tr.schedule);
    expect(sydney.turkeyDayShift).toBe(-1);
    expect(sydney.sentence).toBe("29 Ekim Perşembe, sizin saatinizle 07:00–07:30, İstanbul saatiyle 23:00–23:30 (önceki gün)");
    const istanbul = buildSlotView({ startsAt: "2026-10-28T13:00:00Z", endsAt: "2026-10-28T13:30:00Z" }, "Europe/Istanbul", "tr-TR", false, tr.schedule);
    expect(istanbul.single).toBe(true);
    expect(istanbul.sentence).toBe("28 Ekim Çarşamba, 16:00–16:30 (Türkiye saati)");
  });

  it("yaz saati: Avrupa (25 Ekim) ve ABD (1 Kasım) geçişlerinde doğru saatler", () => {
    const berlinBefore = buildSlotView({ startsAt: "2026-10-24T14:00:00Z", endsAt: "2026-10-24T14:30:00Z" }, "Europe/Berlin", "tr-TR", false, tr.schedule);
    const berlinAfter = buildSlotView({ startsAt: "2026-10-26T14:00:00Z", endsAt: "2026-10-26T14:30:00Z" }, "Europe/Berlin", "tr-TR", false, tr.schedule);
    expect([berlinBefore.patientRange, berlinBefore.turkeyRange]).toEqual(["16:00 – 16:30", "17:00 – 17:30"]);
    expect([berlinAfter.patientRange, berlinAfter.turkeyRange]).toEqual(["15:00 – 15:30", "17:00 – 17:30"]);
    const nyBefore = buildSlotView({ startsAt: "2026-10-31T20:00:00Z", endsAt: "2026-10-31T20:30:00Z" }, "America/New_York", "en-US", true, tr.schedule);
    const nyAfter = buildSlotView({ startsAt: "2026-11-03T21:00:00Z", endsAt: "2026-11-03T21:30:00Z" }, "America/New_York", "en-US", true, tr.schedule);
    expect([nyBefore.patientRange, nyBefore.turkeyRange, nyBefore.turkeyDayShift]).toEqual(["4:00 PM – 4:30 PM", "23:00 – 23:30", 0]);
    expect([nyAfter.patientRange, nyAfter.turkeyRange, nyAfter.turkeyDayShift]).toEqual(["4:00 PM – 4:30 PM", "00:00 – 00:30", 1]);
  });
});

describe("takvime ekle", () => {
  const event = {
    uid: "b1",
    title: "Online görüşme — Dr. Ayşe, Kardiyoloji",
    startsAt: "2026-10-28T14:00:00.000Z",
    endsAt: "2026-10-28T14:30:00.000Z",
    url: "https://example.com/tr/patient/bookings/b1?t=abc",
  };

  it(".ics: UTC zamanlar (TZID yok), kaçışlı başlık, erişim bağlantısı; başka kişisel veri yok", () => {
    const ics = buildIcs([event], new Date("2026-10-01T00:00:00Z"));
    expect(ics).toContain("DTSTART:20261028T140000Z");
    expect(ics).toContain("DTEND:20261028T143000Z");
    expect(ics).toContain("DTSTAMP:20261001T000000Z");
    expect(ics).toContain("SUMMARY:Online görüşme — Dr. Ayşe\\, Kardiyoloji");
    expect(ics).toContain("URL:https://example.com/tr/patient/bookings/b1?t=abc");
    expect(ics).not.toContain("TZID");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("Google Takvim bağlantısı: action=TEMPLATE, dates UTC aralığı, başlık; erişim bağlantısı (token) Google'a gitmez", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261028T140000Z/20261028T143000Z");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("details")).toBeNull();
    expect(url.toString()).not.toContain("t%3Dabc");
  });
});

function Harness() {
  const s = useBookingSelection();
  return (
    <>
      <TimeZoneBar
        timeZone={s.visitorTimeZone}
        source={s.timeZoneSource}
        detectedTimeZone={s.detectedTimeZone}
        ipHint={s.ipHint}
        suggestion={s.timeZoneSuggestion}
        onChange={s.setPatientTimeZone}
        onKeep={s.keepCurrentTimeZone}
      />
      <p data-testid="probe">{`${s.visitorTimeZone ?? "-"}|${s.timeZoneSource ?? "-"}`}</p>
    </>
  );
}

function renderHarness() {
  return render(
    withLocale(
      <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
        <Harness />
      </BookingSelectionProvider>
    )
  );
}

describe("IP önerisi ve uyuşmazlık bildirimi", () => {
  it("tarayıcı TR, IP DE → nazik bildirim; 'Evet' Berlin'e geçer ve seçim hatırlanır", async () => {
    getGeoHint.mockResolvedValue({ countryCode: "DE", timeZone: "Europe/Berlin" });
    const user = userEvent.setup();
    renderHarness();
    const notice = await screen.findByTestId("tz-suggestion");
    expect(notice).toHaveTextContent("Konumunuz Almanya görünüyor, saatleri Berlin saatine göre göstermemizi ister misiniz?");
    expect(screen.getByTestId("probe")).toHaveTextContent("Europe/Istanbul|browser"); // otomatik değişiklik yok
    await user.click(within(notice).getByRole("button", { name: "Evet" }));
    expect(screen.getByTestId("probe")).toHaveTextContent("Europe/Berlin|session");
    expect(window.localStorage.getItem(PATIENT_TIME_ZONE_STORAGE_KEY)).toBe("Europe/Berlin");
    expect(screen.queryByTestId("tz-suggestion")).not.toBeInTheDocument();
    const bar = screen.getByTestId("time-zone-bar");
    expect(bar).toHaveTextContent("Almanya · Berlin");
    expect(bar).toHaveTextContent("İstanbul sizden");
  });

  it("'Hayır, şimdiki kalsın' mevcut dilimi saklar; sonraki ziyarette bildirim yok ve IP sorulmaz", async () => {
    getGeoHint.mockResolvedValue({ countryCode: "DE", timeZone: "Europe/Berlin" });
    const user = userEvent.setup();
    const { unmount } = renderHarness();
    await user.click(within(await screen.findByTestId("tz-suggestion")).getByRole("button", { name: "Hayır, şimdiki kalsın" }));
    expect(window.localStorage.getItem(PATIENT_TIME_ZONE_STORAGE_KEY)).toBe("Europe/Istanbul");
    unmount();
    getGeoHint.mockClear();
    renderHarness();
    expect(await screen.findByText("Europe/Istanbul|stored")).toBeInTheDocument();
    expect(screen.queryByTestId("tz-suggestion")).not.toBeInTheDocument();
    expect(getGeoHint).not.toHaveBeenCalled();
  });

  it("tarayıcı ve IP aynı ülke → bildirim yok; Türkiye'deyse 'Türkiye saatindesiniz' ve tek saat", async () => {
    getGeoHint.mockResolvedValue({ countryCode: "TR", timeZone: "Europe/Istanbul" });
    renderHarness();
    const bar = await screen.findByTestId("time-zone-bar");
    expect(await within(bar).findByText("Türkiye saatindesiniz")).toBeInTheDocument();
    expect(within(bar).queryByTestId("bar-turkey-clock")).toBeInTheDocument();
    expect(within(bar).queryByTestId("bar-patient-clock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tz-suggestion")).not.toBeInTheDocument();
  });

  it("tarayıcı UTC → IP dilimi varsayılan olur ve bant bunu açıkça söyler", async () => {
    browserTz = "UTC";
    getGeoHint.mockResolvedValue({ countryCode: "AE", timeZone: "Asia/Dubai" });
    renderHarness();
    expect(await screen.findByText("Asia/Dubai|ip")).toBeInTheDocument();
    expect(screen.getByTestId("bar-ip-note")).toHaveTextContent("Cihazınız saat dilimi bildirmediği için");
    expect(screen.getByTestId("time-zone-bar")).toHaveTextContent("Birleşik Arap Emirlikleri · Dubai");
    expect(screen.queryByTestId("tz-suggestion")).not.toBeInTheDocument();
  });
});
