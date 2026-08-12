import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import AdminPortfolioListPage from "@/app/admin/portfolio/page";
import type { PortfolioItem, User } from "@/lib/api/types";

vi.mock("@/lib/api/portfolio", () => ({
  listPortfolioItems: vi.fn(),
  updatePortfolioItem: vi.fn(),
  deletePortfolioItem: vi.fn(),
  restorePortfolioItem: vi.fn(),
  permanentDeletePortfolioItem: vi.fn(),
  bulkPortfolioItemsAction: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const portfolioApi = await import("@/lib/api/portfolio");

const axeOptions = { rules: { region: { enabled: false } } };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "ADMIN",
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

function makePortfolioItem(overrides: Partial<PortfolioItem> = {}): PortfolioItem {
  return {
    id: "portfolio-1",
    title: "Örnek Proje",
    slug: "ornek-proje",
    summary: "Kısa özet",
    contentHtml: "<p>İçerik</p>",
    clientName: "Örnek Müşteri",
    projectUrl: "https://example.com",
    completedAt: "2026-01-01T00:00:00.000Z",
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
    viewCount: 12,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    deletedAt: null,
    authorId: "user-1",
    author: { id: "user-1", name: "Admin Kullanıcı", email: "admin@example.com", avatarUrl: null },
    seoScore: 80,
    seoScoreIssues: [],
    localizations: [],
    ...overrides,
  };
}

describe("AdminPortfolioListPage — a11y", () => {
  it("boş portföy listesinde kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser();
    vi.mocked(portfolioApi.listPortfolioItems).mockResolvedValue({
      items: [],
      meta: { nextCursor: null, counts: { all: 0, published: 0, draft: 0, trashed: 0 } },
    });

    const { container } = render(<AdminPortfolioListPage />);

    expect(await screen.findByText("Henüz portföy öğesi yok")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("dolu portföy listesinde kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser();
    const items = [
      makePortfolioItem(),
      makePortfolioItem({ id: "portfolio-2", title: "İkinci Proje", slug: "ikinci-proje", status: "DRAFT" }),
    ];
    vi.mocked(portfolioApi.listPortfolioItems).mockResolvedValue({
      items,
      meta: { nextCursor: null, counts: { all: 2, published: 1, draft: 1, trashed: 0 } },
    });

    const { container } = render(<AdminPortfolioListPage />);

    // `ContentListTable` masaüstü (tablo) VE mobil (kart) görünümünü AYNI ANDA render eder
    // (görünürlük yalnızca CSS ile kontrol edilir, jsdom'da ikisi de DOM'dadır) — bu yüzden
    // her başlık en az bir kez bulunmalı, `getByText`'in tekillik varsayımı burada geçerli değil.
    expect((await screen.findAllByText("Örnek Proje")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("İkinci Proje").length).toBeGreaterThan(0);

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
