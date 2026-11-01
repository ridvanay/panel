import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PublicBlogList } from "@/lib/api/types";
import { GROUPS, PACKAGE, makeCard } from "./blog-z1-fixtures";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  topics: vi.fn(),
  packages: vi.fn(),
  page: vi.fn(),
  specialties: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/api/server-blog", () => ({
  fetchBlogListServer: (...a: unknown[]) => mocks.list(...a),
  fetchBlogTopicsServer: (...a: unknown[]) => mocks.topics(...a),
}));
vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: async () => (await import("./blog-z1-fixtures")).LOCALES }));
vi.mock("@/lib/api/server-packages", () => ({ fetchPackagesServer: (...a: unknown[]) => mocks.packages(...a) }));
vi.mock("@/lib/api/server-pages", () => ({ fetchPageBySlugServer: (...a: unknown[]) => mocks.page(...a) }));
vi.mock("@/components/site/matcher/matcher-modal", () => ({
  MatcherLaunchButton: () => <button type="button">Find my physician</button>,
}));
vi.mock("@/lib/api/server-telehealth", () => ({ fetchSpecialtiesServer: (...a: unknown[]) => mocks.specialties(...a), fetchAllDoctorsServer: () => Promise.resolve([]) }));
vi.mock("@/components/site/contact/contact-cta", () => ({ ContactCta: () => <div data-testid="contact-cta" /> }));

import { BlogIndexPage, buildBlogIndexMetadata } from "@/components/site/blog/blog-index-page";
import BlogPageRoute from "@/app/[lang]/(site)/blog/page/[n]/page";

function listOf(over: Partial<PublicBlogList> = {}): PublicBlogList {
  const items = [makeCard({ id: "a", slug: "a-post", title: "Alpha post" }), makeCard({ id: "b", slug: "b-post", title: "Beta post", reviewer: null })];
  return { items, total: 2, page: 1, pageSize: 12, featured: items[0]!, ...over };
}

async function renderIndex(options: { lang?: string; page?: number; searchParams?: Record<string, string> } = {}) {
  const ui = await BlogIndexPage({ lang: options.lang ?? "en", page: options.page ?? 1, searchParams: options.searchParams ?? {} });
  return render(ui);
}

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(listOf());
  mocks.topics.mockReset().mockResolvedValue(GROUPS);
  mocks.packages.mockReset().mockResolvedValue({ items: [], categories: [] });
  mocks.page.mockReset().mockResolvedValue(null);
  mocks.specialties.mockReset().mockResolvedValue([]);
});

describe("Paket Z1 — blog ana sayfası", () => {
  it("H1, açıklama, toplam sayı, arama formu ve breadcrumb", async () => {
    await renderIndex();
    expect(screen.getByRole("heading", { level: 1, name: "Health Guides" })).toBeInTheDocument();
    expect(screen.getByText("Patient guides written by our editorial team and reviewed by our physicians.")).toBeInTheDocument();
    expect(screen.getByTestId("blog-total")).toHaveTextContent("Articles: 2");
    const search = screen.getByRole("search");
    expect(search).toHaveAttribute("method", "get");
    expect(search).toHaveAttribute("action", "/blog");
    expect(within(search).getByLabelText("Search articles")).toHaveAttribute("name", "q");
    expect(within(screen.getByTestId("blog-breadcrumb")).getByText("Health Guides")).toHaveAttribute("aria-current", "page");
  });

  it("konu filtresi: grup ve çip sayıları, 'All topics' toplamı, More topics", async () => {
    await renderIndex();
    const groups = screen.getAllByTestId("blog-topic-group").map((g) => g.textContent);
    expect(groups).toEqual(["Orthopaedics(9)", "Cardiology(3)"]);
    expect(screen.getByTestId("blog-topic-all")).toHaveTextContent("All topics(2)");
    // Filtresiz görünümde çipler tüm gruplardan toplanır: ilk 6 görünür, kalanlar <details> içinde.
    expect(screen.getAllByTestId("blog-topic-chip").length).toBeGreaterThanOrEqual(7);
    const more = screen.getByTestId("blog-more-topics");
    expect(more.tagName).toBe("DETAILS");
    expect(within(more).getByText("More topics")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Knee pain/ })).toHaveAttribute("href", "/blog?topic=knee-pain");
  });

  it("?topic= etkin konuyu işaretler ve URL'ye yansıtır; arama formu konuyu korur", async () => {
    await renderIndex({ searchParams: { topic: "hip" } });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ topic: "hip", page: 1, locale: "en" }));
    const active = screen.getAllByTestId("blog-topic-chip").find((el) => el.getAttribute("aria-current") === "true");
    expect(active).toHaveTextContent("Hip");
    expect(screen.getByRole("search").querySelector('input[name="topic"]')).toHaveValue("hip");
  });

  it("Latest öne çıkan blok: kategori, başlık, özet, ✓ hekim, tarih, okuma süresi, Read the article; kart ızgarasında tekrar edilmez", async () => {
    await renderIndex();
    const featured = screen.getByTestId("blog-featured");
    expect(within(featured).getByRole("heading", { level: 2, name: "Latest" })).toBeInTheDocument();
    expect(within(featured).getByRole("heading", { name: "Alpha post" })).toBeInTheDocument();
    expect(within(featured).getByTestId("blog-featured-reviewer")).toHaveTextContent("Reviewed by Prof. Dr. H. Sofu");
    expect(within(featured).getByText("6 min read")).toBeInTheDocument();
    expect(within(featured).getByText("October 20, 2026")).toBeInTheDocument();
    expect(within(featured).getByRole("link", { name: /Read the article/ })).toHaveAttribute("href", "/blog/a-post");
    const grid = screen.getByTestId("blog-grid");
    expect(within(grid).queryByText("Alpha post")).toBeNull();
    expect(within(grid).getByText("Beta post")).toBeInTheDocument();
  });

  it("hekim onayı yoksa kartta '✓ Reviewed by' satırı hiç çizilmez", async () => {
    await renderIndex();
    const cards = screen.getAllByTestId("blog-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).queryByTestId("blog-card-reviewer")).toBeNull();
  });

  it("kapak yoksa uzmanlık ikonlu şablon kapak çizilir", async () => {
    await renderIndex();
    expect(screen.getAllByTestId("blog-cover-template").length).toBeGreaterThanOrEqual(2);
  });

  it("Find my physician CTA her zaman çizilir", async () => {
    await renderIndex();
    expect(screen.getByTestId("blog-find-physician-cta")).toHaveTextContent("Not sure which physician you need?");
    expect(screen.getByRole("button", { name: "Find my physician" })).toBeInTheDocument();
  });

  it("aktif paket yokken 'Popular packages' HİÇ çizilmez; varken çizilir", async () => {
    const { unmount } = await renderIndex();
    expect(screen.queryByTestId("blog-popular-packages")).toBeNull();
    expect(screen.queryByText("Popular packages")).toBeNull();
    unmount();
    mocks.packages.mockResolvedValue({ items: [PACKAGE], categories: ["check-up"] });
    await renderIndex();
    const block = screen.getByTestId("blog-popular-packages");
    expect(within(block).getByText("Popular packages")).toBeInTheDocument();
    expect(within(block).getByText("Executive Check-up")).toBeInTheDocument();
  });

  it("paket servisi hata verirse blok sessizce gizlenir", async () => {
    mocks.packages.mockRejectedValue(new Error("boom"));
    await renderIndex();
    expect(screen.queryByTestId("blog-popular-packages")).toBeNull();
  });

  it("güven bağlantıları her zaman özel route'lara gider (CMS kaydına bağlı değil)", async () => {
    await renderIndex();
    const trust = screen.getAllByTestId("blog-trust-links").at(-1)!;
    expect(within(trust).getByRole("link", { name: "Content standards" })).toHaveAttribute("href", "/content-standards");
    expect(within(trust).getByRole("link", { name: "Authors & medical reviewers" })).toHaveAttribute("href", "/medical-reviewers");
  });

  it("boş blog ve sonuçsuz filtre için ayrı boş durumlar", async () => {
    mocks.list.mockResolvedValue(listOf({ items: [], total: 0, featured: null }));
    const { unmount } = await renderIndex();
    expect(screen.getByTestId("blog-empty")).toHaveTextContent("Our first guides are being reviewed by our physicians.");
    unmount();
    await renderIndex({ searchParams: { q: "zzz" } });
    expect(screen.getAllByTestId("blog-empty").at(-1)).toHaveTextContent("No articles found");
    expect(screen.getByRole("link", { name: "Show all articles" })).toHaveAttribute("href", "/blog");
  });

  it("arama sonuçlarında Latest bloğu gösterilmez", async () => {
    await renderIndex({ searchParams: { q: "knee" } });
    expect(screen.queryByTestId("blog-featured")).toBeNull();
    expect(screen.getByTestId("blog-search-summary")).toHaveTextContent("Results for “knee”");
  });

  it("sayfalama: 2. sayfa bağlantıları /blog/page/n; 1. sayfa /blog", async () => {
    mocks.list.mockResolvedValue(listOf({ total: 30, page: 2, featured: null }));
    await renderIndex({ page: 2 });
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/blog");
    expect(within(nav).getByRole("link", { name: "Next page" })).toHaveAttribute("href", "/blog/page/3");
    expect(within(nav).getByText("2")).toHaveAttribute("aria-current", "page");
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
  });

  it("aralık dışı sayfa (öğe yok) 404", async () => {
    mocks.list.mockResolvedValue(listOf({ items: [], total: 5, page: 9, featured: null }));
    await expect(BlogIndexPage({ lang: "en", page: 9, searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("RTL: Arapça sayfa dir=rtl ve Arapça başlık; diğer diller ltr; bağlantılar dil önekli", async () => {
    await renderIndex({ lang: "ar" });
    const root = screen.getByTestId("blog-index");
    expect(root).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("أدلة صحية");
    expect(screen.getByRole("link", { name: /اقرأ المقال/ })).toHaveAttribute("href", "/ar/blog/a-post");
  });

  it("LTR diller dir=ltr", async () => {
    await renderIndex({ lang: "tr" });
    expect(screen.getByTestId("blog-index")).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sağlık Rehberleri");
  });
});

describe("Paket Z1 — blog ana sayfası meta (canonical / noindex)", () => {
  const meta = (page: number, searchParams: Record<string, string> = {}, lang = "en") => buildBlogIndexMetadata({ lang, page, searchParams });

  it("1. sayfanın canonical'ı /blog; indekslenir", async () => {
    const m = await meta(1);
    expect(String(m.alternates?.canonical)).toMatch(/\/blog$/);
    expect(m.robots).toBeUndefined();
    expect(m.title).toBe("Health Guides");
  });

  it("2. sayfanın canonical'ı kendisi (/blog/page/2) ve başlığı sayfa numarası içerir", async () => {
    mocks.list.mockResolvedValue(listOf({ total: 30, page: 2 }));
    const m = await meta(2);
    expect(String(m.alternates?.canonical)).toMatch(/\/blog\/page\/2$/);
    expect(m.title).toBe("Health Guides – Page 2 of 3");
  });

  it("konu filtreli sayfa kendi canonical'ıyla (?topic=) indekslenir; dil önekli", async () => {
    const m = await meta(1, { topic: "knee-pain" }, "tr");
    expect(String(m.alternates?.canonical)).toMatch(/\/tr\/blog\?topic=knee-pain$/);
    expect(m.robots).toBeUndefined();
  });

  it("arama (?q=) noindex,follow ve canonical aramasız; sonuçsuz sayfa noindex", async () => {
    const searched = await meta(1, { q: "diz", topic: "hip" });
    expect(searched.robots).toEqual({ index: false, follow: true });
    expect(String(searched.alternates?.canonical)).toMatch(/\/blog\?topic=hip$/);
    mocks.list.mockResolvedValue(listOf({ items: [], total: 0, featured: null }));
    expect((await meta(1)).robots).toEqual({ index: false, follow: true });
  });
});

describe("Paket Z1 — /blog/page/[n] yönlendirme", () => {
  const call = (n: string, searchParams: Record<string, string> = {}, lang = "en") =>
    BlogPageRoute({ params: Promise.resolve({ lang, n }), searchParams: Promise.resolve(searchParams) });

  it("page/1 kalıcı olarak /blog'a (sorgu korunarak) yönlenir", async () => {
    await expect(call("1")).rejects.toThrow("NEXT_REDIRECT:/blog");
    await expect(call("1", { topic: "hip" }, "tr")).rejects.toThrow("NEXT_REDIRECT:/tr/blog?topic=hip");
  });

  it("geçersiz sayfa numarası 404", async () => {
    for (const bad of ["0", "abc", "-2", "01", "1.5"]) await expect(call(bad)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("geçerli sayfa numarası içerik üretir", async () => {
    expect(await call("2")).toBeTruthy();
  });
});
