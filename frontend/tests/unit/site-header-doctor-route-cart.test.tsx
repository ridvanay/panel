import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "@/components/site/site-header";
import type { SiteSettings } from "@/lib/api/types";

/**
 * Görev tanımı madde 4 — doktor DETAY sayfasında (`/doctors/[slug]`) sepet ikonu GİZLENİR,
 * ama `/doctors` ızgarası ve `/products/*` (ürün satan diğer şablon sayfaları) ETKİLENMEZ.
 * `site-header-sticky-active.test.tsx` ile AYNI `usePathname` mock deseni.
 */
const usePathnameMock = vi.fn<() => string>();
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
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

beforeEach(() => {
  usePathnameMock.mockReset();
});

function renderHeader(pathname: string) {
  usePathnameMock.mockReturnValue(pathname);
  return render(<SiteHeader settings={settings} pages={[]} productsModuleEnabled />);
}

describe("SiteHeader — doktor detay sayfasında sepet ikonu istisnası", () => {
  it("prefix'siz doktor detay yolunda (`/doctors/dr-elif-aydemir`) sepet ikonu YOK", () => {
    renderHeader("/doctors/dr-elif-aydemir");
    expect(screen.queryByLabelText(/^Sepet,/)).not.toBeInTheDocument();
  });

  it("locale prefix'li doktor detay yolunda (`/en/doctors/dr-elif-aydemir`) sepet ikonu YOK", () => {
    renderHeader("/en/doctors/dr-elif-aydemir");
    expect(screen.queryByLabelText(/^Sepet,/)).not.toBeInTheDocument();
  });

  it("doktor IZGARASINDA (`/doctors`, ekstra segment YOK) sepet ikonu HÂLÂ görünür", () => {
    renderHeader("/doctors");
    expect(screen.getByLabelText(/^Sepet,/)).toBeInTheDocument();
  });

  it("locale prefix'li doktor ızgarasında (`/en/doctors`) sepet ikonu HÂLÂ görünür", () => {
    renderHeader("/en/doctors");
    expect(screen.getByLabelText(/^Sepet,/)).toBeInTheDocument();
  });

  it("ürün detay sayfası (`/products/bir-urun`) ETKİLENMEZ — sepet ikonu normal görünür", () => {
    renderHeader("/products/bir-urun");
    expect(screen.getByLabelText(/^Sepet,/)).toBeInTheDocument();
  });

  it("site kökü (`/`) ETKİLENMEZ — sepet ikonu normal görünür", () => {
    renderHeader("/");
    expect(screen.getByLabelText(/^Sepet,/)).toBeInTheDocument();
  });
});
