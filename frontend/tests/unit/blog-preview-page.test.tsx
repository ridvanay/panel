import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PublicBlogPreviewDetail } from "@/lib/api/types";
import { makeDetail } from "./blog-z1-fixtures";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), detail: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/api/server-blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/server-blog")>()),
  fetchBlogPreviewServer: (...a: unknown[]) => mocks.preview(...a),
  fetchBlogDetailServer: (...a: unknown[]) => mocks.detail(...a),
}));
vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: async () => (await import("./blog-z1-fixtures")).LOCALES }));
vi.mock("@/lib/api/server-settings", () => ({ fetchSiteSettingsServer: async () => ({ siteName: "WM Health" }) }));
vi.mock("@/components/site/sync-locale-alternates", () => ({ SyncLocaleAlternates: () => <span data-testid="sync-alternates" /> }));
vi.mock("@/components/site/view-tracker", () => ({ ViewTracker: () => <span data-testid="view-tracker" /> }));

import BlogPreviewRoute, { generateMetadata } from "@/app/[lang]/(site)/blog/preview/[postId]/page";
import { BlogPostPage } from "@/components/site/blog/blog-post-page";
import { fetchBlogPreviewServer } from "@/lib/api/server-blog";

function makePreview(over: Partial<PublicBlogPreviewDetail> = {}): PublicBlogPreviewDetail {
  return {
    ...makeDetail({ reviewer: null, lastReviewedAt: null }),
    preview: true,
    pendingReviewer: { name: "H. Sofu", title: "Prof. Dr.", slug: "hakan-sofu", avatarUrl: null },
    reviewApproved: false,
    status: "DRAFT",
    ...over,
  };
}

function props(lang = "en", postId = "p1", t?: string | string[]) {
  return { params: Promise.resolve({ lang, postId }), searchParams: Promise.resolve(t === undefined ? {} : { t }) };
}

async function renderPreview(lang = "en", over: Partial<PublicBlogPreviewDetail> = {}) {
  mocks.preview.mockResolvedValue(makePreview(over));
  return render(await BlogPreviewRoute(props(lang, "p1", "p_token")));
}

beforeEach(() => {
  mocks.preview.mockReset().mockResolvedValue(makePreview());
  mocks.detail.mockReset().mockResolvedValue(makeDetail());
});

describe("Taslak önizleme sayfası — erişim", () => {
  it("belirteç yoksa notFound ve backend çağrılmaz", async () => {
    await expect(BlogPreviewRoute(props("en", "p1"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(BlogPreviewRoute(props("en", "p1", "  "))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("backend 404 (geçersiz/süresi dolmuş/iptal) dönerse notFound", async () => {
    mocks.preview.mockResolvedValue(null);
    await expect(BlogPreviewRoute(props("en", "p1", "s_bad"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.preview).toHaveBeenCalledWith("p1", "s_bad", "en");
  });

  it("dizi olarak gelen ?t ilk değerle okunur", async () => {
    await BlogPreviewRoute(props("en", "p1", ["p_first", "p_second"]));
    expect(mocks.preview).toHaveBeenCalledWith("p1", "p_first", "en");
  });
});

describe("Taslak önizleme sayfası — meta", () => {
  it("noindex + nofollow; canonical ve alternates YOK; Referer sızmaz", async () => {
    const meta = await generateMetadata(props("en", "p1", "p_token"));
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta).not.toHaveProperty("alternates");
    expect(meta.alternates?.canonical).toBeUndefined();
    expect(meta.referrer).toBe("no-referrer");
    expect(meta.title).toBe("Knee pain guide");
  });

  it("geçersiz belirteçte de noindex döner (başlık yok)", async () => {
    mocks.preview.mockResolvedValue(null);
    const meta = await generateMetadata(props("en", "p1", "bad"));
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBeUndefined();
  });
});

describe("Taslak önizleme sayfası — görünüm", () => {
  it("yayınlanmamış taslakta şerit 'yayın bekliyor' der (hekim onayı ifadesi yok)", async () => {
    await renderPreview();
    expect(screen.getByTestId("blog-preview-banner")).toHaveTextContent("Preview — awaiting publication");
    expect(screen.getByTestId("blog-preview-banner")).not.toHaveTextContent(/physician/i);
    expect(screen.getByRole("status")).toBe(screen.getByTestId("blog-preview-banner"));
  });

  it("hekim onayı bayrağı şeridi değiştirmez (Paket AH: yalnızca yayın durumuna bakılır)", async () => {
    await renderPreview("en", { reviewApproved: true });
    expect(screen.getByTestId("blog-preview-banner")).toHaveTextContent("Preview — awaiting publication");
  });

  it("yayındaki yazıda şerit yalnızca 'Preview'; 'awaiting' yok; hekim satırı hiç yok", async () => {
    const reviewer = { name: "H. Sofu", title: "Prof. Dr.", slug: "hakan-sofu", avatarUrl: null, specialty: null };
    const { container } = await renderPreview("en", { status: "PUBLISHED", reviewApproved: true, pendingReviewer: null, reviewer, lastReviewedAt: "2026-10-01T10:00:00.000Z" });
    const banner = screen.getByTestId("blog-preview-banner");
    expect(banner).toHaveTextContent(/^Preview$/);
    expect(banner).not.toHaveTextContent(/awaiting/);
    expect(screen.queryByText("Medically reviewed by")).toBeNull();
    expect(screen.queryByTestId("blog-byline-reviewer")).toBeNull();
    expect(screen.queryByTestId("blog-last-reviewed")).toBeNull();
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(screen.queryByTestId("blog-share")).toBeNull();
  });

  it("onaylı ama SCHEDULED yazıda şerit 'yayın bekliyor' kalır", async () => {
    await renderPreview("en", { status: "SCHEDULED", reviewApproved: true });
    expect(screen.getByTestId("blog-preview-banner")).toHaveTextContent("Preview — awaiting publication");
  });

  it("previewBannerLive 9 dilde tanımlı", async () => {
    const expected: Record<string, string> = { en: "Preview", tr: "Önizleme", de: "Vorschau", ar: "معاينة", ru: "Предпросмотр", es: "Vista previa", fr: "Aperçu", ro: "Previzualizare", "sr-latn": "Pregled" };
    for (const [lang, text] of Object.entries(expected)) {
      const mod = (await import(`@/lib/i18n/site-dictionaries/${lang}/blog`)) as Record<string, Record<string, string>>;
      const dict = Object.values(mod).find((v) => v && typeof v === "object" && "previewBannerPending" in v)!;
      expect(dict.previewBannerLive).toBe(text);
    }
  });

  it("ziyaretçi görünümünde 'Medically reviewed by' ve 'Review pending' yok; yazar 'WM Health Editorial Team'", async () => {
    await renderPreview();
    expect(screen.queryByText("Medically reviewed by")).toBeNull();
    expect(screen.queryByTestId("blog-byline-reviewer")).toBeNull();
    expect(screen.queryByTestId("blog-byline-pending-reviewer")).toBeNull();
    expect(screen.queryByText(/Review pending/)).toBeNull();
    expect(screen.queryByText(/H\. Sofu/)).toBeNull();
    expect(screen.getByTestId("blog-byline")).toHaveTextContent("WM Health Editorial Team");
  });

  it("JSON-LD script'i basılmaz (yayındaki sayfada basılır)", async () => {
    const { container, unmount } = await renderPreview();
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(container.innerHTML).not.toContain("reviewedBy");
    unmount();
    const published = render(await BlogPostPage({ lang: "en", slug: "knee-pain-guide" }));
    expect(published.container.querySelector('script[type="application/ld+json"]')).not.toBeNull();
  });

  it("paylaşım düğmeleri, görüntülenme sayacı ve dil-alternatifi senkronu yok", async () => {
    await renderPreview();
    expect(screen.queryByTestId("blog-share")).toBeNull();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(screen.queryByTestId("sync-alternates")).toBeNull();
  });

  it("yayındaki sayfanın gövdesi aynı: başlık, içindekiler, Key takeaways, SSS, uyarı", async () => {
    await renderPreview();
    expect(screen.getByRole("heading", { level: 1, name: "Knee pain guide" })).toBeInTheDocument();
    expect(screen.getByTestId("blog-toc")).toBeInTheDocument();
    expect(screen.getByTestId("blog-key-takeaways")).toBeInTheDocument();
    expect(screen.getByTestId("blog-disclaimer")).toBeInTheDocument();
  });

  it("yayındaki sayfada şerit ve hekim satırı çıkmaz (regresyon)", async () => {
    render(await BlogPostPage({ lang: "en", slug: "knee-pain-guide" }));
    expect(screen.queryByTestId("blog-preview-banner")).toBeNull();
    expect(screen.queryByTestId("blog-byline-pending-reviewer")).toBeNull();
    expect(screen.queryByTestId("blog-byline-reviewer")).toBeNull();
    expect(within(screen.getByTestId("blog-byline")).queryAllByRole("link")).toHaveLength(0);
  });

  it("RTL (ar): sayfa dir=rtl ve şerit Arapça", async () => {
    await renderPreview("ar");
    expect(screen.getByTestId("blog-post")).toHaveAttribute("dir", "rtl");
    expect(screen.getByTestId("blog-preview-banner")).toHaveTextContent("معاينة — بانتظار النشر");
  });
});

describe("fetchBlogPreviewServer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("belirteçli adrese no-store ile gider; 404 → null; 200 → data", async () => {
    const real = await vi.importActual<typeof import("@/lib/api/server-blog")>("@/lib/api/server-blog");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "p1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await real.fetchBlogPreviewServer("p 1", "s_a+b", "tr")).toBeNull();
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/blog\/preview\/p%201\?t=s_a%2Bb&locale=tr$/);
    expect(fetchMock.mock.calls[0]![1]).toEqual({ cache: "no-store" });
    expect(await real.fetchBlogPreviewServer("p1", "s_x")).toEqual({ id: "p1" });
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(/\/blog\/preview\/p1\?t=s_x$/);
    expect(fetchBlogPreviewServer).toBeTypeOf("function");
  });
});

describe("Taslak önizleme sayfası — dış bağlantılar", () => {
  it("kaynak bağlantıları noopener noreferrer nofollow ile açılır; sayfa meta referrer no-referrer", async () => {
    const { container } = await renderPreview();
    const external = Array.from(container.querySelectorAll('a[target="_blank"]'));
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect((await generateMetadata(props("en", "p1", "p_token"))).referrer).toBe("no-referrer");
  });
});
