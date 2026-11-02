import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SiteSettings } from "@/lib/api/types";

/** Paket AG - "Randevu bildirimi alıcıları" kartı yalnızca ADMIN'e gösterilir (sunucu diğer rollerde boş döner). */
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/settings" }));
vi.mock("@/lib/api/settings", () => ({ getSettings: vi.fn(), updateSettings: vi.fn(), getPermissionsMatrix: vi.fn() }));
vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/locales", () => ({ listAdminLocales: vi.fn().mockResolvedValue([]) }));
let role: string | null = "ADMIN";
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => (role ? { user: { role } } : null) }));

import AdminSettingsPage from "@/app/admin/settings/page";
import { I18nProvider } from "@/context/i18n-context";

const settingsApi = await import("@/lib/api/settings");
const pagesApi = await import("@/lib/api/pages");

const settings = {
  siteName: "Örnek Site",
  logoUrl: null,
  tagline: null,
  homePageId: null,
  siteTemplate: "SHOWCASE",
  headerLogoHeight: null,
  headerLogoMaxWidth: null,
  shippingFlatFeeCents: null,
  freeShippingThresholdCents: null,
  shippingEstimatedDaysMin: null,
  shippingEstimatedDaysMax: null,
  demoPaymentsEnabled: false,
  demoPaymentsSupported: false,
  bookingNotificationRecipients: null,
  bookingNotificationRecipientsEffective: ["admin@wmhealthistanbul.com"],
} as SiteSettings;

async function renderPage() {
  vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
  vi.mocked(pagesApi.listPages).mockResolvedValue({ items: [], meta: { nextCursor: null } });
  render(
    <I18nProvider>
      <AdminSettingsPage />
    </I18nProvider>
  );
  expect(await screen.findByLabelText(/Site adı/)).toBeInTheDocument();
}

describe("AdminSettingsPage - randevu bildirimi alıcıları kartı", () => {
  beforeEach(() => {
    role = "ADMIN";
  });

  it("ADMIN: kart görünür, kayıtlı değer null iken varsayılan ipucu gösterilir", async () => {
    await renderPage();
    expect(screen.getByLabelText("Alıcı e-posta adresleri")).toHaveAttribute("placeholder", "Varsayılan: admin@wmhealthistanbul.com");
    expect(screen.getByTestId("booking-recipients-default-note")).toBeInTheDocument();
  });

  it("ADMIN dışı rol (MANAGER): kart hiç render edilmez", async () => {
    role = "MANAGER";
    await renderPage();
    expect(screen.queryByLabelText("Alıcı e-posta adresleri")).not.toBeInTheDocument();
  });

  it("oturum bağlamı yoksa kart gösterilmez", async () => {
    role = null;
    await renderPage();
    expect(screen.queryByLabelText("Alıcı e-posta adresleri")).not.toBeInTheDocument();
  });
});
