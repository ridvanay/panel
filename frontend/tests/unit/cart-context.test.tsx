import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { CartProvider, useCart } from "@/context/cart-context";
import type { Cart } from "@/lib/api/types";

vi.mock("@/lib/api/cart", () => ({
  getCart: vi.fn(),
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

const cartApi = await import("@/lib/api/cart");

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    items: [],
    currency: "TRY",
    subtotalCents: 0,
    ...overrides,
  };
}

const product = {
  id: "product-1",
  title: "Örnek Ürün",
  slug: "ornek-urun",
  coverImageUrl: null,
  stockQuantity: 10,
};

describe("CartProvider / useCart", () => {
  it("mount olduğunda sepeti çeker ve itemCount'u satır adetlerinin toplamı olarak hesaplar", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(
      makeCart({
        subtotalCents: 30000,
        items: [
          { id: "item-1", productId: "product-1", product, quantity: 2, frozenUnitPriceCents: 10000, currentPriceCents: 10000, lineTotalCents: 20000 },
          { id: "item-2", productId: "product-2", product: { ...product, id: "product-2" }, quantity: 1, frozenUnitPriceCents: 10000, currentPriceCents: 10000, lineTotalCents: 10000 },
        ],
      })
    );

    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.itemCount).toBe(3);
    expect(result.current.cart?.subtotalCents).toBe(30000);
  });

  it("sepet çekme hata verirse sessizce yutar, cart null ve loading false olur", async () => {
    vi.mocked(cartApi.getCart).mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cart).toBeNull();
    expect(result.current.itemCount).toBe(0);
  });

  it("addItem, addCartItem'ı çağırır ve dönen sepeti state'e yazar", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(makeCart());
    const updatedCart = makeCart({
      subtotalCents: 10000,
      items: [{ id: "item-1", productId: "product-1", product, quantity: 1, frozenUnitPriceCents: 10000, currentPriceCents: 10000, lineTotalCents: 10000 }],
    });
    vi.mocked(cartApi.addCartItem).mockResolvedValue(updatedCart);

    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addItem("product-1", 1);
    });

    expect(cartApi.addCartItem).toHaveBeenCalledWith({ productId: "product-1", quantity: 1 });
    expect(result.current.cart?.items).toHaveLength(1);
    expect(result.current.itemCount).toBe(1);
  });

  it("updateItem, updateCartItem'ı çağırır ve dönen sepeti state'e yazar", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(
      makeCart({
        subtotalCents: 10000,
        items: [{ id: "item-1", productId: "product-1", product, quantity: 1, frozenUnitPriceCents: 10000, currentPriceCents: 10000, lineTotalCents: 10000 }],
      })
    );
    const updatedCart = makeCart({
      subtotalCents: 20000,
      items: [{ id: "item-1", productId: "product-1", product, quantity: 2, frozenUnitPriceCents: 10000, currentPriceCents: 10000, lineTotalCents: 20000 }],
    });
    vi.mocked(cartApi.updateCartItem).mockResolvedValue(updatedCart);

    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateItem("item-1", 2);
    });

    expect(cartApi.updateCartItem).toHaveBeenCalledWith("item-1", { quantity: 2 });
    expect(result.current.itemCount).toBe(2);
  });

  it("removeItem, removeCartItem'ı çağırır ve dönen sepeti state'e yazar", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(
      makeCart({
        subtotalCents: 10000,
        items: [{ id: "item-1", productId: "product-1", product, quantity: 1, frozenUnitPriceCents: 10000, currentPriceCents: 10000, lineTotalCents: 10000 }],
      })
    );
    vi.mocked(cartApi.removeCartItem).mockResolvedValue(makeCart());

    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeItem("item-1");
    });

    expect(cartApi.removeCartItem).toHaveBeenCalledWith("item-1");
    expect(result.current.cart?.items).toHaveLength(0);
    expect(result.current.itemCount).toBe(0);
  });

  it("addItem hata fırlatırsa çağıran tarafa propagate eder (sessizce yutulmaz)", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(makeCart());
    vi.mocked(cartApi.addCartItem).mockRejectedValue(new Error("stok yetersiz"));

    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.addItem("product-1", 1);
      })
    ).rejects.toThrow("stok yetersiz");
  });
});
