import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminOrderDetailPage from "@/app/admin/orders/[orderId]/page";
import type { Order } from "@/lib/api/types";

vi.mock("@/lib/api/orders", () => ({
  getOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  refundOrder: vi.fn(),
}));

const ordersApi = await import("@/lib/api/orders");

/**
 * `EditBlogPostPage` testindeki AYNI teknik — `use()`'un React "usable" protokolü, ÖNCEDEN
 * ÇÖZÜLMÜŞ bir thenable ile senkron sonuç döner (bkz. `edit-blog-post-page.test.tsx` yorumu).
 */
function resolvedParamsPromise<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  promise.status = "fulfilled";
  promise.value = value;
  return promise;
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    orderNumber: "ORD-0001",
    status: "PAID",
    customerEmail: "ada@example.com",
    customerName: "Ada Yılmaz",
    currency: "TRY",
    subtotalCents: 15000,
    discountCents: 0,
    taxCents: 0,
    totalCents: 15000,
    errorSummary: null,
    paidAt: "2026-08-01T10:00:00.000Z",
    trackingNumber: null,
    shippingCarrier: null,
    shippedAt: null,
    deliveredAt: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    items: [],
    ...overrides,
  };
}

async function renderPage() {
  const params = resolvedParamsPromise({ orderId: "order-1" });
  return render(<AdminOrderDetailPage params={params} />);
}

describe("AdminOrderDetailPage — SHIPPED geçişi", () => {
  it("PAID sipariş için 'Kargoya Ver' butonu gösterilir, dialog kargo takip no ZORUNLU alanıyla açılır", async () => {
    vi.mocked(ordersApi.getOrder).mockResolvedValue(makeOrder({ status: "PAID" }));
    const user = userEvent.setup();
    await renderPage();

    await screen.findByText("Sipariş ORD-0001");
    await user.click(screen.getByRole("button", { name: "Kargoya Ver" }));

    expect(screen.getByText("Siparişi kargoya ver")).toBeInTheDocument();
    expect(screen.getByLabelText(/Kargo Takip Numarası/)).toBeInTheDocument();
  });

  it("kargo takip no boşken formu göndermeye çalışınca 'Kargo takip numarası gerekli.' hatası gösterilir, updateOrderStatus ÇAĞRILMAZ", async () => {
    vi.mocked(ordersApi.getOrder).mockResolvedValue(makeOrder({ status: "PAID" }));
    const user = userEvent.setup();
    await renderPage();

    await screen.findByText("Sipariş ORD-0001");
    await user.click(screen.getByRole("button", { name: "Kargoya Ver" }));
    // Dialog içindeki gönder butonu — header'daki "Kargoya Ver" ile aynı isimde, dialog'a scope'lu sorgu.
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Kargoya Ver" }));

    expect(await screen.findByText("Kargo takip numarası gerekli.")).toBeInTheDocument();
    expect(ordersApi.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("kargo takip no girilip gönderilince updateOrderStatus SHIPPED status'üyle çağrılır ve sipariş güncellenir", async () => {
    vi.mocked(ordersApi.getOrder).mockResolvedValue(makeOrder({ status: "PAID" }));
    vi.mocked(ordersApi.updateOrderStatus).mockResolvedValue(
      makeOrder({ status: "SHIPPED", trackingNumber: "TR123456789", shippingCarrier: "Yurtiçi Kargo" })
    );
    const user = userEvent.setup();
    await renderPage();

    await screen.findByText("Sipariş ORD-0001");
    await user.click(screen.getByRole("button", { name: "Kargoya Ver" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Kargo Takip Numarası/), "TR123456789");
    await user.type(within(dialog).getByLabelText(/Kargo Firması/), "Yurtiçi Kargo");
    await user.click(within(dialog).getByRole("button", { name: "Kargoya Ver" }));

    await waitFor(() => {
      expect(ordersApi.updateOrderStatus).toHaveBeenCalledWith("order-1", {
        status: "SHIPPED",
        trackingNumber: "TR123456789",
        shippingCarrier: "Yurtiçi Kargo",
      });
    });
    expect(await screen.findByText("Kargo Takip Numarası")).toBeInTheDocument();
    expect(screen.getByText("TR123456789")).toBeInTheDocument();
  });

  it("SHIPPED sipariş için 'Tamamlandı Olarak İşaretle' ve 'İade Et' butonları gösterilir, 'Kargoya Ver' GÖSTERİLMEZ", async () => {
    vi.mocked(ordersApi.getOrder).mockResolvedValue(
      makeOrder({ status: "SHIPPED", trackingNumber: "TR999", shippingCarrier: "Aras Kargo" })
    );
    await renderPage();

    await screen.findByText("Sipariş ORD-0001");
    expect(screen.getByRole("button", { name: "Tamamlandı Olarak İşaretle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İade Et" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kargoya Ver" })).not.toBeInTheDocument();
    expect(screen.getByText("TR999")).toBeInTheDocument();
    expect(screen.getByText("Taşıyıcı: Aras Kargo")).toBeInTheDocument();
  });

  it("422 döndüğünde backend hata mesajı trackingNumber alan hatası olarak forma yansır", async () => {
    vi.mocked(ordersApi.getOrder).mockResolvedValue(makeOrder({ status: "PAID" }));
    const { ApiClientError } = await import("@/lib/api/error");
    vi.mocked(ordersApi.updateOrderStatus).mockRejectedValue(
      new ApiClientError(422, {
        code: "VALIDATION_ERROR",
        message: "Doğrulama hatası",
        details: { trackingNumber: ["Kargo takip numarası zaten kullanımda."] },
      })
    );
    const user = userEvent.setup();
    await renderPage();

    await screen.findByText("Sipariş ORD-0001");
    await user.click(screen.getByRole("button", { name: "Kargoya Ver" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Kargo Takip Numarası/), "DUP-1");
    await user.click(within(dialog).getByRole("button", { name: "Kargoya Ver" }));

    expect(await screen.findByText("Kargo takip numarası zaten kullanımda.")).toBeInTheDocument();
  });
});
