import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteHeader } from "@/components/site/site-header";
import type { SiteSettings, User } from "@/lib/api/types";

/**
 * `.claude/architect-scope-telehealth-template.md` K6 — üç senaryo: doktor oturumu ("Doktor
 * Paneli" var, "Siparişlerim"/Sepet/Favoriler YOK), hasta/normal oturum ("Randevularım" var,
 * "Siparişlerim" var), anonim ("Giriş Yap" linki). `site-header-nested-nav.test.tsx` İLE AYNI
 * dropdown açma deseni.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

interface MockAuth {
  status: "authenticated" | "unauthenticated";
  user: Pick<User, "id" | "name" | "doctorProfileId"> | null;
  logout: () => Promise<void>;
}

let mockAuth: MockAuth = { status: "unauthenticated", user: null, logout: vi.fn(async () => {}) };
vi.mock("@/context/auth-context", () => ({
  useAuthOptional: () => mockAuth,
}));

vi.mock("@/context/cart-context", () => ({
  useCartOptional: () => ({ itemCount: 0 }),
}));

const settings: SiteSettings = {
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
};

function renderHeader() {
  return render(
    <SiteHeader settings={settings} pages={[]} productsModuleEnabled telehealthModuleEnabled />
  );
}

async function openAccountMenu(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: new RegExp(`Hesabım, ${name}`) }));
}

describe("SiteHeader — doktor/hasta/anonim oturum izolasyonu (K6)", () => {
  it("doktor oturumu: 'Doktor Paneli' var, 'Siparişlerim'/Sepet/Favoriler ikonları YOK", async () => {
    mockAuth = {
      status: "authenticated",
      user: { id: "u1", name: "Dr. Elif", doctorProfileId: "doctor-1" },
      logout: vi.fn(async () => {}),
    };
    renderHeader();

    await openAccountMenu("Dr. Elif");

    expect(await screen.findByRole("menuitem", { name: /Doktor Paneli/ })).toHaveAttribute("href", "/doctor");
    expect(screen.queryByRole("menuitem", { name: /Randevularım/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Siparişlerim/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Hesabım/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Çıkış Yap/ })).toBeInTheDocument();

    expect(screen.queryByLabelText("Favorilerim")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Sepet,/)).not.toBeInTheDocument();
  });

  it("hasta/normal oturum: 'Randevularım' var, 'Siparişlerim' var, 'Doktor Paneli' YOK", async () => {
    mockAuth = {
      status: "authenticated",
      user: { id: "u2", name: "Ayşe Yılmaz", doctorProfileId: null },
      logout: vi.fn(async () => {}),
    };
    renderHeader();

    await openAccountMenu("Ayşe Yılmaz");

    expect(await screen.findByRole("menuitem", { name: /Randevularım/ })).toHaveAttribute(
      "href",
      "/patient/bookings"
    );
    expect(screen.getByRole("menuitem", { name: /Siparişlerim/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Doktor Paneli/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Hesabım/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Çıkış Yap/ })).toBeInTheDocument();

    expect(screen.getByLabelText("Favorilerim")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Sepet,/)).toBeInTheDocument();
  });

  it("anonim ziyaretçi: 'Giriş Yap' linki görünür, hesap dropdown'ı YOK", () => {
    mockAuth = { status: "unauthenticated", user: null, logout: vi.fn(async () => {}) };
    renderHeader();

    expect(screen.getByRole("link", { name: "Giriş yap" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Doktor Paneli/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Randevularım/ })).not.toBeInTheDocument();
  });
});
