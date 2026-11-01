import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LOCALES, makeDetail } from "./blog-z1-fixtures";

const mocks = vi.hoisted(() => ({ detail: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/api/server-blog", () => ({ fetchBlogDetailServer: (...a: unknown[]) => mocks.detail(...a) }));
vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: async () => (await import("./blog-z1-fixtures")).LOCALES }));
vi.mock("@/lib/api/server-settings", () => ({ fetchSiteSettingsServer: async () => ({ siteName: "WM Health" }) }));
vi.mock("@/components/site/sync-locale-alternates", () => ({ SyncLocaleAlternates: () => null }));
vi.mock("@/components/site/view-tracker", () => ({ ViewTracker: () => null }));

import { BlogPostPage, buildBlogPostMetadata } from "@/components/site/blog/blog-post-page";
import { BlogShareButtons } from "@/components/site/blog/blog-share-buttons";
import { BlogFaq } from "@/components/site/blog/blog-faq";

async function renderPost(lang = "en", slug = "knee-pain-guide") {
  return render(await BlogPostPage({ lang, slug }));
}

beforeEach(() => {
  mocks.detail.mockReset().mockResolvedValue(makeDetail());
});

describe("Paket Z1 — yazı sayfası", () => {
  it("taslak / silinmiş / çevirisiz dil: 404 ve boş meta", async () => {
    mocks.detail.mockResolvedValue(null);
    await expect(BlogPostPage({ lang: "de", slug: "knee-pain-guide" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await buildBlogPostMetadata({ lang: "de", slug: "knee-pain-guide" })).toEqual({});
    expect(mocks.detail).toHaveBeenCalledWith("knee-pain-guide", "de");
  });

  it("sırasıyla breadcrumb, kategori, H1, yazar + hekim, Last reviewed, okuma süresi", async () => {
    await renderPost();
    const crumb = screen.getByTestId("blog-breadcrumb");
    expect(within(crumb).getByRole("link", { name: "Health Guides" })).toHaveAttribute("href", "/blog");
    expect(within(crumb).getByText("Knee pain guide")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "Knee pain guide" })).toBeInTheDocument();
    const byline = screen.getByTestId("blog-byline");
    expect(within(byline).getByText("WM Health Editorial Team")).toBeInTheDocument();
    const reviewer = within(screen.getByTestId("blog-byline-reviewer")).getByRole("link");
    expect(reviewer).toHaveTextContent("Prof. Dr. H. Sofu");
    expect(reviewer).toHaveAttribute("href", "/physicians/hakan-sofu");
    expect(screen.getByTestId("blog-last-reviewed")).toHaveTextContent("Last reviewed: October 20, 2026");
    expect(within(byline).getByText("6 min read")).toBeInTheDocument();
    const order = [crumb, screen.getByRole("heading", { level: 1 }), byline].map((el) => el);
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("onaylı hekim yoksa hekim satırı çizilmez; Last reviewed tarihi yoksa gizlenir", async () => {
    mocks.detail.mockResolvedValue(makeDetail({ reviewer: null, lastReviewedAt: null }));
    await renderPost();
    expect(screen.queryByTestId("blog-byline-reviewer")).toBeNull();
    expect(screen.queryByTestId("blog-last-reviewed")).toBeNull();
  });

  it("içindekiler: H2/H3 listesi hem yan sütunda hem mobil kutuda; başlıklara id eklenir", async () => {
    const { container } = await renderPost();
    const sidebar = screen.getByTestId("blog-toc");
    expect(within(sidebar).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#causes", "#wear", "#treatment", "#when-to-call"]);
    expect(within(screen.getByTestId("blog-toc-mobile")).getAllByRole("link")).toHaveLength(4);
    expect(container.querySelector("h2#causes")).not.toBeNull();
    expect(container.querySelector("h3#wear")).not.toBeNull();
    // gövde tipografisi kapsamlı .blog-prose kurallarıyla (typography eklentisi yok)
    expect(container.querySelector(".blog-prose h2#causes")).not.toBeNull();
  });

  it("Key takeaways düz metin olarak render edilir (HTML çalıştırılmaz)", async () => {
    mocks.detail.mockResolvedValue(makeDetail({ keyTakeaways: ["<b>bold</b> <img src=x onerror=alert(1)>"] }));
    const { container } = await renderPost();
    const box = screen.getByTestId("blog-key-takeaways");
    expect(within(box).getByRole("heading", { name: "Key takeaways" })).toBeInTheDocument();
    expect(box).toHaveTextContent("<b>bold</b> <img src=x onerror=alert(1)>");
    expect(box.querySelector("b, img")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
  });

  it("Consult a physician kartı ortada ve sonda; 2 hekim ve Book → profil #randevu", async () => {
    const { container } = await renderPost();
    const cards = screen.getAllByTestId("blog-consult-card");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const book = within(card).getAllByRole("link", { name: /Book an appointment with/ });
      expect(book.map((a) => a.getAttribute("href"))).toEqual(["/physicians/hakan-sofu#randevu", "/physicians/ayse-demir#randevu"]);
      expect(within(card).getAllByText("Book")).toHaveLength(2);
    }
    // ilk kart içeriğin ortasında (3 H2: ikinci başlıktan önce), ikincisi en sonda
    const treatment = container.querySelector("h2#treatment")!;
    expect(cards[0]!.compareDocumentPosition(treatment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(treatment.compareDocumentPosition(cards[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("danışılacak hekim yoksa kartlar çizilmez", async () => {
    mocks.detail.mockResolvedValue(makeDetail({ consultDoctors: [] }));
    await renderPost();
    expect(screen.queryByTestId("blog-consult-card")).toBeNull();
  });

  it("FAQ akordeonu: aria-expanded / aria-controls, tıklayınca açılır, cevap düz metin", async () => {
    const user = userEvent.setup();
    mocks.detail.mockResolvedValue(makeDetail({ faq: [{ question: "Is surgery needed?", answer: "Rarely. <i>x</i>" }] }));
    await renderPost();
    const button = screen.getByRole("button", { name: "Is surgery needed?" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel).toHaveAttribute("hidden");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel).toHaveAttribute("role", "region");
    expect(panel).toHaveTextContent("Rarely. <i>x</i>");
    expect(panel.querySelector("i")).toBeNull();
  });

  it("SSS yoksa akordeon çizilmez", () => {
    const { container } = render(<BlogFaq items={[]} title="FAQ" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("References: dış bağlantı rel=noopener noreferrer nofollow, yeni sekme; https dışı bağlanmaz", async () => {
    mocks.detail.mockResolvedValue(
      makeDetail({
        references: [
          { title: "Knee guideline", publisher: "Society", url: "https://example.org/guide", accessedAt: "2026-09-30" },
          { title: "Bad link", publisher: "X", url: "javascript:alert(1)", accessedAt: "2026-09-30" },
        ],
      })
    );
    await renderPost();
    const refs = screen.getByTestId("blog-references");
    const link = within(refs).getByRole("link", { name: /Knee guideline/ });
    expect(link).toHaveAttribute("href", "https://example.org/guide");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(link).toHaveAttribute("target", "_blank");
    expect(refs).toHaveTextContent("Accessed September 30, 2026");
    expect(within(refs).queryByRole("link", { name: /Bad link/ })).toBeNull();
    expect(within(refs).getByText("Bad link")).toBeInTheDocument();
  });

  it("sabit uyarı, ilgili yazılar ve paylaşım bölümü", async () => {
    await renderPost();
    expect(screen.getByTestId("blog-disclaimer")).toHaveTextContent("This article is for general information and is not a substitute for a medical consultation.");
    const related = screen.getByTestId("blog-related");
    expect(within(related).getByRole("link", { name: "Hip guide" })).toHaveAttribute("href", "/blog/hip-guide");
    expect(screen.getByTestId("blog-share")).toBeInTheDocument();
  });

  it("JSON-LD: MedicalWebPage + Article ve (SSS varken) FAQPage script'leri", async () => {
    const { container } = await renderPost();
    const scripts = [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!));
    expect(scripts).toHaveLength(2);
    expect(scripts[0]["@type"]).toEqual(["MedicalWebPage", "Article"]);
    expect(scripts[0].reviewedBy["@type"]).toBe("Physician");
    expect(scripts[0].lastReviewed).toBe("2026-10-20T10:00:00.000Z");
    expect(scripts[1]["@type"]).toBe("FAQPage");
  });

  it("JSON-LD: SSS yoksa FAQPage yok", async () => {
    mocks.detail.mockResolvedValue(makeDetail({ faq: [] }));
    const { container } = await renderPost();
    expect(container.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
  });

  it("RTL: Arapça yazı dir=rtl ve Arapça etiketler", async () => {
    await renderPost("ar");
    expect(screen.getByTestId("blog-post")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { name: "أهم النقاط" })).toBeInTheDocument();
    expect(screen.getByTestId("blog-disclaimer")).toHaveTextContent("هذا المقال للمعلومات العامة");
  });

  it("dilin kendi slug'ı farklıysa kalıcı yönlendirme (kopya içerik yok)", async () => {
    await expect(BlogPostPage({ lang: "tr", slug: "knee-pain-guide" })).rejects.toThrow("NEXT_REDIRECT:/tr/blog/diz-agrisi-rehberi");
  });
});

describe("Paket Z1 — yazı meta verisi", () => {
  it("hreflang yalnızca çevirisi olan diller (+x-default); ar yok", async () => {
    const meta = await buildBlogPostMetadata({ lang: "en", slug: "knee-pain-guide" });
    const languages = meta.alternates!.languages as Record<string, string>;
    expect(Object.keys(languages).sort()).toEqual(["en", "tr", "x-default"]);
    expect(languages.tr).toMatch(/\/tr\/blog\/diz-agrisi-rehberi$/);
    expect(String(meta.alternates!.canonical)).toMatch(/\/blog\/knee-pain-guide$/);
    expect(LOCALES.map((l) => l.code)).toContain("ar");
  });

  it("OG görseli önce JPEG uyumluluk kopyası, sonra ogImageUrl, sonra kapak", async () => {
    mocks.detail.mockResolvedValue(makeDetail({ coverCompatUrl: "https://cdn.example/uploads/a.jpg", ogImageUrl: "https://cdn.example/og.png", coverUrl: "https://cdn.example/uploads/a.webp" }));
    const compat = await buildBlogPostMetadata({ lang: "en", slug: "knee-pain-guide" });
    expect(JSON.stringify(compat.openGraph)).toContain("https://cdn.example/uploads/a.jpg");
    mocks.detail.mockResolvedValue(makeDetail({ coverCompatUrl: null, ogImageUrl: "https://cdn.example/og.png", coverUrl: "https://cdn.example/uploads/a.webp" }));
    const og = await buildBlogPostMetadata({ lang: "en", slug: "knee-pain-guide" });
    expect(JSON.stringify(og.openGraph)).toContain("https://cdn.example/og.png");
    mocks.detail.mockResolvedValue(makeDetail({ coverCompatUrl: null, ogImageUrl: null, coverUrl: "https://cdn.example/uploads/a.png" }));
    const cover = await buildBlogPostMetadata({ lang: "en", slug: "knee-pain-guide" });
    expect(JSON.stringify(cover.openGraph)).toContain("https://cdn.example/uploads/a.png");
  });

  it("noIndex yazı robots noindex", async () => {
    mocks.detail.mockResolvedValue(makeDetail({ noIndex: true }));
    expect((await buildBlogPostMetadata({ lang: "en", slug: "knee-pain-guide" })).robots).toEqual({ index: false, follow: false });
  });
});

describe("Paket Z1 — paylaşım düğmeleri", () => {
  const labels = { heading: "Share this article", copy: "Copy link", copied: "Link copied", whatsapp: "Share on WhatsApp", email: "Share by email" };

  it("WhatsApp wa.me, e-posta mailto:; üçüncü taraf script/iframe yok", () => {
    const { container } = render(<BlogShareButtons url="https://wm.example/blog/a b" title="Knee & hip" labels={labels} />);
    const wa = screen.getByRole("link", { name: "Share on WhatsApp" });
    expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(wa.getAttribute("href")!)).toContain("Knee & hip https://wm.example/blog/a b");
    expect(wa).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "Share by email" }).getAttribute("href")).toMatch(/^mailto:\?subject=Knee%20%26%20hip&body=/);
    expect(container.querySelector("script, iframe, img")).toBeNull();
  });

  it("bağlantıyı kopyala panoya yazar ve durumu duyurur", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<BlogShareButtons url="https://wm.example/blog/a" title="A" labels={labels} />);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://wm.example/blog/a");
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
  });
});
