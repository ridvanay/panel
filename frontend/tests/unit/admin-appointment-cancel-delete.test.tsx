import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Appointment } from "@/lib/api/types";

/**
 * Paket A1 (2026-10-18) — admin randevu iptali (opsiyonel gerekçe) ve iki adımlı kalıcı silme.
 */
const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  apiFetchPage: vi.fn(),
  apiFetchWithMeta: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { cancelAppointment, deleteAppointment } from "@/lib/api/telehealth";
import { CancelAppointmentDialog } from "@/components/admin/telehealth/cancel-appointment-dialog";
import { DeleteAppointmentDialog } from "@/components/admin/telehealth/delete-appointment-dialog";

const APPOINTMENT: Appointment = {
  id: "11111111-1111-4111-8111-111111111111",
  doctorId: "doc-1",
  doctor: { id: "doc-1", title: "Dr.", fullName: "Ayşe Yılmaz", slug: "ayse-yilmaz" },
  patientUserId: null,
  patientName: "Test Hasta",
  patientEmail: "hasta@example.com",
  startsAt: "2026-10-18T10:00:00.000Z",
  endsAt: "2026-10-18T10:30:00.000Z",
  status: "CANCELLED",
  priceCents: 0,
  currency: "TRY",
  startedAt: null,
  endedAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: "2026-10-18T09:00:00.000Z",
  updatedAt: "2026-10-18T09:00:00.000Z",
};

beforeEach(() => {
  apiFetch.mockReset();
});

describe("cancelAppointment / deleteAppointment istemcisi", () => {
  it("gerekçe yoksa gövde olarak `{}` gönderir (gövdesiz istek 422 veriyordu)", async () => {
    apiFetch.mockResolvedValue(APPOINTMENT);
    await cancelAppointment(APPOINTMENT.id);
    expect(apiFetch).toHaveBeenCalledWith(`/appointments/${APPOINTMENT.id}/cancel`, expect.objectContaining({ method: "POST", body: {} }));
  });

  it("boşluktan ibaret gerekçe de `{}` olur; dolu gerekçe kırpılarak gider", async () => {
    apiFetch.mockResolvedValue(APPOINTMENT);
    await cancelAppointment(APPOINTMENT.id, undefined, "   ");
    expect(apiFetch.mock.calls[0]![1]).toMatchObject({ body: {} });
    await cancelAppointment(APPOINTMENT.id, undefined, "  Hasta talebi ");
    expect(apiFetch.mock.calls[1]![1]).toMatchObject({ body: { reason: "Hasta talebi" } });
  });

  it("kalıcı silme ikinci onayı (`confirm: true`) gövdede taşır", async () => {
    apiFetch.mockResolvedValue(undefined);
    await deleteAppointment(APPOINTMENT.id);
    expect(apiFetch).toHaveBeenCalledWith(`/admin/telehealth/appointments/${APPOINTMENT.id}`, { method: "DELETE", body: { confirm: true } });
  });
});

describe("CancelAppointmentDialog", () => {
  it("opsiyonel iptal gerekçesini gönderir", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(APPOINTMENT);
    const onCancelled = vi.fn();
    render(<CancelAppointmentDialog open onOpenChange={vi.fn()} appointment={{ ...APPOINTMENT, status: "SCHEDULED" }} onCancelled={onCancelled} />);

    await user.type(screen.getByLabelText(/İptal gerekçesi/), "Doktor izinli");
    await user.click(screen.getByRole("button", { name: "İptal Et" }));

    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0]![1]).toMatchObject({ body: { reason: "Doktor izinli" } });
  });
});

describe("DeleteAppointmentDialog", () => {
  it("engel varsa nedenleri listeler ve silme butonu sunmaz", async () => {
    apiFetch.mockResolvedValueOnce({
      deletable: false,
      blockers: [{ code: "HAS_PAYMENT", message: "Randevunun ödeme kaydı var (ücretsiz seans dahil); mali kayıt silinemez." }],
    });
    render(<DeleteAppointmentDialog open onOpenChange={vi.fn()} appointment={APPOINTMENT} onDeleted={vi.fn()} />);

    expect(await screen.findByText(/ödeme kaydı var/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Devam Et" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kalıcı Olarak Sil" })).not.toBeInTheDocument();
  });

  it("iki adımlı onay: 'Devam Et' → 'SİL' yazılınca kalıcı silme açılır ve çağrılır", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ deletable: true, blockers: [] }).mockResolvedValueOnce(undefined);
    const onDeleted = vi.fn();
    render(<DeleteAppointmentDialog open onOpenChange={vi.fn()} appointment={APPOINTMENT} onDeleted={onDeleted} />);

    await user.click(await screen.findByRole("button", { name: "Devam Et" }));
    const deleteButton = screen.getByRole("button", { name: "Kalıcı Olarak Sil" });
    expect(deleteButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Onaylamak için/), "sil");
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenLastCalledWith(`/admin/telehealth/appointments/${APPOINTMENT.id}`, { method: "DELETE", body: { confirm: true } });
  });
});
