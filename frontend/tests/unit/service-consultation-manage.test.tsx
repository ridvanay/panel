import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/error";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import type { SiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * AI İş 3 — yönetim sayfası (`/book-consultation/manage#sc_…`): belirteç `#` parçasından okunup adres çubuğundan silinir,
 * görüşme bilgisi, iptal (onay diyaloğu), saat değişikliği (eski takvim/saat ızgarası) ve geçersiz bağlantıda tek tip ekran.
 */
const api = vi.hoisted(() => ({ lookup: vi.fn(), cancel: vi.fn(), reschedule: vi.fn(), config: vi.fn(), slots: vi.fn() }));
vi.mock("@/lib/api/service-consultations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/service-consultations")>()),
  lookupServiceConsultation: (...a: unknown[]) => api.lookup(...a),
  cancelServiceConsultation: (...a: unknown[]) => api.cancel(...a),
  rescheduleServiceConsultation: (...a: unknown[]) => api.reschedule(...a),
  getServiceConsultationConfig: (...a: unknown[]) => api.config(...a),
  getServiceConsultationSlots: (...a: unknown[]) => api.slots(...a),
}));
vi.mock("@/lib/api/geo", () => ({ getGeoHint: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/context/locale-alternates-context", () => ({
  useLocaleAlternates: () => null,
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (p: string) => p,
  useLocaleCodes: () => ({ activeLocaleCode: "en", defaultLocaleCode: "en" }),
}));

import { ServiceConsultationManage } from "@/components/site/service-booking/service-consultation-manage";

const TOKEN = `sc_${"A".repeat(43)}`;
let dict: SiteDictionary;

function view(over: Record<string, unknown> = {}) {
  const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  return {
    consultationNumber: "SVC-00042",
    status: "SCHEDULED",
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
    durationMin: 30,
    serviceName: "Dental care",
    canCancel: true,
    canReschedule: true,
    ...over,
  };
}

function futureSlots() {
  const day = new Date(Date.now() + 5 * 86_400_000);
  const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0);
  return [0, 30].map((m) => ({ startsAt: new Date(base + m * 60_000).toISOString(), endsAt: new Date(base + (m + 30) * 60_000).toISOString(), available: true }));
}

beforeEach(async () => {
  api.lookup.mockReset().mockResolvedValue(view());
  api.cancel.mockReset().mockResolvedValue({ status: "CANCELLED" });
  api.reschedule.mockReset().mockImplementation(async (input: { startsAt: string }) => view({ startsAt: input.startsAt }));
  api.config.mockReset().mockResolvedValue({ enabled: true, timeZone: "Europe/Istanbul", durationMin: 30, minNoticeMin: 120, horizonDays: 30 });
  api.slots.mockReset().mockImplementation(async () => futureSlots());
  window.location.hash = `#${TOKEN}`;
  dict = await getSiteDictionary("en");
});

function renderManage() {
  return render(<ServiceConsultationManage lang="en" strings={dict.serviceBooking} bookHref="/book-consultation" homeHref="/" />);
}

describe("ServiceConsultationManage", () => {
  it("belirteci # parçasından okur, adres çubuğundan siler ve yalnızca POST gövdesinde gönderir", async () => {
    renderManage();
    expect(await screen.findByTestId("manage-view")).toBeInTheDocument();
    expect(api.lookup).toHaveBeenCalledWith(TOKEN);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("sc_");
    expect(screen.getByTestId("manage-number")).toHaveTextContent("SVC-00042");
    expect(screen.getByTestId("manage-view")).toHaveTextContent("Patient Coordinator");
    expect(screen.getByTestId("manage-view")).toHaveTextContent("Dental care");
    expect(screen.getByTestId("manage-status")).toHaveTextContent("Scheduled");
  });

  it("aynı sekmede yeni #sc_ yapıştırılınca hashchange ile yeniden okunur ve adres çubuğundan silinir", async () => {
    renderManage();
    expect(await screen.findByTestId("manage-view")).toBeInTheDocument();
    const NEXT = `sc_${"B".repeat(43)}`;
    api.lookup.mockClear();
    window.location.hash = `#${NEXT}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(api.lookup).toHaveBeenCalledWith(NEXT));
    expect(window.location.hash).toBe("");
  });

  it("belirteç yoksa veya biçimi bozuksa tek tip geçersiz bağlantı ekranı (API çağrılmaz)", async () => {
    window.location.hash = "";
    const first = renderManage();
    expect(await screen.findByTestId("manage-invalid")).toHaveTextContent(dict.serviceBooking.manageInvalidTitle);
    expect(api.lookup).not.toHaveBeenCalled();
    first.unmount();
    window.location.hash = "#mg_notmine";
    renderManage();
    expect(await screen.findByTestId("manage-invalid")).toBeInTheDocument();
  });

  it("sunucu 404 döndürünce aynı tek tip ekran; ağ hatasında yeniden dene", async () => {
    const user = userEvent.setup();
    api.lookup.mockRejectedValueOnce(new ApiClientError(404, { code: "NOT_FOUND", message: "x" }));
    const first = renderManage();
    expect(await screen.findByTestId("manage-invalid")).toBeInTheDocument();
    first.unmount();
    window.location.hash = `#${TOKEN}`;
    api.lookup.mockReset().mockRejectedValueOnce(new ApiClientError(0, { code: "NETWORK_ERROR", message: "x" })).mockResolvedValueOnce(view());
    renderManage();
    expect(await screen.findByTestId("manage-error")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: dict.serviceBooking.retry }));
    expect(await screen.findByTestId("manage-view")).toBeInTheDocument();
  });

  it("iptal: onay diyaloğu → iptal çağrısı → iptal edildi ekranı", async () => {
    const user = userEvent.setup();
    renderManage();
    await user.click(await screen.findByTestId("manage-cancel"));
    expect(await screen.findByText(dict.serviceBooking.manageCancelTitle)).toBeInTheDocument();
    expect(api.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: dict.serviceBooking.manageCancelYes }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith(TOKEN));
    expect(await screen.findByTestId("manage-cancelled")).toHaveTextContent(dict.serviceBooking.manageCancelledTitle);
  });

  it("iptal onayında vazgeçilirse çağrı yapılmaz", async () => {
    const user = userEvent.setup();
    renderManage();
    await user.click(await screen.findByTestId("manage-cancel"));
    await user.click(await screen.findByRole("button", { name: dict.serviceBooking.manageCancelNo }));
    expect(api.cancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("manage-view")).toBeInTheDocument();
  });

  it("saat değişikliği: eski takvim/saat ızgarasıyla yeni slot seçilir ve gönderilir", async () => {
    const user = userEvent.setup();
    renderManage();
    await user.click(await screen.findByTestId("manage-reschedule"));
    expect(await screen.findByTestId("manage-reschedule-panel")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBe(2));
    expect(screen.getByTestId("manage-reschedule-confirm")).toBeDisabled();
    const slot = document.querySelector("button[data-slot-nav]") as HTMLElement;
    await user.click(slot);
    await user.click(screen.getByTestId("manage-reschedule-confirm"));
    await waitFor(() => expect(api.reschedule).toHaveBeenCalledTimes(1));
    expect(api.reschedule.mock.calls[0]![0]).toMatchObject({ t: TOKEN });
    expect(typeof api.reschedule.mock.calls[0]![0].startsAt).toBe("string");
    expect(typeof api.reschedule.mock.calls[0]![0].patientTimeZone).toBe("string");
    expect(await screen.findByTestId("manage-rescheduled")).toHaveTextContent(dict.serviceBooking.manageRescheduledTitle);
  });

  it("saat değişikliğinde SLOT_TAKEN: mesaj + takvim yenilenir", async () => {
    const user = userEvent.setup();
    api.reschedule.mockRejectedValueOnce(new ApiClientError(409, { code: "SLOT_TAKEN", message: "x" }));
    renderManage();
    await user.click(await screen.findByTestId("manage-reschedule"));
    await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBe(2));
    await user.click(document.querySelector("button[data-slot-nav]") as HTMLElement);
    await user.click(screen.getByTestId("manage-reschedule-confirm"));
    expect(await screen.findByText(dict.serviceBooking.manageSlotTaken)).toBeInTheDocument();
    await waitFor(() => expect(api.slots).toHaveBeenCalledTimes(2));
  });

  it("2 saatten az kala veya iptal edilmişse düğmeler yok; kilit notu gösterilir", async () => {
    api.lookup.mockResolvedValue(view({ canCancel: false, canReschedule: false }));
    renderManage();
    expect(await screen.findByTestId("manage-view")).toHaveTextContent(dict.serviceBooking.manageLockedNote);
    expect(screen.queryByTestId("manage-cancel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("manage-reschedule")).not.toBeInTheDocument();
  });

  it("hekim sözcüğü içermez", async () => {
    const { container } = renderManage();
    await screen.findByTestId("manage-view");
    const text = (container.textContent ?? "").replace(/physicians at authorized healthcare facilities/gi, "");
    expect(text).not.toMatch(/\b(doctors?|physicians?|surgeons?)\b/i);
  });
});
