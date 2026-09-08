import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckoutPage from "@/app/[lang]/(site)/checkout/page";
import { CartProvider } from "@/context/cart-context";
import { ApiClientError } from "@/lib/api/error";
import type { Cart, TaxSummary } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
}));

vi.mock("@/lib/api/cart", () => ({
  getCart: vi.fn(),
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

vi.mock("@/lib/api/checkout", () => ({
  createCheckoutSession: vi.fn(),
}));

// Hukuki sayfa bağlantıları bu dosyanın kapsamı DEĞİL (§3.6 — bulunamazsa link atlanır,
// checkbox yine render edilir); ağ çağrısını sabit boş listeyle KISA DEVRE ediyoruz.
vi.mock("@/lib/legal-pages", () => ({
  fetchLegalPagesClient: vi.fn().mockResolvedValue([]),
  resolveDistanceSalesPage: () => null,
  resolvePreliminaryInfoPage: () => null,
  resolveKvkkNoticePage: () => null,
}));

const cartApi = await import("@/lib/api/cart");
const checkoutApi = await import("@/lib/api/checkout");

const NOT_CONFIGURED_SHIPPING: Cart["shipping"] = {
  configured: false,
  feeCents: 0,
  thresholdCents: null,
  remainingCents: null,
  isFree: false,
};

const NO_TAX: TaxSummary = { includedInPrice: true, totalTaxCents: 0, breakdown: [] };

const cartWithItems: Cart = {
  currency: "TRY",
  subtotalCents: 15000,
  shipping: NOT_CONFIGURED_SHIPPING,
  totalCents: 15000,
  tax: NO_TAX,
  items: [
    {
      id: "item-1",
      productId: "product-1",
      product: { id: "product-1", title: "Örnek Ürün", slug: "ornek-urun", coverImageUrl: null, stockQuantity: 5 },
      variantId: null,
      variantLabel: null,
      quantity: 1,
      frozenUnitPriceCents: 15000,
      currentPriceCents: 15000,
      lineTotalCents: 15000,
      taxRatePercent: null,
      taxCents: 0,
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

/**
 * `Field`'ın zorunlu alan yıldızı (`*`) `aria-hidden` ile işaretlense de `getByLabelText`'in
 * varsayılan eşleştiricisi `<label>`'ın DÜZ `textContent`'ini kullanır (aria-hidden'ı DİKKATE
 * ALMAZ) — bu yüzden zorunlu alanlarda etiket metni sondaki `*` dahil eşleşir.
 */
function exactLabel(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*?$`);
}

/** Yalnızca ZORUNLU alanları dolduran ortak yardımcı — bireysel/`sameAsShipping:true` yolu. */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/E-posta/), "musteri@example.com");
  const fullNameInputs = screen.getAllByLabelText(exactLabel("Ad Soyad"));
  await user.type(fullNameInputs[1], "Ada Yılmaz"); // shippingAddress.fullName (index 0 = customerName)
  await user.type(screen.getByLabelText(exactLabel("Telefon")), "05551234567");
  await user.type(screen.getByLabelText(exactLabel("İl")), "İstanbul");
  await user.type(screen.getByLabelText(exactLabel("İlçe")), "Kadıköy");
  await user.type(screen.getByLabelText(exactLabel("Adres Satırı")), "Örnek Mah. Test Sk. No:1");
  await user.click(screen.getByRole("checkbox", { name: /Mesafeli Satış Sözleşmesi/ }));
  await user.click(screen.getByRole("checkbox", { name: /Ön Bilgilendirme Formu/ }));
}

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
    vi.mocked(cartApi.getCart).mockResolvedValue({
      currency: null,
      subtotalCents: 0,
      items: [],
      shipping: NOT_CONFIGURED_SHIPPING,
      totalCents: 0,
      tax: NO_TAX,
    });

    renderCheckout();

    expect(await screen.findByText("Sepetiniz boş")).toBeInTheDocument();
    expect(screen.queryByLabelText("E-posta")).not.toBeInTheDocument();
  });

  it("teslimat adresi bölümünde KVKK Aydınlatma Metni notu gösterilir (compliance §3, release engelleyici)", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);

    renderCheckout();

    expect(await screen.findByText(/Bu formda paylaştığınız bilgiler KVKK kapsamında işlenir\./)).toBeInTheDocument();
    // İlgili hukuki sayfa bulunamadığında (mock `null` döner) bağlantı VERİLMEZ, düz metin kalır.
    expect(screen.queryByRole("link", { name: "KVKK Aydınlatma Metni" })).not.toBeInTheDocument();
  });

  it("bireysel fatura seçiliyken T.C. Kimlik No alanının amacı açıkça belirtilir (compliance §1)", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);

    renderCheckout();

    expect(
      await screen.findByText("Bireysel fatura üzerinde T.C. Kimlik No gösterilmesini istiyorsanız girin. Bu alan zorunlu değildir.")
    ).toBeInTheDocument();
  });

  it("zorunlu alanlar boşken submit edilirse doğrulama hataları gösterir ve API çağrılmaz", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);
    const user = userEvent.setup();

    renderCheckout();

    const submitButton = await screen.findByRole("button", { name: /Güvenli Ödemeye Geç/ });
    await user.click(submitButton);

    expect(await screen.findByText("E-posta gerekli.")).toBeInTheDocument();
    expect(screen.getByText("Ad soyad zorunludur.")).toBeInTheDocument();
    expect(screen.getByText("Mesafeli Satış Sözleşmesi'ni onaylamanız gerekir.")).toBeInTheDocument();
    expect(screen.getByText("Ön Bilgilendirme Formu'nu onaylamanız gerekir.")).toBeInTheDocument();
    expect(checkoutApi.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("geçersiz e-posta girilirse doğrulama hatası gösterir", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);
    const user = userEvent.setup();

    renderCheckout();

    await user.type(await screen.findByLabelText(/E-posta/), "gecersiz-eposta");
    await user.click(screen.getByRole("button", { name: /Güvenli Ödemeye Geç/ }));

    expect(await screen.findByText("Geçerli bir e-posta adresi girin.")).toBeInTheDocument();
    expect(checkoutApi.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("kurumsal fatura seçilip vergi no boş bırakılırsa doğrulama hatası gösterir", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);
    const user = userEvent.setup();

    renderCheckout();

    await screen.findByLabelText(/E-posta/);
    await user.click(screen.getByRole("radio", { name: "Kurumsal" }));
    await user.click(screen.getByRole("button", { name: /Güvenli Ödemeye Geç/ }));

    expect(await screen.findByText("Kurumsal fatura için firma unvanı zorunludur.")).toBeInTheDocument();
    expect(screen.getByText("Vergi numarası 10 haneli olmalıdır.")).toBeInTheDocument();
    expect(checkoutApi.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("geçerli bilgilerle (bireysel, aynı adres) submit edildiğinde createCheckoutSession çağrılır ve checkoutUrl'e yönlendirilir", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);
    vi.mocked(checkoutApi.createCheckoutSession).mockResolvedValue({ checkoutUrl: "https://checkout.stripe.com/session-1" });
    const user = userEvent.setup();

    renderCheckout();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /Güvenli Ödemeye Geç/ }));

    await waitFor(() =>
      expect(checkoutApi.createCheckoutSession).toHaveBeenCalledWith({
        customerEmail: "musteri@example.com",
        customerName: undefined,
        shippingAddress: {
          fullName: "Ada Yılmaz",
          phone: "05551234567",
          city: "İstanbul",
          district: "Kadıköy",
          neighborhood: undefined,
          addressLine1: "Örnek Mah. Test Sk. No:1",
          addressLine2: undefined,
          postalCode: undefined,
        },
        billing: {
          billingType: "INDIVIDUAL",
          sameAsShipping: true,
        },
        distanceSalesApproved: true,
        preliminaryInfoApproved: true,
      })
    );
    await waitFor(() => expect(locationAssignMock).toHaveBeenCalledWith("https://checkout.stripe.com/session-1"));
  });

  it("backend 422 `error.details` alanları forma (alan altına) yansıtılır", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(cartWithItems);
    vi.mocked(checkoutApi.createCheckoutSession).mockRejectedValue(
      new ApiClientError(422, {
        code: "VALIDATION_ERROR",
        message: "Girdiğiniz bilgileri kontrol edin.",
        details: { "shippingAddress.postalCode": ["Posta kodu 5 haneli olmalıdır."] },
      })
    );
    const user = userEvent.setup();

    renderCheckout();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /Güvenli Ödemeye Geç/ }));

    expect(await screen.findByText("Posta kodu 5 haneli olmalıdır.")).toBeInTheDocument();
    expect(await screen.findByText("Girdiğiniz bilgileri kontrol edin.")).toBeInTheDocument();
    expect(locationAssignMock).not.toHaveBeenCalled();
  });
});
