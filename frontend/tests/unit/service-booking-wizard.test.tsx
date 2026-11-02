import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/error";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import type { SiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * AI İş 3 — ziyaretçi rezervasyon sihirbazı (`/book-consultation`): hizmet ön seçimi, eski takvim/saat ızgarası (slot kaynağı
 * mock), rıza mantığı (mesaj → sağlık verisi rızası), gövde biçimi, hata eşlemeleri (SLOT_TAKEN, SERVICE_NOT_BOOKABLE,
 * limit, 429, 422) ve başarı ekranı. Backend uçları mock'lanır.
 */
const api = vi.hoisted(() => ({ slots: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/api/service-consultations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/service-consultations")>()),
  getServiceConsultationSlots: (...args: unknown[]) => api.slots(...args),
  createServiceConsultation: (...args: unknown[]) => api.create(...args),
}));
vi.mock("@/lib/api/geo", () => ({ getGeoHint: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/context/locale-alternates-context", () => ({
  useLocaleAlternates: () => null,
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (p: string) => p,
  useLocaleCodes: () => ({ activeLocaleCode: "en", defaultLocaleCode: "en" }),
}));

import { ServiceBookingWizard } from "@/components/site/service-booking/service-booking-wizard";
import type { RequestServiceGroup } from "@/components/site/request/request-service-picker";
import { SERVICE_GROUP_ORDER, serviceGroupTitle, type ServiceGroupId } from "@/lib/service-groups";

const GROUPS: RequestServiceGroup[] = [
  { slug: "gastroenterology", name: "Gastroenterology", icon: "Stethoscope", serviceGroup: "digestive-interventional", children: [{ slug: "esd", name: "ESD" }] },
  { slug: "dental", name: "Dental care", icon: "Smile", serviceGroup: "aesthetic-dental-hair", children: [] },
];

let dict: SiteDictionary;

/** Bugünden 3 gün sonra 10:00 ve 10:30 UTC — her zaman seçilebilir gelecek günü. */
function futureSlots() {
  const day = new Date(Date.now() + 3 * 86_400_000);
  const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 10, 0, 0);
  return [0, 30].map((m) => ({ startsAt: new Date(base + m * 60_000).toISOString(), endsAt: new Date(base + (m + 30) * 60_000).toISOString(), available: true }));
}

beforeEach(async () => {
  api.slots.mockReset().mockImplementation(async () => futureSlots());
  api.create.mockReset().mockImplementation(async (body: { startsAt: string }) => ({
    consultationNumber: "SVC-00012",
    startsAt: body.startsAt,
    endsAt: new Date(new Date(body.startsAt).getTime() + 30 * 60_000).toISOString(),
    durationMin: 30,
    joinOpensAt: new Date(new Date(body.startsAt).getTime() - 15 * 60_000).toISOString(),
  }));
  dict = await getSiteDictionary("en");
});

function renderWizard(over: Partial<React.ComponentProps<typeof ServiceBookingWizard>> = {}) {
  const groupTitles = Object.fromEntries(SERVICE_GROUP_ORDER.map((id) => [id, serviceGroupTitle(id, dict.services)])) as Record<ServiceGroupId, string>;
  return render(
    <ServiceBookingWizard
      lang="en"
      strings={dict.serviceBooking}
      requestStrings={dict.request}
      groups={GROUPS}
      groupTitles={groupTitles}
      initialService={null}
      pkg={null}
      config={{ timeZone: "Europe/Istanbul", durationMin: 30, horizonDays: 30 }}
      privacyHref="/privacy-notice"
      consentHref="/explicit-consent"
      homeHref="/"
      servicesHref="/specialties"
      callbackHref="/request?service=dental"
      findTreatmentHref="/find-your-treatment"
      {...over}
    />
  );
}

async function pickFirstSlot(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBeGreaterThan(0));
  await user.click(document.querySelector("button[data-slot-nav]") as HTMLElement);
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>, opts: { message?: string } = {}) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  await user.type(byId("booking-full-name"), "Jane Roe");
  await user.type(byId("booking-email"), "jane@example.com");
  fireEvent.change(byId("booking-country"), { target: { value: "DE" } });
  if (opts.message) await user.type(byId("booking-message"), opts.message);
}

describe("ServiceBookingWizard", () => {
  it("hizmet ön seçimiyle takvim adımında açılır; özet hekim yerine hasta koordinatörünü ve ücretsiz etiketini gösterir", async () => {
    renderWizard({ initialService: "dental" });
    expect(await screen.findByTestId("summary-service")).toHaveTextContent("Dental care");
    expect(screen.getByTestId("service-booking-summary")).toHaveTextContent("Patient Coordinator");
    expect(screen.getByTestId("service-booking-summary")).toHaveTextContent("Free of charge");
    expect(screen.getByTestId("service-booking-summary")).toHaveTextContent("30-minute video consultation with a patient coordinator");
    await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBe(2));
    expect(screen.getByTestId("slot-availability-legend")).toBeInTheDocument();
    expect(screen.getByTestId("booking-stepper-bar")).toBeInTheDocument();
    // Slot kaynağı masa uçları (doktor ucu değil).
    expect(api.slots).toHaveBeenCalledTimes(1);
  });

  it("ön seçim yoksa hizmet adımıyla başlar; seçmeden devam edilemez", async () => {
    const user = userEvent.setup();
    renderWizard();
    expect(screen.getByTestId("booking-step-service")).toBeInTheDocument();
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByText(dict.request.required)).toBeInTheDocument();
    await user.click(screen.getByTestId("request-service-esd"));
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByTestId("summary-service")).toHaveTextContent("ESD");
    await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBe(2));
  });

  it("slot seçilmeden Continue pasiftir; tek seçim yeni slotla değişir", async () => {
    const user = userEvent.setup();
    renderWizard({ initialService: "dental" });
    await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBe(2));
    expect(screen.getByTestId("summary-continue")).toBeDisabled();
    const [first, second] = Array.from(document.querySelectorAll<HTMLElement>("button[data-slot-nav]"));
    await user.click(first!);
    expect(screen.getByTestId("summary-continue")).toBeEnabled();
    await user.click(second!);
    expect(document.querySelectorAll('button[data-slot-nav][aria-checked="true"]').length).toBe(1);
  });

  it("rıza mantığı: mesaj doluysa sağlık verisi rızası zorunlu; iletişim rızası zorunlu; uyarı metni görünür", async () => {
    const user = userEvent.setup();
    renderWizard({ initialService: "dental" });
    await pickFirstSlot(user);
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByTestId("booking-step-details")).toBeInTheDocument();
    expect(screen.getByTestId("booking-message-notice")).toHaveTextContent(/Do not share detailed medical information/i);
    expect(screen.getByTestId("booking-medical-note")).toHaveTextContent("This is not a medical examination");

    await fillDetails(user, { message: "I have a question" });
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByTestId("booking-consent-contact-error")).toHaveTextContent(dict.request.consentContactRequired);
    expect(screen.getByTestId("booking-consent-health-error")).toBeInTheDocument();
    expect(screen.queryByTestId("booking-step-confirm")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("booking-consent-contact"));
    await user.click(screen.getByTestId("booking-consent-health"));
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByTestId("booking-step-confirm")).toBeInTheDocument();
  });

  it("onayda gövde AH alanlarını + startsAt/patientTimeZone/locale ile gönderir; başarıda SVC numarası, katılım notu ve takvime ekle çıkar", async () => {
    const user = userEvent.setup();
    renderWizard({ initialService: "dental" });
    await pickFirstSlot(user);
    await user.click(screen.getByTestId("summary-continue"));
    await fillDetails(user);
    await user.click(screen.getByTestId("booking-consent-contact"));
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByTestId("booking-review")).toHaveTextContent("Patient Coordinator");
    expect(screen.getByTestId("booking-review")).toHaveTextContent("Free of charge");
    await user.click(screen.getByTestId("summary-continue"));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const body = api.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({
      serviceSlug: "dental",
      specialtySlug: "dental",
      packageSlug: null,
      country: "DE",
      contactLanguage: "en",
      needsInterpreter: false,
      fullName: "Jane Roe",
      email: "jane@example.com",
      phone: null,
      preferredContactChannel: "email",
      message: null,
      contactConsent: true,
      healthDataConsent: false,
      locale: "en",
      website: "",
    });
    expect(typeof body.startsAt).toBe("string");
    expect(typeof body.patientTimeZone).toBe("string");

    expect(await screen.findByTestId("service-booking-success")).toBeInTheDocument();
    expect(screen.getByTestId("service-booking-number")).toHaveTextContent("SVC-00012");
    expect(screen.getByTestId("service-booking-join-note")).toHaveTextContent("A link to join has been sent to your e-mail. The room opens 15 minutes before the start.");
    expect(screen.getByTestId("add-to-calendar")).toBeInTheDocument();
    expect(screen.getAllByTestId("dual-summary").length).toBeGreaterThan(0);
  });

  it("honeypot dolu gönderilir (sunucu sessizce yok sayar); tercüman evet ise tercüman dili gider", async () => {
    const user = userEvent.setup();
    renderWizard({ initialService: "dental" });
    await pickFirstSlot(user);
    await user.click(screen.getByTestId("summary-continue"));
    await fillDetails(user);
    await user.type(screen.getByTestId("booking-website"), "http://spam.example");
    await user.click(screen.getByTestId("booking-interpreter"));
    fireEvent.change(await screen.findByTestId("booking-interpreter-language"), { target: { value: "ar" } });
    await user.click(screen.getByTestId("booking-consent-contact"));
    await user.click(screen.getByTestId("summary-continue"));
    await user.click(await screen.findByTestId("summary-continue"));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![0]).toMatchObject({ website: "http://spam.example", needsInterpreter: true, interpreterLanguage: "ar" });
  });

  it("paket seçiliyse hizmet adımı atlanır ve gövdede packageSlug gider", async () => {
    const user = userEvent.setup();
    renderWizard({ pkg: { slug: "smile-makeover", title: "Smile Makeover" } });
    expect(await screen.findByTestId("summary-service")).toHaveTextContent("Smile Makeover");
    await pickFirstSlot(user);
    await user.click(screen.getByTestId("summary-continue"));
    await fillDetails(user);
    await user.click(screen.getByTestId("booking-consent-contact"));
    await user.click(screen.getByTestId("summary-continue"));
    await user.click(await screen.findByTestId("summary-continue"));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0]![0]).toMatchObject({ serviceSlug: null, specialtySlug: null, packageSlug: "smile-makeover" });
  });

  async function reachConfirm(user: ReturnType<typeof userEvent.setup>) {
    await pickFirstSlot(user);
    await user.click(screen.getByTestId("summary-continue"));
    await fillDetails(user);
    await user.click(screen.getByTestId("booking-consent-contact"));
    await user.click(screen.getByTestId("summary-continue"));
    await screen.findByTestId("booking-review");
  }

  it("SLOT_TAKEN: seçim temizlenir, takvim yeniden yüklenir ve mesaj gösterilir", async () => {
    const user = userEvent.setup();
    api.create.mockRejectedValueOnce(new ApiClientError(409, { code: "SLOT_TAKEN", message: "taken" }));
    renderWizard({ initialService: "dental" });
    await reachConfirm(user);
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByText(dict.serviceBooking.slotTaken)).toBeInTheDocument();
    await waitFor(() => expect(api.slots).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBe(2));
    expect(document.querySelectorAll('button[data-slot-nav][aria-checked="true"]').length).toBe(0);
    expect(screen.getByTestId("summary-continue")).toBeDisabled();
  });

  it("SERVICE_NOT_BOOKABLE (gönderimde): talep formuna yönlendiren bilgi kartı", async () => {
    const user = userEvent.setup();
    api.create.mockRejectedValueOnce(new ApiClientError(404, { code: "SERVICE_NOT_BOOKABLE", message: "x" }));
    renderWizard({ initialService: "dental" });
    await reachConfirm(user);
    await user.click(screen.getByTestId("summary-continue"));
    const card = await screen.findByTestId("service-booking-unavailable");
    expect(card).toHaveTextContent(dict.serviceBooking.notBookableTitle);
    expect(screen.getByTestId("service-booking-callback-cta")).toHaveAttribute("href", "/request?service=dental");
  });

  it("SERVICE_NOT_BOOKABLE (slot yüklemede): bilgi kartı", async () => {
    api.slots.mockRejectedValueOnce(new ApiClientError(404, { code: "SERVICE_NOT_BOOKABLE", message: "x" }));
    renderWizard({ initialService: "dental" });
    expect(await screen.findByTestId("service-booking-unavailable")).toBeInTheDocument();
  });

  it("slot yükleme hatası: yeniden dene seçeneği; yükleme sırasında iskelet", async () => {
    const user = userEvent.setup();
    api.slots.mockRejectedValueOnce(new ApiClientError(500, { code: "INTERNAL_ERROR", message: "x" }));
    renderWizard({ initialService: "dental" });
    expect(await screen.findByTestId("booking-slots-error")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: dict.serviceBooking.retry }));
    await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBe(2));
  });

  it("SERVICE_CONSULTATION_LIMIT, 429 ve 422 alan hataları ilgili metne/adıma eşlenir", async () => {
    const user = userEvent.setup();
    api.create
      .mockRejectedValueOnce(new ApiClientError(409, { code: "SERVICE_CONSULTATION_LIMIT", message: "x" }))
      .mockRejectedValueOnce(new ApiClientError(429, { code: "RATE_LIMITED", message: "x" }))
      .mockRejectedValueOnce(new ApiClientError(422, { code: "VALIDATION_ERROR", message: "x", details: { email: ["Bad email"] } }));
    renderWizard({ initialService: "dental" });
    await reachConfirm(user);
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByTestId("booking-error")).toHaveTextContent(dict.serviceBooking.limitReached);
    await user.click(screen.getByTestId("summary-continue"));
    await waitFor(() => expect(screen.getByTestId("booking-error")).toHaveTextContent(dict.serviceBooking.errorRateLimit));
    await user.click(screen.getByTestId("summary-continue"));
    expect(await screen.findByTestId("booking-step-details")).toBeInTheDocument();
    expect(screen.getByText("Bad email")).toBeInTheDocument();
  });

  it("görünen metinde hekim sözcüğü yok (alan etiketleri, takvim, özet)", async () => {
    const user = userEvent.setup();
    const { container } = renderWizard({ initialService: "dental" });
    await waitFor(() => expect(document.querySelectorAll("button[data-slot-nav]").length).toBe(2));
    const all = () => [container.textContent ?? "", ...Array.from(container.querySelectorAll("[aria-label],[title]")).flatMap((el) => [el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? ""])].join(" ");
    expect(all()).not.toMatch(/\b(doctors?|physicians?|surgeons?)\b/i);
    await pickFirstSlot(user);
    await user.click(screen.getByTestId("summary-continue"));
    // Tıbbi karar notu "physicians at authorized healthcare facilities" izinlidir.
    const withoutAllowed = all().replace(/physicians at authorized healthcare facilities/gi, "");
    expect(withoutAllowed).not.toMatch(/\b(doctors?|physicians?|surgeons?)\b/i);
  });
});
