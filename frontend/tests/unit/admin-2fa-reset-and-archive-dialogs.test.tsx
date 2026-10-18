import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/error";

/**
 * Paket B (2026-10-18) — 2FA sıfırlama penceresi ve doktor "Sil / Arşivle" penceresi.
 */
const resetUserTwoFactor = vi.fn();
const resendActivationEmail = vi.fn();
vi.mock("@/lib/api/users-admin", () => ({
  resetUserTwoFactor: (...args: unknown[]) => resetUserTwoFactor(...args),
  resendActivationEmail: (...args: unknown[]) => resendActivationEmail(...args),
}));
const getDoctorDeletionCheck = vi.fn();
const deleteDoctor = vi.fn();
const archiveDoctor = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  getDoctorDeletionCheck: (...args: unknown[]) => getDoctorDeletionCheck(...args),
  deleteDoctor: (...args: unknown[]) => deleteDoctor(...args),
  archiveDoctor: (...args: unknown[]) => archiveDoctor(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { ResetTwoFactorDialog } from "@/components/admin/users/reset-two-factor-dialog";
import { DoctorDeleteOrArchiveDialog } from "@/components/admin/telehealth/doctor-delete-or-archive-dialog";

const USER = { id: "u1", name: "Dr. Ayşe", email: "ayse@example.com", lastLoginAt: null };
const DOCTOR = { id: "d1", title: "Dr.", fullName: "Laura Bennett" };

beforeEach(() => {
  resetUserTwoFactor.mockReset();
  resendActivationEmail.mockReset();
  getDoctorDeletionCheck.mockReset();
  deleteDoctor.mockReset();
  archiveDoctor.mockReset();
});

describe("ResetTwoFactorDialog", () => {
  it("6 haneli kod olmadan istek atmaz; geçerli kodla sıfırlar ve isteğe bağlı etkinleştirme e-postası gönderir", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const onOpenChange = vi.fn();
    resetUserTwoFactor.mockResolvedValue({ emailStatus: "sent", user: { ...USER, twoFactorEnabled: false } });
    resendActivationEmail.mockResolvedValue({ emailStatus: "sent" });
    render(<ResetTwoFactorDialog open onOpenChange={onOpenChange} user={USER} onReset={onReset} />);

    await user.click(screen.getByRole("button", { name: "2FA'yı sıfırla" }));
    expect(resetUserTwoFactor).not.toHaveBeenCalled();
    expect(screen.getByText(/6 haneli kodu girin/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Kendi doğrulama kodunuz/), "123456");
    await user.click(screen.getByRole("checkbox", { name: /Şifre belirleme e-postası da gönder/ }));
    await user.click(screen.getByRole("button", { name: "2FA'yı sıfırla" }));

    await waitFor(() => expect(resetUserTwoFactor).toHaveBeenCalledWith("u1", "123456"));
    await waitFor(() => expect(resendActivationEmail).toHaveBeenCalledWith("u1"));
    expect(onReset).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("admin'in kendi 2FA'sı kapalıysa hata ve Güvenlik ayarları bağlantısı gösterir", async () => {
    const user = userEvent.setup();
    resetUserTwoFactor.mockRejectedValue(
      new ApiClientError(403, { code: "STEP_UP_2FA_NOT_ENABLED", message: "Bu işlemi onaylamak için önce kendi hesabınızda 2FA'yı etkinleştirin." })
    );
    render(<ResetTwoFactorDialog open onOpenChange={vi.fn()} user={{ ...USER, lastLoginAt: "2026-10-01T00:00:00.000Z" }} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Kendi doğrulama kodunuz/), "654321");
    await user.click(screen.getByRole("button", { name: "2FA'yı sıfırla" }));

    expect(await screen.findByText(/önce kendi hesabınızda 2FA/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Güvenlik ayarlarına git" })).toHaveAttribute("href", "/admin/settings/security");
  });
});

describe("DoctorDeleteOrArchiveDialog", () => {
  it("geçmişi olmayan doktor için kalıcı silme sunar", async () => {
    const user = userEvent.setup();
    getDoctorDeletionCheck.mockResolvedValue({ deletable: true, appointmentCount: 0, bookingCount: 0, upcomingAppointmentCount: 0 });
    deleteDoctor.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    render(<DoctorDeleteOrArchiveDialog doctor={DOCTOR} onOpenChange={vi.fn()} onDeleted={onDeleted} />);

    await user.click(await screen.findByRole("button", { name: /Kalıcı Sil/ }));
    await waitFor(() => expect(deleteDoctor).toHaveBeenCalledWith("d1"));
    expect(onDeleted).toHaveBeenCalled();
    expect(archiveDoctor).not.toHaveBeenCalled();
  });

  it("randevu geçmişi varsa yeni mesajla Arşivle sunar", async () => {
    const user = userEvent.setup();
    getDoctorDeletionCheck.mockResolvedValue({ deletable: false, appointmentCount: 4, bookingCount: 3, upcomingAppointmentCount: 0 });
    archiveDoctor.mockResolvedValue({ ...DOCTOR, archivedAt: "2026-10-18T00:00:00.000Z" });
    const onArchived = vi.fn();
    render(<DoctorDeleteOrArchiveDialog doctor={DOCTOR} onOpenChange={vi.fn()} onArchived={onArchived} />);

    expect(await screen.findByText(/randevu geçmişi olduğu için kalıcı olarak silinemez/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kalıcı Sil/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Arşivle/ }));
    await waitFor(() => expect(archiveDoctor).toHaveBeenCalledWith("d1"));
    expect(onArchived).toHaveBeenCalled();
  });

  it("gelecekte açık randevu varsa Arşivle devre dışıdır", async () => {
    getDoctorDeletionCheck.mockResolvedValue({ deletable: false, appointmentCount: 2, bookingCount: 2, upcomingAppointmentCount: 1 });
    render(<DoctorDeleteOrArchiveDialog doctor={DOCTOR} onOpenChange={vi.fn()} />);

    expect(await screen.findByText(/Gelecekte 1 açık randevu var/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Arşivle/ })).toBeDisabled();
  });
});
