import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DoctorPricePanel } from "@/components/site/telehealth/doctor-price-panel";
import { formatPriceFromCents } from "@/lib/format-price";

/**
 * `.claude/design-notes-telehealth.md` §2.1.4/§2.1.5 — sticky fiyat+CTA paneli + mobil alt çubuk.
 * `IntersectionObserver` `tests/setup.ts`'teki sessiz polyfill ile sağlanır (jsdom'da doğal
 * olarak YOK) — bu testler görünürlük GEÇİŞİNİ değil, ilk render sözleşmesini doğrular
 * (gözlemcinin tetiklenmesi qa-agent'ın e2e kapsamıdır).
 */
describe("DoctorPricePanel", () => {
  it("fiyatı `doctor.currency`'ye göre biçimlendirir ve seans süresini gösterir", () => {
    render(
      <DoctorPricePanel sessionPriceCents={45000} sessionDurationMin={30} currency="TRY" ctaHref="#randevu" />
    );
    expect(screen.getAllByText(formatPriceFromCents(45000, "TRY")).length).toBeGreaterThan(0);
    expect(screen.getByText("30 dakika görüşme")).toBeInTheDocument();
  });

  it("`intlLocale` verildiğinde `formatPriceFromCents`'e iletir (GBP + en-US)", () => {
    render(
      <DoctorPricePanel sessionPriceCents={500000} sessionDurationMin={45} currency="GBP" ctaHref="#randevu" intlLocale="en-US" />
    );
    expect(screen.getAllByText(formatPriceFromCents(500000, "GBP", "en-US")).length).toBeGreaterThan(0);
  });

  it("CTA `#randevu`'ya (sayfanın kendi slot takvimi) işaret eder, iki kez render edilir (masaüstü paneli + mobil çubuk)", () => {
    render(<DoctorPricePanel sessionPriceCents={45000} sessionDurationMin={30} currency="TRY" ctaHref="#randevu" />);
    // Mobil çubuk ilk render'da `aria-hidden="true"` taşır (§2.1.5 — panel henüz viewport'tan
    // çıkmadı) — `hidden: true` OLMADAN `getAllByRole` yalnızca masaüstü panelini bulurdu.
    const links = screen.getAllByRole("link", { name: "Randevu Al", hidden: true });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "#randevu");
  });

  it("mobil alt çubuk ilk render'da gizli kabul edilir (`aria-hidden=\"true\"`, panel henüz viewport'tan çıkmadı)", () => {
    const { container } = render(
      <DoctorPricePanel sessionPriceCents={45000} sessionDurationMin={30} currency="TRY" ctaHref="#randevu" />
    );
    const bar = container.querySelector('[aria-hidden="true"]');
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain("translate-y-full");
  });
});
