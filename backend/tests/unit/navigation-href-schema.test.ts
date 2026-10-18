import { describe, expect, it } from "vitest";
import { FooterLinkInputSchema, NavigationItemInputSchema } from "../../src/modules/navigation/navigation.schemas";

/**
 * Paket A2 (2026-10-18) — canlıda `GET /pages/Distance%20Service%20Agreement` 404'ü: footer/menü
 * bağlantısına slug yerine sayfa başlığı yazılmıştı. Site içi yol yalnızca küçük harf, rakam ve `-`
 * (dosya yolları için `.`/`_`) içerebilir.
 */
function footerHrefValid(href: string): boolean {
  return FooterLinkInputSchema.safeParse({ label: "Bağlantı", href, order: 0 }).success;
}

describe("navigation href doğrulaması", () => {
  it.each(["/", "/kullanim-kosullari", "/terms-of-use", "/doctors?specialty=Kardiyoloji", "/#nasil-calisir", "/uploads/brosur_2026.pdf", "/blog/yazi-1"])(
    "geçerli iç yol kabul edilir: %s",
    (href) => {
      expect(footerHrefValid(href)).toBe(true);
    }
  );

  it.each(["/Distance Service Agreement", "/Kullanim-Kosullari", "/kullanım-koşulları", "/mesafeli%20hizmet"])("geçersiz iç yol reddedilir: %s", (href) => {
    expect(footerHrefValid(href)).toBe(false);
  });

  it("dış bağlantılar ve fragment'lar etkilenmez", () => {
    expect(footerHrefValid("https://example.com/Some Page")).toBe(true);
    expect(footerHrefValid("#İletişim")).toBe(true);
  });

  it("menü öğelerinde de aynı kural uygulanır", () => {
    expect(NavigationItemInputSchema.safeParse({ label: "x", href: "/Hakkımızda", order: 0 }).success).toBe(false);
    expect(NavigationItemInputSchema.safeParse({ label: "x", href: "/hakkimizda", order: 0 }).success).toBe(true);
  });
});
