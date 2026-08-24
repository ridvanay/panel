import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FavoriteButton } from "@/components/site/favorite-button";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/products/ornek-urun",
  useRouter: () => ({ push }),
}));

let authStatus: "authenticated" | "unauthenticated" = "authenticated";
vi.mock("@/context/auth-context", () => ({
  useAuthOptional: () => ({ status: authStatus }),
}));

const favoriteIds = new Set<string>();
const toggle = vi.fn(async (productId: string) => {
  if (favoriteIds.has(productId)) favoriteIds.delete(productId);
  else favoriteIds.add(productId);
});
vi.mock("@/context/wishlist-context", () => ({
  useWishlistOptional: () => ({
    loading: false,
    isFavorited: (productId: string) => favoriteIds.has(productId),
    toggle,
  }),
}));

/**
 * §customer-portal §10.21.7 — wishlist API'sinde rol kısıtı YOKTUR, bu bileşen SADECE
 * `status === "authenticated"` kontrolü yapar (bkz. `favorite-button.tsx` üst yorum).
 */
describe("FavoriteButton", () => {
  beforeEach(() => {
    favoriteIds.clear();
    toggle.mockClear();
    push.mockClear();
    authStatus = "authenticated";
  });

  it("giriş yapmamış kullanıcı tıklayınca /login?next=... yönlendirmesi yapar, wishlist.toggle ÇAĞRILMAZ", async () => {
    authStatus = "unauthenticated";
    const user = userEvent.setup();
    render(<FavoriteButton productId="product-1" />);

    await user.click(screen.getByRole("button", { name: "Favorilere ekle" }));

    expect(push).toHaveBeenCalledWith("/login?next=%2Fproducts%2Fornek-urun");
    expect(toggle).not.toHaveBeenCalled();
  });

  it("giriş yapmış kullanıcı tıklayınca ürünü favoriye ekler, ikinci tıklamada çıkarır (toggle)", async () => {
    const user = userEvent.setup();
    render(<FavoriteButton productId="product-1" />);

    await user.click(screen.getByRole("button", { name: "Favorilere ekle" }));
    expect(toggle).toHaveBeenCalledWith("product-1");
    expect(await screen.findByRole("button", { name: "Favorilerden çıkar" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Favorilerden çıkar" }));
    expect(await screen.findByRole("button", { name: "Favorilere ekle" })).toBeInTheDocument();
  });
});
