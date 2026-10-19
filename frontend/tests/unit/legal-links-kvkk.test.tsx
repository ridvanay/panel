import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { PublicContactForm, SitePage } from "@/lib/api/types";

/**
 * Paket J (2026-10-19) — "Aydınlatma Metni" linkleri yalnızca KVKK aydınlatma sayfasına gider.
 *  - `resolveKvkkNoticePage` (canlı destek, checkout) artık ilk yasal belgeye (ör. mesafeli hizmet
 *    sözleşmesi) DÜŞMEZ; önce KVKK/aydınlatma (TR+EN), sonra gizlilik aranır, yoksa `null`.
 *  - İletişim formu: admin'in seçtiği sayfa KVKK değilse yayınlanmış yasal sayfalardan sıkı
 *    çözümleme yapılır; bulunamazsa link gösterilmez.
 */
const fetchLegalPagesClient = vi.fn<(locale?: string) => Promise<SitePage[]>>();
vi.mock("@/lib/legal-pages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal-pages")>();
  return { ...actual, fetchLegalPagesClient: (locale?: string) => fetchLegalPagesClient(locale) };
});
vi.mock("@/lib/api/contact", () => ({ submitContactForm: vi.fn() }));

import { resolveKvkkNoticePage } from "@/lib/legal-pages";
import { ContactFormClient } from "@/components/site/contact-form";

function page(slug: string, title: string, isLegalDocument = true): SitePage {
  return { id: slug, slug, title, isLegalDocument, status: "PUBLISHED" } as unknown as SitePage;
}

const DISTANCE = page("distance-service-agreement", "Distance Service Agreement");
const KVKK = page("kvkk-aydinlatma-metni-2", "KVKK Aydınlatma Metni");
const PRIVACY_EN = page("privacy-notice", "Privacy Notice");
const GIZLILIK = page("gizlilik-politikasi", "Gizlilik Politikası");
const ACIK_RIZA = page("acik-riza-metni-2", "Açık Rıza Metni");

describe("resolveKvkkNoticePage", () => {
  it("mesafeli sözleşme listede önde olsa bile KVKK sayfasını seçer", () => {
    expect(resolveKvkkNoticePage([DISTANCE, ACIK_RIZA, KVKK])).toEqual(KVKK);
  });

  it("KVKK sayfası yoksa ilk yasal belgeye DÜŞMEZ → null", () => {
    expect(resolveKvkkNoticePage([DISTANCE, ACIK_RIZA])).toBeNull();
  });

  it("EN başlıklı aydınlatma sayfasını bulur; KVKK/aydınlatma gizlilikten önce gelir", () => {
    expect(resolveKvkkNoticePage([DISTANCE, PRIVACY_EN])).toEqual(PRIVACY_EN);
    expect(resolveKvkkNoticePage([GIZLILIK, KVKK])).toEqual(KVKK);
    expect(resolveKvkkNoticePage([DISTANCE, GIZLILIK])).toEqual(GIZLILIK);
  });

  it("yasal belge olarak işaretlenmemiş sayfa seçilmez", () => {
    expect(resolveKvkkNoticePage([page("kvkk-blog-yazisi", "KVKK hakkında", false)])).toBeNull();
  });
});

function makeForm(consentLegalPage: PublicContactForm["consentLegalPage"]): PublicContactForm {
  return { title: "İletişim", description: null, submitLabel: "Gönder", consentRequired: true, consentText: "", consentLegalPage, fields: [] };
}

describe("İletişim formu — Aydınlatma Metni linki", () => {
  beforeEach(() => {
    fetchLegalPagesClient.mockReset();
  });

  it("admin mesafeli sözleşmeyi seçmişse link KVKK aydınlatma sayfasına gider", async () => {
    fetchLegalPagesClient.mockResolvedValue([DISTANCE, ACIK_RIZA, KVKK]);
    render(<ContactFormClient form={makeForm({ title: DISTANCE.title, slug: DISTANCE.slug })} />);
    const link = await screen.findByRole("link", { name: "Aydınlatma Metni" });
    expect(link).toHaveAttribute("href", "/kvkk-aydinlatma-metni-2");
  });

  it("admin KVKK sayfasını seçmişse o kullanılır (ek istek atılmaz)", () => {
    render(<ContactFormClient form={makeForm({ title: KVKK.title, slug: KVKK.slug })} />);
    expect(screen.getByRole("link", { name: "Aydınlatma Metni" })).toHaveAttribute("href", "/kvkk-aydinlatma-metni-2");
    expect(fetchLegalPagesClient).not.toHaveBeenCalled();
  });

  it("KVKK sayfası bulunamazsa link gösterilmez (mesafeli sözleşmeye düşmez)", async () => {
    fetchLegalPagesClient.mockResolvedValue([DISTANCE, ACIK_RIZA]);
    render(<ContactFormClient form={makeForm({ title: DISTANCE.title, slug: DISTANCE.slug })} />);
    await waitFor(() => expect(fetchLegalPagesClient).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Aydınlatma Metni" })).not.toBeInTheDocument();
    expect(screen.getByText(/ni okudum, onaylıyorum/)).toBeInTheDocument();
  });
});
