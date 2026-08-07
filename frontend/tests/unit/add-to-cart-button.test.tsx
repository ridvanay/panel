import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddToCartButton } from "@/components/site/add-to-cart-button";
import { CartProvider } from "@/context/cart-context";

/**
 * §10.9.3 Sepet + Stripe Checkout — "Stokta olmayan ürün sepete eklenemiyor / 'Tükendi' durumu
 * doğru yansıyor" senaryosunun FRONTEND tarafı. Backend tarafı (409 CONFLICT) `cart.test.ts`'te
 * zaten kapsanıyor; burada istemci tarafının stockQuantity:0 durumunu doğru YORUMLADIĞI ve
 * kullanıcıyı satın alamayacağı bir işlemden ENGELLEDİĞİ doğrulanır.
 */
vi.mock("@/lib/api/cart", () => ({
  getCart: vi.fn(),
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

const cartApi = await import("@/lib/api/cart");

function renderButton(props: { productId: string; stockQuantity: number }) {
  return render(
    <CartProvider>
      <AddToCartButton {...props} />
    </CartProvider>
  );
}

describe("AddToCartButton", () => {
  it("stockQuantity 0 iken buton devre dışıdır, 'Tükendi' yazar ve tıklanamaz", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue({ items: [], currency: null, subtotalCents: 0 });

    renderButton({ productId: "product-1", stockQuantity: 0 });

    const button = await screen.findByRole("button", { name: "Tükendi" });
    expect(button).toBeDisabled();

    const user = userEvent.setup();
    await user.click(button);
    expect(cartApi.addCartItem).not.toHaveBeenCalled();
  });

  it("stokta varken buton aktiftir ve tıklanınca addCartItem çağrılır", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue({ items: [], currency: null, subtotalCents: 0 });
    vi.mocked(cartApi.addCartItem).mockResolvedValue({
      items: [
        {
          id: "item-1",
          productId: "product-1",
          product: { id: "product-1", title: "Ürün", slug: "urun", coverImageUrl: null, stockQuantity: 5 },
          quantity: 1,
          frozenUnitPriceCents: 1000,
          currentPriceCents: 1000,
          lineTotalCents: 1000,
        },
      ],
      currency: "TRY",
      subtotalCents: 1000,
    });

    renderButton({ productId: "product-1", stockQuantity: 5 });
    const user = userEvent.setup();

    const button = await screen.findByRole("button", { name: "Sepete ekle" });
    expect(button).not.toBeDisabled();
    await user.click(button);

    await waitFor(() => expect(cartApi.addCartItem).toHaveBeenCalledWith({ productId: "product-1", quantity: 1 }));
    expect(await screen.findByText("Sepete eklendi")).toBeInTheDocument();
  });

  it("addCartItem hata fırlatırsa (ör. eş zamanlı stok tükenmesi) kullanıcıya hata mesajı gösterilir", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue({ items: [], currency: null, subtotalCents: 0 });
    vi.mocked(cartApi.addCartItem).mockRejectedValue(new Error("Ürün tükendi."));

    renderButton({ productId: "product-1", stockQuantity: 1 });
    const user = userEvent.setup();

    const button = await screen.findByRole("button", { name: "Sepete ekle" });
    await user.click(button);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
