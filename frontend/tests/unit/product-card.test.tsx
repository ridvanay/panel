import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductCard } from "@/components/site/product-card";
import { formatPriceFromCents } from "@/lib/format-price";
import type { Product } from "@/lib/api/types";

// `ProductCard` artık `FavoriteButton`'ı render eder (bkz. `product-card.tsx`), o da
// `useRouter`/`usePathname` kullanır — bir Next.js app router olmadan bu hook'lar fırlatır.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * §10.9.2/§10.9.3 — "Tükendi" rozetinin `stockQuantity` alanına göre doğru yansıdığını
 * doğrular (bkz. görev notu). `add-to-cart-button.test.tsx` ile BİRLİKTE "stokta olmayan ürün"
 * senaryosunun FRONTEND kapsamını tamamlar (kart görünümü + sepete ekleme butonu).
 */
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

describe("ProductCard", () => {
  it("stockQuantity 0 iken 'Tükendi' rozetini gösterir", () => {
    render(<ProductCard product={makeProduct({ stockQuantity: 0 })} />);
    expect(screen.getByText("Tükendi")).toBeInTheDocument();
  });

  it("stokta ürün varken 'Tükendi' rozeti GÖRÜNMEZ", () => {
    render(<ProductCard product={makeProduct({ stockQuantity: 3 })} />);
    expect(screen.queryByText("Tükendi")).not.toBeInTheDocument();
  });

  it("indirimli fiyat varsa orijinal fiyat üstü çizili gösterilir, indirimli fiyat vurgulanır", () => {
    render(<ProductCard product={makeProduct({ priceCents: 20000, discountPriceCents: 15000, currency: "TRY" })} />);
    expect(screen.getByText(formatPriceFromCents(20000, "TRY"))).toBeInTheDocument();
    expect(screen.getByText(formatPriceFromCents(15000, "TRY"))).toBeInTheDocument();
  });
});
