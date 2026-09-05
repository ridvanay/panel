import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProductCardMedia } from "@/components/site/product-card-media";
import { CartProvider } from "@/context/cart-context";
import type { Cart } from "@/lib/api/types";

// `ProductCardMedia` `FavoriteButton`'ı render eder — `useRouter`/`usePathname` bir Next.js app
// router olmadan fırlatır (`product-card.test.tsx` ile AYNI mock deseni).
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api/cart", () => ({
  getCart: vi.fn(),
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

const cartApi = await import("@/lib/api/cart");

// `SafeImage`, host `next.config.ts::remotePatterns` dışındaysa düz `<img>`e (onError'ı FORWARD
// ETMEYEN bir dala — bkz. `safe-image.tsx`), izinliyse `next/image`e (onError'ı FORWARD EDEN dala)
// düşer. Bu test dosyası `ProductCardMedia`'nın KENDİ "başarısız URL" durum yönetimini izole
// doğrular — hangi host'un next/image'e izinli olduğu ortam değişkenine bağlıdır ve bu testin
// kapsamı DIŞINDADIR (o `safe-image.tsx`'in kendi sorumluluğu, bu dosya `do not modify` kapsamında).
// Bu yüzden burada basit bir sahte ile `onError`'ın HER ZAMAN alttaki `<img>`e ulaştığı varsayılır.
vi.mock("@/components/site/safe-image", () => ({
  SafeImage: ({ src, alt, className, onError }: { src: string; alt: string; className?: string; onError?: () => void }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test sahte bileşeni, gerçek next/image değil
    <img src={src} alt={alt} className={className} onError={onError} />
  ),
}));

const EMPTY_CART: Cart = {
  items: [],
  currency: null,
  subtotalCents: 0,
  shipping: { configured: false, feeCents: 0, thresholdCents: null, remainingCents: null, isFree: false },
  totalCents: 0,
};

function renderMedia(overrides: Partial<Parameters<typeof ProductCardMedia>[0]> = {}) {
  vi.mocked(cartApi.getCart).mockResolvedValue(EMPTY_CART);
  return render(
    <CartProvider>
      <ProductCardMedia
        href="/products/ornek-urun"
        productId="product-1"
        title="Örnek Ürün"
        coverUrl="https://cdn.example.com/eksik-gorsel.jpg"
        coverAlt="Eksik görsel"
        secondaryUrl="https://cdn.example.com/eksik-ikincil.jpg"
        secondaryAlt="Eksik ikincil görsel"
        badges={null}
        hasVariants={false}
        soldOut={false}
        stockQuantity={5}
        colors={[]}
        sizes="100vw"
        {...overrides}
      >
        <div />
      </ProductCardMedia>
    </CartProvider>
  );
}

describe("ProductCardMedia — kırık görsel yer tutucusu", () => {
  it("kapak görseli yüklenemezse ImageOff yer tutucusuna düşer, kırık ikon GÖSTERMEZ", () => {
    const { container } = renderMedia();

    const image = screen.getByAltText("Eksik görsel");
    fireEvent.error(image);

    expect(screen.queryByAltText("Eksik görsel")).not.toBeInTheDocument();
    expect(container.querySelector(".bg-gradient-to-br")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-image-off")).toBeInTheDocument();
  });

  it("ikincil (hover) görsel yüklenemezse sessizce kaldırılır, kırık ikon GÖSTERMEZ", () => {
    renderMedia();

    const secondaryImage = screen.getByAltText("Eksik ikincil görsel");
    fireEvent.error(secondaryImage);

    expect(screen.queryByAltText("Eksik ikincil görsel")).not.toBeInTheDocument();
    // Kapak görseli etkilenmeden kalmalı.
    expect(screen.getByAltText("Eksik görsel")).toBeInTheDocument();
  });

  it("coverUrl null iken 'Görsel yok' boş-durum metnini gösterir (kırık ikon DEĞİL)", () => {
    const { container } = renderMedia({ coverUrl: null, secondaryUrl: null });

    expect(screen.getByText("Görsel yok")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-image-off")).not.toBeInTheDocument();
  });
});
