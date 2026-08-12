import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeaturedPortfolioBlockView } from "@/components/site/blocks/featured-portfolio-block";
import type { FeaturedPortfolioBlock } from "@/lib/page-builder/types";
import type { PortfolioItem } from "@/lib/api/types";

/**
 * §Faz 4 Site Şablonu — `portfolio` modülü kapalıyken bu blok public tarafta SESSİZCE hiçbir şey
 * render ETMEMELİ. `featured-products-block.test.tsx` İLE BİREBİR AYNI patern.
 */
vi.mock("@/lib/api/server-modules", () => ({
  isModuleEnabledServer: vi.fn(),
}));
vi.mock("@/lib/api/server-portfolio", () => ({
  fetchPortfolioItemsServer: vi.fn(),
}));

const serverModulesApi = await import("@/lib/api/server-modules");
const serverPortfolioApi = await import("@/lib/api/server-portfolio");

function makePortfolioItem(overrides: Partial<PortfolioItem> = {}): PortfolioItem {
  return {
    id: "item-1",
    title: "Örnek Proje",
    slug: "ornek-proje",
    summary: null,
    contentHtml: "",
    clientName: null,
    projectUrl: null,
    completedAt: null,
    order: 0,
    status: "PUBLISHED",
    category: null,
    coverMedia: null,
    images: [],
    seoTitle: null,
    seoDescription: null,
    ogTitle: null,
    ogImageUrl: null,
    canonicalUrl: null,
    noIndex: false,
    translations: {},
    publishedAt: "2026-01-01T00:00:00.000Z",
    scheduledAt: null,
    viewCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    authorId: null,
    author: null,
    seoScore: 0,
    seoScoreIssues: [],
    localizations: [],
    ...overrides,
  };
}

function makeBlock(overrides: Partial<FeaturedPortfolioBlock["data"]> = {}): FeaturedPortfolioBlock {
  return { id: "block-1", type: "featured-portfolio", data: { heading: "Projelerimiz", limit: 4, ...overrides } };
}

describe("FeaturedPortfolioBlockView", () => {
  it("portfolio modülü kapalıyken null render eder (fetchPortfolioItemsServer HİÇ çağrılmaz)", async () => {
    vi.mocked(serverModulesApi.isModuleEnabledServer).mockResolvedValue(false);

    const jsx = await FeaturedPortfolioBlockView({ block: makeBlock() });
    expect(jsx).toBeNull();
    expect(serverPortfolioApi.fetchPortfolioItemsServer).not.toHaveBeenCalled();
  });

  it("modül açık ama hiç proje yoksa null render eder", async () => {
    vi.mocked(serverModulesApi.isModuleEnabledServer).mockResolvedValue(true);
    vi.mocked(serverPortfolioApi.fetchPortfolioItemsServer).mockResolvedValue([]);

    const jsx = await FeaturedPortfolioBlockView({ block: makeBlock() });
    expect(jsx).toBeNull();
  });

  it("modül açıkken projeleri limit'e göre kırparak render eder", async () => {
    vi.mocked(serverModulesApi.isModuleEnabledServer).mockResolvedValue(true);
    vi.mocked(serverPortfolioApi.fetchPortfolioItemsServer).mockResolvedValue([
      makePortfolioItem({ id: "i1", title: "Proje 1", slug: "proje-1" }),
      makePortfolioItem({ id: "i2", title: "Proje 2", slug: "proje-2" }),
      makePortfolioItem({ id: "i3", title: "Proje 3", slug: "proje-3" }),
    ]);

    const jsx = await FeaturedPortfolioBlockView({ block: makeBlock({ limit: 2 }) });
    render(jsx);

    expect(screen.getByText("Projelerimiz")).toBeInTheDocument();
    expect(screen.getByText("Proje 1")).toBeInTheDocument();
    expect(screen.getByText("Proje 2")).toBeInTheDocument();
    expect(screen.queryByText("Proje 3")).not.toBeInTheDocument();
  });

  it("categoryId verildiğinde yalnızca o kategorideki projeleri gösterir", async () => {
    vi.mocked(serverModulesApi.isModuleEnabledServer).mockResolvedValue(true);
    vi.mocked(serverPortfolioApi.fetchPortfolioItemsServer).mockResolvedValue([
      makePortfolioItem({
        id: "i1",
        title: "Web Projesi",
        slug: "web-projesi",
        category: { id: "cat-1", name: "Web Sitesi", slug: "web-sitesi", createdAt: "2026-01-01T00:00:00.000Z" },
      }),
      makePortfolioItem({
        id: "i2",
        title: "Mobil Projesi",
        slug: "mobil-projesi",
        category: { id: "cat-2", name: "Mobil", slug: "mobil", createdAt: "2026-01-01T00:00:00.000Z" },
      }),
    ]);

    const jsx = await FeaturedPortfolioBlockView({ block: makeBlock({ categoryId: "cat-1" }) });
    render(jsx);

    expect(screen.getByText("Web Projesi")).toBeInTheDocument();
    expect(screen.queryByText("Mobil Projesi")).not.toBeInTheDocument();
  });
});
