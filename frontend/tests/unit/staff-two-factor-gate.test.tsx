import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { getStaffTwoFactorState } from "@/lib/staff-two-factor";

/**
 * Paket G — personel için zorunlu 2FA: panel kabuğu, zorunluluk aktifken 2FA'sız ADMIN/MANAGER'ı
 * yalnızca 2FA kurulum sayfasına yönlendirir (diğer sayfaları hiç mount etmez); bekleme süresinde
 * uyarı şeridi gösterir. Kabuğun ağır alt bileşenleri stub'lanır.
 */

const replace = vi.fn();
let pathname = "/admin/users";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => pathname }));

let authValue: Record<string, unknown> = {};
vi.mock("@/context/auth-context", () => ({ useAuth: () => authValue }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => new Date("2026-10-19T12:00:00.000Z").getTime() }));
vi.mock("@/context/accent-context", () => ({ AccentProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/context/modules-context", () => ({ ModulesProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/context/command-palette-context", () => ({ CommandPaletteProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/admin/sidebar", () => ({ AdminSidebar: () => null }));
vi.mock("@/components/admin/topbar", () => ({ AdminTopbar: () => null }));
vi.mock("@/components/admin/breadcrumb", () => ({ AdminBreadcrumb: () => null }));
vi.mock("@/components/admin/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/admin/keyboard-shortcuts-modal", () => ({ KeyboardShortcutsModal: () => null }));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AdminShell } from "@/components/admin/admin-shell";

const PAST = "2026-10-01T09:00:00.000Z";
const FUTURE = "2026-11-01T09:00:00.000Z";
const NOW = new Date("2026-10-19T12:00:00.000Z").getTime();

describe("getStaffTwoFactorState", () => {
  it("rol/2FA/tarih kombinasyonları", () => {
    expect(getStaffTwoFactorState({ role: "ADMIN", twoFactorEnabled: false }, PAST, NOW)).toBe("required");
    expect(getStaffTwoFactorState({ role: "MANAGER", twoFactorEnabled: false }, FUTURE, NOW)).toBe("grace");
    expect(getStaffTwoFactorState({ role: "ADMIN", twoFactorEnabled: true }, PAST, NOW)).toBe("none");
    expect(getStaffTwoFactorState({ role: "EDITOR", twoFactorEnabled: false }, PAST, NOW)).toBe("none");
    expect(getStaffTwoFactorState({ role: "ADMIN", twoFactorEnabled: false }, null, NOW)).toBe("none");
    expect(getStaffTwoFactorState(null, PAST, NOW)).toBe("none");
  });
});

describe("AdminShell — personel 2FA kapısı", () => {
  beforeEach(() => {
    replace.mockReset();
    pathname = "/admin/users";
  });

  function setUser(user: { role: string; twoFactorEnabled: boolean }, staffTwoFactorRequiredAt: string | null) {
    authValue = { status: "authenticated", user, staffTwoFactorRequiredAt };
  }

  it("zorunluluk aktif + 2FA kapalı: başka sayfa mount edilmez, kurulum sayfasına yönlendirilir", () => {
    setUser({ role: "ADMIN", twoFactorEnabled: false }, PAST);
    render(<AdminShell><p>Kullanıcılar sayfası</p></AdminShell>);
    expect(screen.queryByText("Kullanıcılar sayfası")).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/admin/settings/security");
  });

  it("zorunluluk aktif + 2FA kapalı: kurulum sayfası AÇIK (kilitlenme yok) ve açıklama gösterilir", () => {
    pathname = "/admin/settings/security";
    setUser({ role: "MANAGER", twoFactorEnabled: false }, PAST);
    render(<AdminShell><p>Güvenlik sayfası</p></AdminShell>);
    expect(screen.getByText("Güvenlik sayfası")).toBeInTheDocument();
    expect(screen.getByText(/2FA\) kurmanız gerekiyor/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("bekleme süresi: sayfa açılır, uyarı şeridi ve kurulum bağlantısı görünür", () => {
    setUser({ role: "ADMIN", twoFactorEnabled: false }, FUTURE);
    render(<AdminShell><p>Kullanıcılar sayfası</p></AdminShell>);
    expect(screen.getByText("Kullanıcılar sayfası")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Şimdi kurun" })).toHaveAttribute("href", "/admin/settings/security");
    expect(replace).not.toHaveBeenCalled();
  });

  it("2FA açık ya da zorunluluk kapalı: uyarı yok, yönlendirme yok", () => {
    setUser({ role: "ADMIN", twoFactorEnabled: true }, PAST);
    const { unmount } = render(<AdminShell><p>Sayfa</p></AdminShell>);
    expect(screen.queryByText(/2FA/)).not.toBeInTheDocument();
    unmount();
    setUser({ role: "ADMIN", twoFactorEnabled: false }, null);
    render(<AdminShell><p>Sayfa</p></AdminShell>);
    expect(screen.queryByText(/2FA/)).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
