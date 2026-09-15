import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetUserPasswordDialog } from "@/components/admin/users/set-user-password-dialog";
import { ApiClientError } from "@/lib/api/error";
import type { AdminUser } from "@/lib/api/types";

/**
 * `SetUserPasswordDialog` — admin panelinden bir kullanıcının şifresini manuel belirleme
 * (`PATCH /admin/users/{userId}/password`). Bu dosyanın kapsamı SAF form davranışıdır (react-hook-form
 * + zod doğrulaması, hata eşlemesi) — gerçek network akışı `admin-users-password.test.ts`
 * (backend-agent) tarafında zaten kapsanıyor.
 */
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/users-admin", () => ({
  setAdminUserPassword: vi.fn(),
}));

const usersAdminApi = await import("@/lib/api/users-admin");
const { toast } = await import("sonner");

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "user-1",
    email: "hedef@example.com",
    name: "Hedef Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "USER",
    canUseAdvancedBuilder: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE",
    lastLoginAt: null,
    deletedAt: null,
    doctorProfileId: null,
    ...overrides,
  };
}

function renderDialog(overrides: { onOpenChange?: (open: boolean) => void; user?: AdminUser | null } = {}) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const user = overrides.user ?? makeUser();
  const utils = render(<SetUserPasswordDialog open onOpenChange={onOpenChange} user={user} />);
  return { ...utils, onOpenChange, user };
}

describe("SetUserPasswordDialog — doğrulama", () => {
  it("kısa şifre girildiğinde gönderim engellenir ve hata mesajı gösterilir", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/^Yeni Şifre/), "kisa1");
    await user.type(screen.getByLabelText(/^Şifreyi Onayla/), "kisa1");
    await user.click(screen.getByRole("button", { name: "Şifreyi Değiştir" }));

    expect(await screen.findByText("Şifre en az 8 karakter olmalı.")).toBeInTheDocument();
    expect(usersAdminApi.setAdminUserPassword).not.toHaveBeenCalled();
  });

  it("şifreler eşleşmediğinde gönderim engellenir", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/^Yeni Şifre/), "YeniSifre12345!");
    await user.type(screen.getByLabelText(/^Şifreyi Onayla/), "FarkliSifre12345!");
    await user.click(screen.getByRole("button", { name: "Şifreyi Değiştir" }));

    expect(await screen.findByText("Şifreler eşleşmiyor.")).toBeInTheDocument();
    expect(usersAdminApi.setAdminUserPassword).not.toHaveBeenCalled();
  });

  it("geçerli/eşleşen şifreyle gönderim başarılı olursa setAdminUserPassword çağrılır, toast gösterilir ve dialog kapanır", async () => {
    vi.mocked(usersAdminApi.setAdminUserPassword).mockResolvedValueOnce(makeUser());
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.type(screen.getByLabelText(/^Yeni Şifre/), "YeniSifre12345!");
    await user.type(screen.getByLabelText(/^Şifreyi Onayla/), "YeniSifre12345!");
    await user.click(screen.getByRole("button", { name: "Şifreyi Değiştir" }));

    await waitFor(() => {
      expect(usersAdminApi.setAdminUserPassword).toHaveBeenCalledWith("user-1", "YeniSifre12345!");
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Şifre güncellendi."));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("backend 422 (kısa şifre) hatası `password` alanına yansır", async () => {
    vi.mocked(usersAdminApi.setAdminUserPassword).mockRejectedValueOnce(
      new ApiClientError(422, {
        code: "VALIDATION_ERROR",
        message: "Girdi doğrulama hatası.",
        details: { password: ["Şifre en az 8 karakter olmalı."] },
      })
    );
    const user = userEvent.setup();
    renderDialog();

    // zod min(8) istemci tarafını atlatmak için tam 8+ karakterli ama backend'in reddettiği bir
    // değer kullanıyoruz (senaryo: istemci/backend kuralları arasında olası bir tutarsızlık).
    await user.type(screen.getByLabelText(/^Yeni Şifre/), "12345678");
    await user.type(screen.getByLabelText(/^Şifreyi Onayla/), "12345678");
    await user.click(screen.getByRole("button", { name: "Şifreyi Değiştir" }));

    expect(await screen.findByText("Şifre en az 8 karakter olmalı.")).toBeInTheDocument();
  });

  it("backend genel bir hata döndüğünde (örn. 403) üst seviye Alert'te gösterilir", async () => {
    vi.mocked(usersAdminApi.setAdminUserPassword).mockRejectedValueOnce(
      new ApiClientError(403, { code: "FORBIDDEN", message: "Bu işlem için yetkiniz yok." })
    );
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/^Yeni Şifre/), "YeniSifre12345!");
    await user.type(screen.getByLabelText(/^Şifreyi Onayla/), "YeniSifre12345!");
    await user.click(screen.getByRole("button", { name: "Şifreyi Değiştir" }));

    expect(await screen.findByText("Bu işlem için yetkiniz yok.")).toBeInTheDocument();
  });
});
