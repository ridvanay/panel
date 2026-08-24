import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminOrdersPage from "@/app/admin/orders/page";
import type { Order } from "@/lib/api/types";

vi.mock("@/lib/api/orders", () => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

const ordersApi = await import("@/lib/api/orders");

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    orderNumber: "ORD-0001",
    status: "PAID",
    customerEmail: "m***@example.com",
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

describe("AdminOrdersPage", () => {
  it("sipariş yokken boş durum mesajı gösterir", async () => {
    vi.mocked(ordersApi.listOrders).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    render(<AdminOrdersPage />);

    expect(await screen.findByText("Henüz sipariş yok")).toBeInTheDocument();
  });

  it("sipariş listesini sipariş no/tutar/maskeli e-posta ve renk kodlu durum rozetiyle render eder", async () => {
    const orders = [
      makeOrder({ id: "order-1", orderNumber: "ORD-0001", status: "PAID" }),
      makeOrder({ id: "order-2", orderNumber: "ORD-0002", status: "PENDING", customerEmail: "p***@example.com" }),
      makeOrder({ id: "order-3", orderNumber: "ORD-0003", status: "FAILED", customerEmail: "f***@example.com" }),
    ];
    vi.mocked(ordersApi.listOrders).mockResolvedValue({ items: orders, meta: { nextCursor: null } });

    render(<AdminOrdersPage />);

    expect(await screen.findByText("ORD-0001")).toBeInTheDocument();
    expect(screen.getByText("ORD-0002")).toBeInTheDocument();
    expect(screen.getByText("ORD-0003")).toBeInTheDocument();
    expect(screen.getByText("m***@example.com")).toBeInTheDocument();

    // Durum rozeti metinleri filtre dropdown'undaki `<option>` metinleriyle ÇAKIŞTIĞI için
    // sorguyu tabloyla sınırlıyoruz.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Hazırlanıyor")).toBeInTheDocument();
    expect(within(table).getByText("Ödeme Bekleniyor")).toBeInTheDocument();
    expect(within(table).getByText("Başarısız")).toBeInTheDocument();
  });

  it("durum filtresi değiştirildiğinde listOrders ilgili status ile tekrar çağrılır", async () => {
    vi.mocked(ordersApi.listOrders).mockResolvedValue({ items: [], meta: { nextCursor: null } });
    const user = userEvent.setup();

    render(<AdminOrdersPage />);

    await screen.findByText("Henüz sipariş yok");
    await user.selectOptions(screen.getByLabelText("Duruma göre filtrele"), "PAID");

    expect(ordersApi.listOrders).toHaveBeenCalledWith({ status: "PAID" });
  });

  it("'Daha fazla yükle' butonu bir sonraki cursor ile listOrders'ı çağırır ve sonuçları birleştirir", async () => {
    vi.mocked(ordersApi.listOrders)
      .mockResolvedValueOnce({ items: [makeOrder({ id: "order-1", orderNumber: "ORD-0001" })], meta: { nextCursor: "cursor-2" } })
      .mockResolvedValueOnce({ items: [makeOrder({ id: "order-2", orderNumber: "ORD-0002" })], meta: { nextCursor: null } });
    const user = userEvent.setup();

    render(<AdminOrdersPage />);

    await screen.findByText("ORD-0001");
    await user.click(screen.getByRole("button", { name: "Daha fazla yükle" }));

    expect(await screen.findByText("ORD-0002")).toBeInTheDocument();
    expect(screen.getByText("ORD-0001")).toBeInTheDocument();
    expect(ordersApi.listOrders).toHaveBeenCalledWith({ cursor: "cursor-2", status: undefined });
  });
});
