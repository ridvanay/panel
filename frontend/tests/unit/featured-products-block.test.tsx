import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeaturedProductsBlockView } from "@/components/site/blocks/featured-products-block";
import { CartProvider } from "@/context/cart-context";
import type { FeaturedProductsBlock } from "@/lib/page-builder/types";
import type { Cart, Product } from "@/lib/api/types";

// `ProductCard` artık `FavoriteButton`'ı render eder (bkz. `product-card.tsx`), o da
// `useRouter`/`usePathname` kullanır — bir Next.js app router olmadan bu hook'lar fırlatır.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

// Stoktaki/varyasyonsuz ürün kartı artık hızlı-sepete-ekle çubuğu render eder — `useCart()` bir
// `<CartProvider>` gerektirir (`add-to-cart-button.test.tsx` ile AYNI desen).
vi.mock("@/lib/api/cart", () => ({
  getCart: vi.fn(),
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

const cartApi = await import("@/lib/api/cart");

const EMPTY_CART: Cart = {
  items: [],
  currency: null,
  subtotalCents: 0,
  shipping: { configured: false, feeCents: 0, thresholdCents: null, remainingCents: null, isFree: false },
  totalCents: 0,
};

/**
 * §Faz 4 Site Şablonu — `products` modülü kapalıyken bu blok public tarafta SESSİZCE hiçbir şey
 * render ETMEMELİ (hata/boş state YOK, sayfanın geri kalanı normal render olmaya devam eder).
 * `FeaturedProductsBlockView` bir async server component (düz bir async fonksiyon) olduğundan
 * doğrudan `await Component(props)` ile çağrılıp dönen JSX render edilir — bu dosyadaki diğer
 * `vi.mock` paternleriyle (ör. cart-context.test.tsx) AYNI yaklaşım, yalnızca RSC'ye özel.
 */
vi.mock("@/lib/api/server-modules", () => ({
  isModuleEnabledServer: vi.fn(),
}));
vi.mock("@/lib/api/server-products", () => ({
  fetchProductsServer: vi.fn(),
}));

const serverModulesApi = await import("@/lib/api/server-modules");
const serverProductsApi = await import("@/lib/api/server-products");

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    title: "Örnek Ürün",
    slug: "ornek-urun",
    excerpt: null,
    descriptionHtml: "",
    priceCents: 10000,
    currency: "TRY",
    taxRatePercent: null,
    discountPriceCents: null,
    sku: null,
    stockQuantity: 5,
    salesCount: 0,
    discountPercent: 0,
    status: "PUBLISHED",
    category: null,
    coverMedia: null,
    images: [],
    variantOptions: [],
    variants: [],
    documents: [],
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

function makeBlock(overrides: Partial<FeaturedProductsBlock["data"]> = {}): FeaturedProductsBlock {
  return { id: "block-1", type: "featured-products", data: { heading: "Öne Çıkanlar", limit: 4, ...overrides } };
}

describe("FeaturedProductsBlockView", () => {
  it("products modülü kapalıyken null render eder (fetchProductsServer HİÇ çağrılmaz)", async () => {
    vi.mocked(serverModulesApi.isModuleEnabledServer).mockResolvedValue(false);

    const jsx = await FeaturedProductsBlockView({ block: makeBlock(), chrome: "page" });
    expect(jsx).toBeNull();
    expect(serverProductsApi.fetchProductsServer).not.toHaveBeenCalled();
  });

  it("modül açık ama hiç ürün yoksa null render eder", async () => {
    vi.mocked(serverModulesApi.isModuleEnabledServer).mockResolvedValue(true);
    vi.mocked(serverProductsApi.fetchProductsServer).mockResolvedValue([]);

    const jsx = await FeaturedProductsBlockView({ block: makeBlock(), chrome: "page" });
    expect(jsx).toBeNull();
  });

  it("modül açıkken ürünleri limit'e göre kırparak render eder", async () => {
    vi.mocked(serverModulesApi.isModuleEnabledServer).mockResolvedValue(true);
    vi.mocked(cartApi.getCart).mockResolvedValue(EMPTY_CART);
    vi.mocked(serverProductsApi.fetchProductsServer).mockResolvedValue([
      makeProduct({ id: "p1", title: "Ürün 1", slug: "urun-1" }),
      makeProduct({ id: "p2", title: "Ürün 2", slug: "urun-2" }),
      makeProduct({ id: "p3", title: "Ürün 3", slug: "urun-3" }),
    ]);

    const jsx = await FeaturedProductsBlockView({ block: makeBlock({ limit: 2 }), chrome: "page" });
    render(<CartProvider>{jsx}</CartProvider>);

    expect(screen.getByText("Öne Çıkanlar")).toBeInTheDocument();
    expect(screen.getByText("Ürün 1")).toBeInTheDocument();
    expect(screen.getByText("Ürün 2")).toBeInTheDocument();
    expect(screen.queryByText("Ürün 3")).not.toBeInTheDocument();
  });

  it("categoryId verildiğinde yalnızca o kategorideki ürünleri gösterir", async () => {
    vi.mocked(serverModulesApi.isModuleEnabledServer).mockResolvedValue(true);
    vi.mocked(cartApi.getCart).mockResolvedValue(EMPTY_CART);
    vi.mocked(serverProductsApi.fetchProductsServer).mockResolvedValue([
      makeProduct({
        id: "p1",
        title: "Elektronik Ürün",
        slug: "elektronik-urun",
        category: { id: "cat-1", name: "Elektronik", slug: "elektronik", parentId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      }),
      makeProduct({
        id: "p2",
        title: "Giyim Ürünü",
        slug: "giyim-urunu",
        category: { id: "cat-2", name: "Giyim", slug: "giyim", parentId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      }),
    ]);

    const jsx = await FeaturedProductsBlockView({ block: makeBlock({ categoryId: "cat-1" }), chrome: "page" });
    render(<CartProvider>{jsx}</CartProvider>);

    expect(screen.getByText("Elektronik Ürün")).toBeInTheDocument();
    expect(screen.queryByText("Giyim Ürünü")).not.toBeInTheDocument();
  });
});
