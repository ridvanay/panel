import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import CartPage from "@/app/(site)/cart/page";
import { CartProvider } from "@/context/cart-context";
import type { Cart } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api/cart", () => ({
  getCart: vi.fn(),
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

const cartApi = await import("@/lib/api/cart");

const axeOptions = { rules: { region: { enabled: false } } };

const cartWithItems: Cart = {
  currency: "TRY",
  subtotalCents: 35000,
  items: [
    {
      id: "item-1",
      productId: "product-1",
      product: { id: "product-1", title: "Örnek Ürün", slug: "ornek-urun", coverImageUrl: null, stockQuantity: 5 },
      quantity: 2,
      frozenUnitPriceCents: 10000,
      currentPriceCents: 12000,
      lineTotalCents: 20000,
    },
    {
      id: "item-2",
      productId: "product-2",
      product: { id: "product-2", title: "İkinci Ürün", slug: "ikinci-urun", coverImageUrl: null, stockQuantity: 5 },
      quantity: 1,
      frozenUnitPriceCents: 15000,
      currentPriceCents: 15000,
      lineTotalCents: 15000,
    },
  ],
};

function renderCartPage() {
  return render(
    <CartProvider>
      <CartPage />
    </CartProvider>
  );
}

describe("CartPage — a11y", () => {
  it("boş sepet durumunda kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue({ currency: null, subtotalCents: 0, items: [] });

    const { container } = renderCartPage();

    expect(await screen.findByText("Sepetiniz boş")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("dolu sepette (fiyat güncellendi uyarısı dahil) kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);

    const { container } = renderCartPage();

    expect(await screen.findByText("Örnek Ürün")).toBeInTheDocument();
    expect(screen.getByText(/Fiyat güncellendi/)).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
