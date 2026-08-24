import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import AdminOrdersPage from "@/app/admin/orders/page";
import type { Order } from "@/lib/api/types";

vi.mock("@/lib/api/orders", () => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

const ordersApi = await import("@/lib/api/orders");

const axeOptions = { rules: { region: { enabled: false } } };

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

describe("AdminOrdersPage — a11y", () => {
  it("boş sipariş listesinde kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(ordersApi.listOrders).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    const { container } = render(<AdminOrdersPage />);

    expect(await screen.findByText("Henüz sipariş yok")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("PENDING/PAID/FAILED durumlarını içeren sipariş listesi yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    const orders = [
      makeOrder({ id: "order-1", orderNumber: "ORD-0001", status: "PENDING" }),
      makeOrder({ id: "order-2", orderNumber: "ORD-0002", status: "PAID" }),
      makeOrder({ id: "order-3", orderNumber: "ORD-0003", status: "FAILED" }),
    ];
    vi.mocked(ordersApi.listOrders).mockResolvedValue({ items: orders, meta: { nextCursor: null } });

    const { container } = render(<AdminOrdersPage />);

    expect(await screen.findByText("ORD-0001")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
