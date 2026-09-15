import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 §1.5 — `demoPayBooking`,
 * `createBookingCheckoutSession` İLE AYNI imza/desende `POST /appointments/bookings/{id}/demo-pay`
 * çağırmalı; `?t=` misafir erişim token'ı VARSA sorgu dizesine taşınmalı, YOKSA hiç eklenmemeli.
 */
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
  init: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

describe("demoPayBooking (lib/api/telehealth.ts)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST /appointments/bookings/{id}/demo-pay çağırır ve accessToken'ı ?t= olarak taşır", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: "booking-1", paymentStatus: "PAID" } }), { status: 200 }));

    const { demoPayBooking } = await import("@/lib/api/telehealth");
    const result = await demoPayBooking("booking-1", "magic-token-abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/appointments/bookings/booking-1/demo-pay");
    expect(url).toContain("t=magic-token-abc");
    expect(init.method).toBe("POST");
    expect(result).toEqual({ id: "booking-1", paymentStatus: "PAID" });
  });

  it("accessToken verilmezse ?t= sorgu parametresi EKLENMEZ (oturumlu hasta akışı)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: "booking-2", paymentStatus: "PAID" } }), { status: 200 }));

    const { demoPayBooking } = await import("@/lib/api/telehealth");
    await demoPayBooking("booking-2");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("t=");
  });

  it("404 (uç kapalı/register edilmemiş) ApiClientError olarak fırlatılır", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Bulunamadı." } }), { status: 404 })
    );

    const { demoPayBooking } = await import("@/lib/api/telehealth");
    const { ApiClientError } = await import("@/lib/api/error");

    await expect(demoPayBooking("booking-3")).rejects.toBeInstanceOf(ApiClientError);
  });

  it("409 (zaten ödenmiş — BOOKING_NOT_PAYABLE) ApiClientError olarak fırlatılır", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BOOKING_NOT_PAYABLE", message: "Bu rezervasyon zaten ödenmiş." } }), {
        status: 409,
      })
    );

    const { demoPayBooking } = await import("@/lib/api/telehealth");
    const { ApiClientError } = await import("@/lib/api/error");

    try {
      await demoPayBooking("booking-4");
      throw new Error("beklenen hata fırlatılmadı");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as InstanceType<typeof ApiClientError>).status).toBe(409);
    }
  });
});
