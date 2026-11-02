import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { resolvePostLoginPath } from "@/lib/post-login-destination";

/**
 * Paket AG (İş 2) — yönetici bildirim e-postasındaki bağlantı `/admin/telehealth/bookings/<id>`: oturum yoksa admin kabuğu
 * `/login?next=<yol>`'a yönlendirir, girişten sonra panel rolü aynı yola geri döner.
 */
const replace = vi.fn();
let pathname = "/admin/telehealth/bookings/b-1";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => pathname }));

let authValue: Record<string, unknown> = {};
vi.mock("@/context/auth-context", () => ({ useAuth: () => authValue }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => new Date("2026-11-02T12:00:00.000Z").getTime() }));
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

describe("admin randevu bağlantısı — oturum yönlendirmesi", () => {
  beforeEach(() => {
    replace.mockReset();
    pathname = "/admin/telehealth/bookings/b-1";
  });

  it("oturumsuz: /login?next=<detay yolu> (encode edilmiş) adresine yönlendirir", () => {
    authValue = { status: "unauthenticated", user: null, staffTwoFactorRequiredAt: null };
    render(<AdminShell><p>Detay</p></AdminShell>);
    expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/admin/telehealth/bookings/b-1")}`);
  });

  it("girişten sonra panel rolü aynı detay yoluna döner; panel dışı rol dönmez; harici adres reddedilir", () => {
    const next = "/admin/telehealth/bookings/b-1";
    for (const role of ["ADMIN", "MANAGER"] as const) {
      expect(resolvePostLoginPath({ next, doctorProfileId: null, telehealthEnabled: true, role })).toBe(next);
    }
    expect(resolvePostLoginPath({ next, doctorProfileId: null, telehealthEnabled: true, role: "USER" })).not.toBe("/admin");
    expect(resolvePostLoginPath({ next: "//evil.com", doctorProfileId: null, telehealthEnabled: true, role: "ADMIN" })).toBe("/admin");
  });

  it("oturumlu admin: detay sayfası render edilir, yönlendirme olmaz", () => {
    authValue = { status: "authenticated", user: { role: "ADMIN", twoFactorEnabled: true }, staffTwoFactorRequiredAt: null };
    const { getByText } = render(<AdminShell><p>Detay</p></AdminShell>);
    expect(getByText("Detay")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
