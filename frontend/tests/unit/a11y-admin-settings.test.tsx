import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminSettingsPage from "@/app/admin/settings/page";
import type { PermissionsMatrix, SiteSettings } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings",
}));
vi.mock("@/lib/api/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getPermissionsMatrix: vi.fn(),
}));
vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));

const settingsApi = await import("@/lib/api/settings");
const pagesApi = await import("@/lib/api/pages");

const axeOptions = { rules: { region: { enabled: false } } };

const settings: SiteSettings = { siteName: "Örnek Site", logoUrl: null, homePageId: null, siteTemplate: "SHOWCASE" };
const permissions: PermissionsMatrix = {
  roles: ["ADMIN", "EDITOR", "VIEWER"],
  modules: [{ module: "pages", label: "Sayfalar", actions: { view: ["ADMIN", "EDITOR", "VIEWER"], edit: ["ADMIN", "EDITOR"] } }],
};

describe("AdminSettingsPage — a11y", () => {
  it("Genel Ayarlar sekmesi yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
    vi.mocked(pagesApi.listPages).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    const { container } = render(<AdminSettingsPage />);

    expect(await screen.findByLabelText(/Site adı/)).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("Güvenlik & Rol İzinleri sekmesi (izin matrisi tablosu) yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
    vi.mocked(pagesApi.listPages).mockResolvedValue({ items: [], meta: { nextCursor: null } });
    vi.mocked(settingsApi.getPermissionsMatrix).mockResolvedValue(permissions);

    const user = userEvent.setup();
    const { container } = render(<AdminSettingsPage />);

    await screen.findByLabelText(/Site adı/);
    await user.click(screen.getByRole("tab", { name: /Güvenlik & Rol İzinleri/ }));

    expect(await screen.findByText("Rol İzin Matrisi")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
