import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const apiFetchWithMeta = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  apiFetchWithMeta: (...a: unknown[]) => apiFetchWithMeta(...a),
}));

import * as api from "@/lib/api/service-desk-admin";

/** Kontrat (AI3-HIZLI-KONTRAT "API") uçlarına BİREBİR yol/yöntem/gövde. */
describe("service-desk-admin istemcisi", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetchWithMeta.mockReset();
    apiFetch.mockResolvedValue(undefined);
  });

  it("admin masa uçları", async () => {
    await api.getServiceDesk();
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk");
    await api.updateServiceDesk({ durationMin: 30, serviceBookingEnabled: true });
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk", { method: "PATCH", body: { durationMin: 30, serviceBookingEnabled: true } });
    apiFetch.mockResolvedValueOnce({ hours: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }] });
    const saved = await api.setServiceDeskHours([{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }]);
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/hours", { method: "PUT", body: { hours: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }] } });
    expect(saved).toHaveLength(1);
    await api.createClosure({ date: "2026-12-25", note: "Tatil" });
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/closures", { method: "POST", body: { date: "2026-12-25", note: "Tatil" } });
    await api.deleteClosure("cl/1");
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/closures/cl%2F1", { method: "DELETE" });
  });

  it("koordinatör yönetimi uçları", async () => {
    await api.listCoordinators();
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/coordinators");
    await api.listCoordinatorCandidates();
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/coordinator-candidates");
    await api.createCoordinator({ userId: "u1", displayName: "Ayşe K.", languages: ["en", "de"] });
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/coordinators", { method: "POST", body: { userId: "u1", displayName: "Ayşe K.", languages: ["en", "de"] } });
    await api.updateCoordinator("c1", { isActive: false });
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/coordinators/c1", { method: "PATCH", body: { isActive: false } });
  });

  it("admin görüşme listesi süzgeç/sayfa sorgusu ve sayfalama çıkarımı", async () => {
    apiFetchWithMeta.mockResolvedValueOnce({ data: new Array(20).fill({}), meta: { nextCursor: null } });
    const page = await api.listAdminConsultations({ from: "2026-11-01", to: "", status: "SCHEDULED", page: 2 });
    expect(apiFetchWithMeta).toHaveBeenLastCalledWith("/admin/service-desk/consultations", { query: { from: "2026-11-01", to: undefined, status: "SCHEDULED", page: 2 } });
    expect(page).toMatchObject({ page: 2, hasNext: true });
    apiFetchWithMeta.mockResolvedValueOnce({ data: [{}], meta: { nextCursor: null, totalPages: 2 } });
    expect((await api.listAdminConsultations({ page: 2 })).hasNext).toBe(false);
    await api.getAdminConsultation("x1");
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/consultations/x1");
    await api.cancelAdminConsultation("x1", "Hasta istedi");
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/consultations/x1/cancel", { method: "POST", body: { reason: "Hasta istedi" } });
    await api.cancelAdminConsultation("x1");
    expect(apiFetch).toHaveBeenLastCalledWith("/admin/service-desk/consultations/x1/cancel", { method: "POST", body: {} });
  });

  it("koordinatör uçları", async () => {
    await api.listCoordinatorConsultations("today");
    expect(apiFetch).toHaveBeenLastCalledWith("/coordinator/consultations", { query: { scope: "today" } });
    await api.getCoordinatorConsultation("c1");
    expect(apiFetch).toHaveBeenLastCalledWith("/coordinator/consultations/c1");
    await api.getCoordinatorConsultationMessage("c1");
    expect(apiFetch).toHaveBeenLastCalledWith("/coordinator/consultations/c1/message");
    await api.requestCoordinatorHostToken("c1");
    expect(apiFetch).toHaveBeenLastCalledWith("/coordinator/consultations/c1/host-token", { method: "POST" });
  });
});
