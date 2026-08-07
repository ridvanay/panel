import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckoutPage from "@/app/(site)/checkout/page";
import { CartProvider } from "@/context/cart-context";
import type { Cart } from "@/lib/api/types";

vi.mock("@/lib/api/cart", () => ({
  getCart: vi.fn(),
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

vi.mock("@/lib/api/checkout", () => ({
  createCheckoutSession: vi.fn(),
}));

const cartApi = await import("@/lib/api/cart");
const checkoutApi = await import("@/lib/api/checkout");

const cartWithItems: Cart = {
  currency: "TRY",
  subtotalCents: 15000,
  items: [
    {
      id: "item-1",
      productId: "product-1",
      product: { id: "product-1", title: "Örnek Ürün", slug: "ornek-urun", coverImageUrl: null, stockQuantity: 5 },
      quantity: 1,
      frozenUnitPriceCents: 15000,
      currentPriceCents: 15000,
      lineTotalCents: 15000,
    },
  ],
};

function renderCheckout() {
  return render(
    <CartProvider>
      <CheckoutPage />
    </CartProvider>
  );
}

const locationAssignMock = vi.fn();

describe("CheckoutPage — form doğrulaması", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationAssignMock.mockClear();
    // jsdom'da `window.location.assign` "Not implemented" hatası fırlatır ve `assign` doğrudan
    // spy'lanamaz (non-configurable) — `location`'ı KENDİ mock'umuzla değiştiriyoruz.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign: locationAssignMock },
    });
  });

  it("sepet boşken ödeme formu yerine boş sepet mesajı gösterir", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue({ currency: null, subtotalCents: 0, items: [] });

    renderCheckout();

    expect(await screen.findByText("Sepetiniz boş")).toBeInTheDocument();
    expect(screen.queryByLabelText("E-posta")).not.toBeInTheDocument();
  });

  it("e-posta boşken submit edilirse doğrulama hatası gösterir ve API çağrılmaz", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);
    const user = userEvent.setup();

    renderCheckout();

    const submitButton = await screen.findByRole("button", { name: /Ödemeye Geç/ });
    await user.click(submitButton);

    expect(await screen.findByText("E-posta gerekli.")).toBeInTheDocument();
    expect(checkoutApi.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("geçersiz e-posta girilirse doğrulama hatası gösterir", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);
    const user = userEvent.setup();

    renderCheckout();

    await user.type(await screen.findByLabelText(/E-posta/), "gecersiz-eposta");
    await user.click(screen.getByRole("button", { name: /Ödemeye Geç/ }));

    expect(await screen.findByText("Geçerli bir e-posta adresi girin.")).toBeInTheDocument();
    expect(checkoutApi.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("geçerli bilgilerle submit edildiğinde createCheckoutSession çağrılır ve checkoutUrl'e yönlendirilir", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);
    vi.mocked(checkoutApi.createCheckoutSession).mockResolvedValue({ checkoutUrl: "https://checkout.stripe.com/session-1" });
    const user = userEvent.setup();

    renderCheckout();

    await user.type(await screen.findByLabelText(/E-posta/), "musteri@example.com");
    await user.type(screen.getByLabelText("Ad Soyad"), "Ada Yılmaz");
    await user.click(screen.getByRole("button", { name: /Ödemeye Geç/ }));

    await waitFor(() =>
      expect(checkoutApi.createCheckoutSession).toHaveBeenCalledWith({
        customerEmail: "musteri@example.com",
        customerName: "Ada Yılmaz",
      })
    );
    await waitFor(() => expect(locationAssignMock).toHaveBeenCalledWith("https://checkout.stripe.com/session-1"));
  });
});
