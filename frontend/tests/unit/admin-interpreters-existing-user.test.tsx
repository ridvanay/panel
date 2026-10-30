import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/error";
import type { AdminInterpreter, InterpreterUserSearchResult } from "@/lib/api/types";

/**
 * Paket AA-ek — admin "Tercümanlar": kayıtlı e-postada hata yerine "Var olan kullanıcıdan ekle"
 * yönlendirmesi; arama sonucunda mevcut rol; onay penceresi metni; "Tercümanlığı kapat" onayı; 2FA ayarı.
 */
const { api } = vi.hoisted(() => {
  const existingProfile: AdminInterpreter = {
    id: "p-1",
    userId: "u-1",
    name: "Ayşe Admin",
    email: "ayse@example.com",
    role: "ADMIN",
    isDoctor: false,
    displayName: "A. Admin",
    languages: ["ar"],
    timeZone: "Europe/Istanbul",
    isActive: true,
    twoFactorEnabled: false,
    hasLoggedIn: true,
    confidentialityAcceptedAt: null,
    confidentialityCurrent: false,
    notes: null,
    activeAssignments: 0,
  };
  const searchResult: InterpreterUserSearchResult = { id: "u-2", name: "Mehmet Hasta", email: "mehmet@example.com", role: "USER", isDoctor: false, interpreterProfileId: null };

  const api = {
    listAdminInterpreters: vi.fn(async () => [existingProfile]),
    createAdminInterpreter: vi.fn(),
    searchUsersForInterpreter: vi.fn(async () => [searchResult]),
    createInterpreterFromUser: vi.fn(async () => ({ interpreter: { ...existingProfile, id: "p-2" }, existing: false, emailStatus: "sent" as const })),
    updateAdminInterpreter: vi.fn(async (_id: string, input: Partial<AdminInterpreter>) => ({ ...existingProfile, ...input })),
    getInterpreterSettings: vi.fn(async () => ({ require2fa: false })),
    updateInterpreterSettings: vi.fn(async (input: { require2fa: boolean }) => input),
    getInterpreterConfidentialityText: vi.fn(async () => ({ en: "EN", tr: "TR", version: "v1" })),
    updateInterpreterConfidentialityText: vi.fn(),
    getInterpreterReport: vi.fn(async () => []),
    downloadInterpreterReportCsv: vi.fn(),
    resendInterpreterInvite: vi.fn(),
  };
  return { existingProfile, searchResult, api };
});
vi.mock("@/lib/api/interpreter", () => api);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import AdminInterpretersPage from "@/app/admin/telehealth/interpreters/page";

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
});

describe("admin Tercümanlar — var olan kullanıcıya tercümanlık (Paket AA-ek)", () => {
  it("yeni hesap formunda kayıtlı e-posta: hata yerine yönlendirme; düğme 'Var olan kullanıcıdan ekle' sekmesini e-postayla açar", async () => {
    api.createAdminInterpreter.mockRejectedValueOnce(
      new ApiClientError(409, {
        code: "CONFLICT",
        message: "Bu e-posta kayıtlı. Var olan kullanıcıdan ekle sekmesinden tercümanlık verebilirsiniz.",
        details: { email: ["EMAIL_REGISTERED_USE_EXISTING"] },
      })
    );
    const user = userEvent.setup();
    render(<AdminInterpretersPage />);
    await user.click(await screen.findByRole("button", { name: "Tercüman ekle" }));
    await user.type(screen.getByLabelText("Ad soyad"), "Mehmet Hasta");
    await user.type(screen.getByLabelText("E-posta"), "mehmet@example.com");
    await user.type(screen.getByLabelText("Diller (kod, virgülle: ar, en, fa)"), "ar");
    await user.click(screen.getByRole("button", { name: "Oluştur ve davet gönder" }));

    expect(await screen.findByTestId("interpreter-email-registered")).toHaveTextContent("Bu e-posta kayıtlı. Var olan kullanıcıdan ekle sekmesinden tercümanlık verebilirsiniz.");
    await user.click(screen.getByRole("button", { name: "Var olan kullanıcıdan ekle" }));
    expect(screen.getByTestId("interpreter-user-search")).toHaveValue("mehmet@example.com");
  });

  it("arama sonucunda mevcut rol görünür; onay penceresi metni; rol değiştirmeden yetki verilir", async () => {
    const user = userEvent.setup();
    render(<AdminInterpretersPage />);
    await user.click(await screen.findByRole("button", { name: "Tercüman ekle" }));
    await user.click(screen.getByTestId("interpreter-tab-existing"));
    await user.type(screen.getByTestId("interpreter-user-search"), "mehmet");
    await user.click(screen.getByRole("button", { name: "Ara" }));
    expect(await screen.findByText(/mehmet@example\.com · Rol: Standart Üye/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Seç" }));
    await user.type(screen.getByLabelText("Diller (kod, virgülle: ar, en, fa)"), "ar, en");
    await user.click(screen.getByRole("button", { name: "Tercümanlık ver" }));
    expect(await screen.findByText("Bu kullanıcı mevcut yetkilerini koruyarak tercüman olarak görüşmelere atanabilecek.")).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: "Tercümanlık ver" });
    await user.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(api.createInterpreterFromUser).toHaveBeenCalledWith({ userId: "u-2", languages: ["ar", "en"], timeZone: "Europe/Istanbul" }));
  });

  it("listede mevcut rol; 'Tercümanlığı kapat' onayla profili pasif yapar; 2FA ayarı varsayılan kapalı", async () => {
    const user = userEvent.setup();
    render(<AdminInterpretersPage />);
    expect(await screen.findByText(/Rol: Süper Yönetici/)).toBeInTheDocument();
    const settings = await screen.findByTestId("interpreter-settings");
    expect(settings).toHaveTextContent("Tercümanlar için iki adımlı doğrulama (2FA) zorunlu");
    expect(within(settings).getByRole("switch")).not.toBeChecked();
    expect(screen.getByTestId("interpreter-2fa-risk")).toBeInTheDocument();
    await user.click(screen.getByTestId("interpreter-deactivate"));
    expect(await screen.findByText(/Kişinin rolü ve hesabı değişmez/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Tercümanlığı kapat" });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.updateAdminInterpreter).toHaveBeenCalledWith("p-1", { isActive: false }));
  });
});
