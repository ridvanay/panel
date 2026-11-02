import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { AdminBookingDetail } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";

/** Paket AG (İş 2) — `/admin/telehealth/bookings/[id]` salt-okunur detay sayfası (bildirim bağlantısının hedefi). */
const getAdminBooking = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({ getAdminBooking: (...args: unknown[]) => getAdminBooking(...args) }));

import AdminBookingDetailPage from "@/app/admin/telehealth/bookings/[id]/page";

const BOOKING = {
  id: "b-1",
  bookingNumber: "BKG-1024-ABCD",
  doctor: { title: "Op. Dr.", fullName: "Mehmet Demir" },
  patientName: "Zeynep Yılmaz",
  patientEmail: "zeynep@example.com",
  patientTimeZone: "Europe/Berlin",
  locale: "de",
  interpreterLanguage: "ar",
  totalCents: 50000,
  currency: "TRY",
  paymentStatus: "PAID",
  paidBy: "stripe",
  archivedAt: null,
  appointments: [
    { id: "a-1", startsAt: "2026-11-12T10:30:00.000Z", endsAt: "2026-11-12T11:00:00.000Z", status: "SCHEDULED", cancelReason: null },
    { id: "a-2", startsAt: "2026-11-13T10:30:00.000Z", endsAt: "2026-11-13T11:00:00.000Z", status: "CANCELLED", cancelReason: "Hasta istedi" },
  ],
} as unknown as AdminBookingDetail;

async function renderPage(id = "b-1") {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <AdminBookingDetailPage params={Promise.resolve({ id })} />
      </Suspense>
    );
  });
}

describe("AdminBookingDetailPage", () => {
  beforeEach(() => {
    getAdminBooking.mockReset();
  });

  it("id ile getAdminBooking çağırır; no, hekim, ödeme, tercüman, hasta ve randevuları gösterir", async () => {
    getAdminBooking.mockResolvedValue(BOOKING);
    await renderPage("b-1");
    expect(getAdminBooking).toHaveBeenCalledWith("b-1");
    expect(await screen.findByRole("heading", { level: 1, name: /BKG-1024-ABCD/ })).toBeInTheDocument();
    expect(screen.getByText("Op. Dr. Mehmet Demir")).toBeInTheDocument();
    expect(screen.getByText("Ödendi")).toBeInTheDocument();
    expect(screen.getByText("Kart (Stripe)")).toBeInTheDocument();
    expect(screen.getByText(/Var \(.*\(ar\)\)/)).toBeInTheDocument();
    expect(screen.getByText("Zeynep Yılmaz")).toBeInTheDocument();
    expect(screen.getByText("zeynep@example.com")).toBeInTheDocument();
    expect(screen.getByText("Planlandı")).toBeInTheDocument();
    expect(screen.getByText("İptal edildi")).toBeInTheDocument();
    expect(screen.getByText("Hasta istedi")).toBeInTheDocument();
    expect(screen.getByText("60 dk")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rezervasyonlara dön/ })).toHaveAttribute("href", "/admin/telehealth/bookings");
  });

  it("tercüman talebi yoksa 'Yok' yazar", async () => {
    getAdminBooking.mockResolvedValue({ ...BOOKING, interpreterLanguage: null });
    await renderPage();
    expect(await screen.findByText("Yok")).toBeInTheDocument();
  });

  it("hata durumunda mesaj ve 'Tekrar Dene' gösterir", async () => {
    getAdminBooking.mockImplementation(() => Promise.reject(new ApiClientError(500, { code: "INTERNAL_ERROR" as never, message: "Sunucu hatası" })));
    await renderPage();
    expect(await screen.findByRole("button", { name: "Tekrar Dene" })).toBeInTheDocument();
  });
});
