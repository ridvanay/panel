import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { packagesStrings } from "@/lib/i18n/site-dictionaries/en/packages";
import type { PackageDetailData } from "@/lib/api/types";

/**
 * Paket AH — paket sayfaları: satın alma yerine "Request this package" → `/request?package=<slug>`;
 * ilgili hekimler ziyaretçiye gösterilmez.
 */
vi.mock("@/components/site/contact/contact-cta", () => ({ ContactCta: () => <div data-testid="contact-cta" /> }));
vi.mock("@/components/site/packages/package-inquiry-form", () => ({
  PackageInquiryForm: () => <div data-testid="inquiry-form" />,
  focusPackageInquiryForm: () => {},
}));

import { PackageDetailActions } from "@/components/site/packages/package-detail-actions";
import { PackageDetailBody } from "@/components/site/packages/package-detail-body";

describe("Paket sayfası", () => {
  it("'Request this package' bağlantısı paketi seçili hâlde talep formuna götürür", () => {
    render(<PackageDetailActions slug="executive check-up" title="Executive Check-up" />);
    const link = screen.getByTestId("package-request-cta");
    expect(link).toHaveTextContent(packagesStrings.requestPackage);
    expect(link).toHaveAttribute("href", "/request?package=executive%20check-up");
    expect(screen.queryByText(/physician/i)).toBeNull();
  });

  it("ilgili hekimler listesi render edilmez", () => {
    const pkg = {
      id: "p1",
      slug: "check-up",
      title: "Check-up",
      category: "check-up",
      summary: "",
      includes: [],
      notIncluded: [],
      idealFor: "",
      faq: [],
      availableLocales: ["en"],
      relatedDoctors: [{ slug: "dr-a", name: "Prof. Dr. Ayse Demir", specialty: "Cardiology", avatarUrl: null }],
      relatedSpecialties: [],
    } as unknown as PackageDetailData;
    const { container } = render(<PackageDetailBody pkg={pkg} t={packagesStrings} intlLocale="en-US" localize={(p) => p} />);
    expect(container.textContent).not.toContain("Ayse Demir");
    expect(screen.queryByTestId("package-related-doctors")).toBeNull();
  });
});
