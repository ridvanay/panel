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
import { ContactFormClient, type ContactFormStrings } from "@/components/site/contact-form";

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

function makeForm(consentLegalPage: { title: string; slug: string } | null, overrides: Partial<PublicContactForm> = {}): PublicContactForm {
  return {
    locale: "tr",
    title: "İletişim",
    description: null,
    submitLabel: "Gönder",
    consentRequired: true,
    consentText: "",
    consentSentence: "Aydınlatma Metni'ni okudum, onaylıyorum.",
    privacyLinkLabel: "Aydınlatma Metni",
    consentLegalPage: consentLegalPage ? { ...consentLegalPage, localizedSlugs: {} } : null,
    fields: [],
    ...overrides,
  };
}

const STRINGS: ContactFormStrings = {
  required: "Bu alan zorunludur.",
  invalidEmail: "Geçerli bir e-posta adresi girin.",
  tooLong: "Çok uzun.",
  consentRequired: "Devam etmek için onay kutusunu işaretleyin.",
  selectPlaceholder: "Seçiniz",
  sending: "Gönderiliyor…",
};

describe("İletişim formu — Aydınlatma Metni linki", () => {
  beforeEach(() => {
    fetchLegalPagesClient.mockReset();
  });

  it("admin mesafeli sözleşmeyi seçmişse link KVKK aydınlatma sayfasına gider", async () => {
    fetchLegalPagesClient.mockResolvedValue([DISTANCE, ACIK_RIZA, KVKK]);
    render(<ContactFormClient form={makeForm({ title: DISTANCE.title, slug: DISTANCE.slug })} strings={STRINGS} />);
    const link = await screen.findByRole("link", { name: "Aydınlatma Metni" });
    expect(link).toHaveAttribute("href", "/kvkk-aydinlatma-metni-2");
  });

  it("admin KVKK sayfasını seçmişse o kullanılır (ek istek atılmaz)", () => {
    render(<ContactFormClient form={makeForm({ title: KVKK.title, slug: KVKK.slug })} strings={STRINGS} />);
    expect(screen.getByRole("link", { name: "Aydınlatma Metni" })).toHaveAttribute("href", "/kvkk-aydinlatma-metni-2");
    expect(fetchLegalPagesClient).not.toHaveBeenCalled();
  });

  it("KVKK sayfası bulunamazsa link gösterilmez (mesafeli sözleşmeye düşmez)", async () => {
    fetchLegalPagesClient.mockResolvedValue([DISTANCE, ACIK_RIZA]);
    render(<ContactFormClient form={makeForm({ title: DISTANCE.title, slug: DISTANCE.slug })} strings={STRINGS} />);
    await waitFor(() => expect(fetchLegalPagesClient).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Aydınlatma Metni" })).not.toBeInTheDocument();
    expect(screen.getByText(/ni okudum, onaylıyorum/)).toBeInTheDocument();
  });
});

describe("İletişim formu — dil (Paket U, B1)", () => {
  beforeEach(() => {
    fetchLegalPagesClient.mockReset();
  });

  it("sr-latn: onay cümlesi ve bağlantı etiketi sunucudan; bağlantı aktif dil önekiyle; Türkçe kalıntı yok", () => {
    const form = makeForm(
      { title: KVKK.title, slug: KVKK.slug },
      {
        locale: "sr-latn",
        title: "Kontaktirajte nas",
        submitLabel: "Pošalji",
        consentSentence: "Pročitao/la sam Obaveštenje o privatnosti i prihvatam ga.",
        privacyLinkLabel: "Obaveštenje o privatnosti",
      }
    );
    const { container } = render(<ContactFormClient form={form} strings={{ ...STRINGS, required: "Ovo polje je obavezno." }} lang="sr-latn" defaultLocaleCode="en" />);
    expect(screen.getByRole("link", { name: "Obaveštenje o privatnosti" })).toHaveAttribute("href", "/sr-latn/kvkk-aydinlatma-metni-2");
    expect(screen.getByRole("button", { name: "Pošalji" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/okudum|onaylıyorum|Aydınlatma Metni/);
  });

  it("yerelleştirilmiş yasal sayfa slug'ı varsa o dilin slug'ı kullanılır; varsayılan dilde önek yok", () => {
    const form = makeForm({ title: KVKK.title, slug: KVKK.slug });
    form.consentLegalPage!.localizedSlugs = { tr: "aydinlatma-metni" };
    const { unmount } = render(<ContactFormClient form={form} strings={STRINGS} lang="tr" defaultLocaleCode="en" />);
    expect(screen.getByRole("link", { name: "Aydınlatma Metni" })).toHaveAttribute("href", "/tr/aydinlatma-metni");
    unmount();
    render(<ContactFormClient form={{ ...form, locale: "en", consentSentence: "I have read and accept the Privacy Notice.", privacyLinkLabel: "Privacy Notice" }} strings={STRINGS} lang="en" defaultLocaleCode="en" />);
    expect(screen.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", "/kvkk-aydinlatma-metni-2");
  });
});
