import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import AdminProductsListPage from "@/app/admin/products/page";
import type { Product, User } from "@/lib/api/types";

vi.mock("@/lib/api/products", () => ({
  listProducts: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  restoreProduct: vi.fn(),
  permanentDeleteProduct: vi.fn(),
  bulkProductsAction: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const productsApi = await import("@/lib/api/products");

const axeOptions = { rules: { region: { enabled: false } } };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "ADMIN",
    canUseAdvancedBuilder: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    title: "Örnek Ürün",
    slug: "ornek-urun",
    excerpt: "Kısa açıklama",
    descriptionHtml: "<p>Açıklama</p>",
    priceCents: 150000,
    currency: "TRY",
    taxRatePercent: null,
    discountPriceCents: null,
    sku: "SKU-1",
    stockQuantity: 10,
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

describe("AdminProductsListPage — a11y", () => {
  it("boş ürün listesinde kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser();
    vi.mocked(productsApi.listProducts).mockResolvedValue({
      items: [],
      meta: { nextCursor: null, counts: { all: 0, published: 0, draft: 0, trashed: 0 } },
    });

    const { container } = render(<AdminProductsListPage />);

    expect(await screen.findByText("Henüz ürün yok")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("dolu ürün listesinde kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser();
    const products = [makeProduct(), makeProduct({ id: "product-2", title: "İkinci Ürün", slug: "ikinci-urun", status: "DRAFT" })];
    vi.mocked(productsApi.listProducts).mockResolvedValue({
      items: products,
      meta: { nextCursor: null, counts: { all: 2, published: 1, draft: 1, trashed: 0 } },
    });

    const { container } = render(<AdminProductsListPage />);

    // `ContentListTable` masaüstü (tablo) VE mobil (kart) görünümünü AYNI ANDA render eder
    // (görünürlük yalnızca CSS ile kontrol edilir, jsdom'da ikisi de DOM'dadır) — bu yüzden
    // her başlık en az bir kez bulunmalı, `getByText`'in tekillik varsayımı burada geçerli değil.
    expect((await screen.findAllByText("Örnek Ürün")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("İkinci Ürün").length).toBeGreaterThan(0);

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
