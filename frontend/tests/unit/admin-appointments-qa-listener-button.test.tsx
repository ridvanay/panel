import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Appointment, AppointmentStatus } from "@/lib/api/types";

/**
 * Paket C — admin Randevular ekranı: "Dinleyici olarak katıl" YALNIZCA ADMIN'e ve YALNIZCA
 * `IN_PROGRESS` satırlarda görünür; 2FA kapalıysa pasif + 2FA ayarları bağlantısı. MANAGER hiç görmez.
 */

let authUser: { role: string; twoFactorEnabled: boolean } = { role: "ADMIN", twoFactorEnabled: true };
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: authUser }) }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => new Date("2026-10-18T10:05:00.000Z").getTime() }));
vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({ LiveKitRoom: () => null, RoomAudioRenderer: () => null, useConnectionState: () => "connected", useParticipants: () => [] }));
vi.mock("livekit-client", () => ({ ConnectionState: { Connected: "connected" } }));

function makeAppointment(id: string, status: AppointmentStatus): Appointment {
  return {
    id,
    doctorId: "doc-1",
    doctor: { id: "doc-1", title: "Dr.", fullName: "Ayşe Yılmaz", slug: "ayse-yilmaz" },
    patientUserId: null,
    patientName: `Hasta ${status}`,
    patientEmail: "hasta@example.com",
    startsAt: "2026-10-18T10:00:00.000Z",
    endsAt: "2026-10-18T10:30:00.000Z",
    status,
    priceCents: 0,
    currency: "TRY",
    startedAt: null,
    endedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-10-18T09:00:00.000Z",
    updatedAt: "2026-10-18T09:00:00.000Z",
  };
}

vi.mock("@/lib/api/telehealth", () => ({
  listAdminAppointments: vi.fn(async () => ({
    items: [makeAppointment("a-1", "IN_PROGRESS"), makeAppointment("a-2", "SCHEDULED"), makeAppointment("a-3", "COMPLETED")],
    nextCursor: null,
  })),
}));

import AdminTelehealthAppointmentsPage from "@/app/admin/telehealth/appointments/page";

const JOIN_LABEL = /görüşmesine dinleyici olarak katıl/;

describe("Admin Randevular — dinleyici butonu", () => {
  beforeEach(() => {
    authUser = { role: "ADMIN", twoFactorEnabled: true };
  });

  it("2FA'lı ADMIN: yalnızca IN_PROGRESS satırında aktif buton; geçmiş her satırda", async () => {
    render(<AdminTelehealthAppointmentsPage />);
    const buttons = await screen.findAllByRole("button", { name: JOIN_LABEL });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('"Hasta IN_PROGRESS" görüşmesine dinleyici olarak katıl');
    expect(buttons[0]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /dinleyici geçmişi/ })).toHaveLength(3);
  });

  it("2FA'sız ADMIN: buton pasif ve 2FA ayarları bağlantısı gösterilir", async () => {
    authUser = { role: "ADMIN", twoFactorEnabled: false };
    render(<AdminTelehealthAppointmentsPage />);
    const [button] = await screen.findAllByRole("button", { name: JOIN_LABEL });
    expect(button).toBeDisabled();
    expect(screen.getByRole("link", { name: "2FA ayarları" })).toHaveAttribute("href", "/admin/settings/security");
  });

  it("MANAGER: dinleyici butonu ve geçmiş hiç görünmez", async () => {
    authUser = { role: "MANAGER", twoFactorEnabled: true };
    render(<AdminTelehealthAppointmentsPage />);
    await screen.findByText("Hasta IN_PROGRESS");
    expect(screen.queryByRole("button", { name: JOIN_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dinleyici geçmişi/ })).not.toBeInTheDocument();
  });
});
