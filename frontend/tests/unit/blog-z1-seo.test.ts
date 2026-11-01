import { describe, expect, it } from "vitest";
import { buildBlogJsonLd, blogJsonLdStrings, BLOG_AUTHOR_NAME } from "@/lib/blog/json-ld";
import { buildSection, type SitemapData } from "@/lib/sitemap/build";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { LOCALES, makeDetail } from "./blog-z1-fixtures";

const input = (post = makeDetail()) => ({
  post,
  url: "https://wm.example/blog/knee-pain-guide",
  siteUrl: "https://wm.example",
  siteName: "WM Health",
  physicianUrl: (slug: string) => `https://wm.example/physicians/${slug}`,
  imageUrl: "https://wm.example/uploads/x.jpg",
  inLanguage: "en",
});

describe("Paket Z1 — JSON-LD", () => {
  it("MedicalWebPage + Article: reviewedBy Physician, lastReviewed, author Organization, about MedicalSpecialty", () => {
    const [main] = buildBlogJsonLd(input());
    expect(main!["@type"]).toEqual(["MedicalWebPage", "Article"]);
    expect(main!.lastReviewed).toBe("2026-10-20T10:00:00.000Z");
    expect(main!.reviewedBy).toMatchObject({ "@type": "Physician", name: "Prof. Dr. H. Sofu", url: "https://wm.example/physicians/hakan-sofu" });
    expect(main!.author).toMatchObject({ "@type": "Organization", name: BLOG_AUTHOR_NAME });
    expect(main!.about).toEqual({ "@type": "MedicalSpecialty", name: "Orthopaedics" });
    expect(main!.datePublished).toBe("2026-10-01T10:00:00.000Z");
    expect(main!.dateModified).toBe("2026-10-20T10:00:00.000Z");
    expect(main!.image).toEqual(["https://wm.example/uploads/x.jpg"]);
  });

  it("FAQPage yalnızca SSS varken üretilir", () => {
    const withFaq = buildBlogJsonLd(input());
    expect(withFaq.map((o) => o["@type"])).toEqual([["MedicalWebPage", "Article"], "FAQPage"]);
    expect(withFaq[1]).toMatchObject({ mainEntity: [{ "@type": "Question", name: "Is surgery needed?", acceptedAnswer: { "@type": "Answer", text: "Rarely." } }] });
    const withoutFaq = buildBlogJsonLd(input(makeDetail({ faq: [] })));
    expect(withoutFaq).toHaveLength(1);
  });

  it("hekim onayı/uzmanlık/tarih yoksa ilgili alanlar hiç yazılmaz", () => {
    const [main] = buildBlogJsonLd(input(makeDetail({ reviewer: null, lastReviewedAt: null, specialty: null })));
    expect(main).not.toHaveProperty("reviewedBy");
    expect(main).not.toHaveProperty("lastReviewed");
    expect(main).not.toHaveProperty("about");
    expect(main!.dateModified).toBe("2026-10-25T10:00:00.000Z");
  });

  it("</script> kaçışı uygulanır", () => {
    const [json] = blogJsonLdStrings(input(makeDetail({ title: "A </script><b>x" })));
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json!).headline).toBe("A </script><b>x");
  });
});

const DATA: SitemapData = {
  siteUrl: "https://wm.example",
  locales: LOCALES,
  homePageId: null,
  pages: [],
  doctors: [],
  specialties: [],
  posts: [
    {
      slug: "knee-pain-guide",
      title: "Knee pain guide",
      excerpt: "What to know about knee pain. Call +90 555 111 22 33 now.",
      publishedAt: "2026-10-01T00:00:00.000Z",
      lastReviewedAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-25T00:00:00.000Z",
      localizations: [
        { locale: "en", slug: "knee-pain-guide", translated: true },
        { locale: "tr", slug: "diz-agrisi-rehberi", translated: true },
        { locale: "ar", slug: "knee-pain-guide", translated: false },
      ],
    },
    { slug: "no-review", title: "No review date", publishedAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z", localizations: [] },
  ],
  products: [],
  portfolio: [],
};

describe("Paket Z1 — sitemap ve llms.txt", () => {
  it("blog lastmod = lastReviewedAt ?? updatedAt; yalnızca çevirisi olan diller girer", () => {
    const entries = buildSection("blog", DATA);
    const knee = entries.filter((e) => e.loc.includes("knee-pain-guide") || e.loc.includes("diz-agrisi"));
    expect(knee.map((e) => e.loc).sort()).toEqual(["https://wm.example/blog/knee-pain-guide", "https://wm.example/tr/blog/diz-agrisi-rehberi"]);
    expect(knee.every((e) => e.lastmod === "2026-10-20T00:00:00.000Z")).toBe(true);
    expect(entries.some((e) => e.loc.startsWith("https://wm.example/ar/blog/knee"))).toBe(false);
    const alt = knee[0]!.alternates!.map((a) => a.hreflang).sort();
    expect(alt).toEqual(["en", "tr", "x-default"]);
    const noReview = entries.find((e) => e.loc.endsWith("/blog/no-review"));
    expect(noReview!.lastmod).toBe("2026-09-05T00:00:00.000Z");
  });

  it("llms.txt blog bölümü yazıları listeler; iletişim/telefon cümlesi ayıklanır; yazı yoksa bölüm yok", () => {
    const text = buildLlmsTxt({ ...DATA, siteName: "WM Health" });
    expect(text).toContain("## Health guides");
    expect(text).toContain("[Knee pain guide](https://wm.example/blog/knee-pain-guide): What to know about knee pain.");
    expect(text).not.toContain("+90 555");
    expect(buildLlmsTxt({ ...DATA, posts: [], siteName: "WM Health" })).not.toContain("## Health guides");
  });
});
