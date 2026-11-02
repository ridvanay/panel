import { beforeEach, describe, expect, it, vi } from "vitest";

/** AI İş 3 — ziyaretçi hizmet görüşmesi API istemcisi: uçlar ve gövde alan adları kontrata birebir (BE ile karşılaştırma için). */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import {
  buildServiceConsultationPayload,
  cancelServiceConsultation,
  createServiceConsultation,
  getServiceConsultationConfig,
  getServiceConsultationSlots,
  lookupServiceConsultation,
  rescheduleServiceConsultation,
} from "@/lib/api/service-consultations";

beforeEach(() => {
  apiFetch.mockReset().mockResolvedValue({});
});

describe("service-consultations API istemcisi", () => {
  it("config ve slots uçları; slotlar takvimin beklediği biçime (available: true) çevrilir", async () => {
    await getServiceConsultationConfig();
    expect(apiFetch).toHaveBeenLastCalledWith("/service-consultations/config", { skipAuthRetry: true });
    apiFetch.mockResolvedValueOnce({ timeZone: "Europe/Istanbul", durationMin: 30, slots: [{ startsAt: "2026-11-10T10:00:00.000Z", endsAt: "2026-11-10T10:30:00.000Z" }] });
    const slots = await getServiceConsultationSlots("2026-11-05", "2026-12-05");
    expect(apiFetch).toHaveBeenLastCalledWith("/service-consultations/slots", { query: { from: "2026-11-05", to: "2026-12-05" }, skipAuthRetry: true });
    expect(slots).toEqual([{ startsAt: "2026-11-10T10:00:00.000Z", endsAt: "2026-11-10T10:30:00.000Z", available: true }]);
  });

  it("POST /service-consultations: AH alan adları + startsAt/patientTimeZone/locale; hizmet alanı hem serviceSlug hem specialtySlug", async () => {
    const body = buildServiceConsultationPayload({
      serviceSlug: "dental",
      packageSlug: null,
      country: "DE",
      contactLanguage: "de",
      needsInterpreter: true,
      interpreterLanguage: "ar",
      fullName: "Jane Roe",
      email: "jane@example.com",
      phone: "+49 1511234567",
      preferredContactChannel: "whatsapp",
      message: "Hi",
      contactConsent: true,
      healthDataConsent: true,
      locale: "de",
      website: "",
      startsAt: "2026-11-10T10:00:00.000Z",
      patientTimeZone: "Europe/Berlin",
    });
    expect(body.specialtySlug).toBe("dental");
    await createServiceConsultation(body);
    expect(apiFetch).toHaveBeenLastCalledWith("/service-consultations", { method: "POST", body, skipAuthRetry: true });
    expect(Object.keys(body).sort()).toEqual(
      [
        "contactConsent",
        "contactLanguage",
        "country",
        "email",
        "fullName",
        "healthDataConsent",
        "interpreterLanguage",
        "locale",
        "message",
        "needsInterpreter",
        "packageSlug",
        "patientTimeZone",
        "phone",
        "preferredContactChannel",
        "serviceSlug",
        "specialtySlug",
        "startsAt",
        "website",
      ].sort()
    );
  });

  it("yönetim uçları: belirteç yalnızca POST gövdesinde (t)", async () => {
    await lookupServiceConsultation("sc_x");
    expect(apiFetch).toHaveBeenLastCalledWith("/service-consultations/manage/lookup", { method: "POST", body: { t: "sc_x" }, skipAuthRetry: true });
    await cancelServiceConsultation("sc_x");
    expect(apiFetch).toHaveBeenLastCalledWith("/service-consultations/manage/cancel", { method: "POST", body: { t: "sc_x" }, skipAuthRetry: true });
    await rescheduleServiceConsultation({ t: "sc_x", startsAt: "2026-11-11T10:00:00.000Z", patientTimeZone: "Europe/Berlin" });
    expect(apiFetch).toHaveBeenLastCalledWith("/service-consultations/manage/reschedule", {
      method: "POST",
      body: { t: "sc_x", startsAt: "2026-11-11T10:00:00.000Z", patientTimeZone: "Europe/Berlin" },
      skipAuthRetry: true,
    });
  });
});
