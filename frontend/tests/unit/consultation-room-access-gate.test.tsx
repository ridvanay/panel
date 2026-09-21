import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import type { Appointment } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";

/**
 * Bug-fix turu (2026-09-21, kullanıcı talebi) — `/consultation/[id]` sayfası yetkisiz/doğrudan
 * erişimde çökmek yerine temiz bir ekran göstermeli. Bu dosya `ConsultationRoom`'un ön doğrulama
 * katmanını (gatekeeper) ve yükleme hatası durumunu, `@livekit/components-react`/`livekit-client`
 * gibi ağır/gerçek WebRTC bağımlılıklarını STUB'layarak izole test eder — bu testler o SDK'ların
 * DAVRANIŞINI değil, yalnızca `ConsultationRoom`'un erişim/veri durumuna göre HANGİ paneli
 * render ettiğini doğrular (LiveKit'in kendisi zaten `telehealth-consultation.spec.ts` e2e'sinde
 * gerçek tarayıcıyla kapsanıyor).
 */

vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: () => null,
  ParticipantTile: () => null,
  RoomAudioRenderer: () => null,
  useConnectionState: () => "connected",
  useParticipants: () => [],
  useRoomContext: () => ({ on: vi.fn(), off: vi.fn() }),
  useTrackToggle: () => ({ enabled: false, pending: false, toggle: vi.fn() }),
  useTracks: () => [],
}));
vi.mock("livekit-client", () => ({
  ConnectionState: { Connected: "connected", Disconnected: "disconnected", Reconnecting: "reconnecting", SignalReconnecting: "signal-reconnecting", Connecting: "connecting" },
  DisconnectReason: { CLIENT_INITIATED: "client-initiated" },
  RoomEvent: { DataReceived: "dataReceived", Reconnected: "reconnected" },
  Track: { Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" } },
}));

const getAppointment = vi.fn();
const requestMeetingToken = vi.fn();
const getRecordingStatus = vi.fn();

vi.mock("@/lib/api/telehealth", () => ({
  getAppointment: (...args: unknown[]) => getAppointment(...args),
  requestMeetingToken: (...args: unknown[]) => requestMeetingToken(...args),
  getRecordingStatus: (...args: unknown[]) => getRecordingStatus(...args),
}));

vi.mock("@/lib/api/modules", () => ({
  listPublicModules: vi.fn(async () => []),
}));

let mockAuth: { status: "loading" | "authenticated" | "unauthenticated"; user: { doctorProfileId: string | null } | null } = {
  status: "unauthenticated",
  user: null,
};
vi.mock("@/context/auth-context", () => ({
  useAuthOptional: () => mockAuth,
}));

vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => "tr",
  useLocalizePath: () => (path: string) => path,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    doctorId: "doctor-1",
    doctor: { id: "doctor-1", title: "Dr.", fullName: "Elif Aydemir", slug: "dr-elif-aydemir" },
    patientUserId: null,
    patientName: "Test Hasta",
    patientEmail: "hasta@example.com",
    startsAt: "2026-09-22T09:00:00.000Z",
    endsAt: "2026-09-22T09:30:00.000Z",
    status: "SCHEDULED",
    priceCents: 50000,
    currency: "TRY",
    startedAt: null,
    endedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ConsultationRoom — erişim ön doğrulama (gatekeeper)", () => {
  beforeEach(() => {
    getAppointment.mockReset();
    requestMeetingToken.mockReset();
    getRecordingStatus.mockReset();
    mockAuth = { status: "unauthenticated", user: null };
  });

  it("oturum yok VE `?t=` token yoksa: API HİÇ çağrılmadan 'Erişim Doğrulama Gerekli' ekranı gösterilir, 'Giriş Yap' /consultation/{id}'ye döner", async () => {
    render(<ConsultationRoom appointmentId="appointment-1" />);

    await waitFor(() => expect(screen.getByText("Erişim Doğrulama Gerekli")).toBeInTheDocument());
    expect(getAppointment).not.toHaveBeenCalled();

    const loginLink = screen.getByRole("link", { name: /Giriş Yap/ });
    expect(loginLink).toHaveAttribute("href", `/login?next=${encodeURIComponent("/consultation/appointment-1")}`);
  });

  it("oturum durumu HENÜZ çözülmemişse (`loading`) iskelet gösterilir, erişim reddi ekranı ERKEN gösterilmez", () => {
    mockAuth = { status: "loading", user: null };
    const { container } = render(<ConsultationRoom appointmentId="appointment-1" />);

    expect(screen.queryByText("Erişim Doğrulama Gerekli")).not.toBeInTheDocument();
    expect(getAppointment).not.toHaveBeenCalled();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("geçerli bir `?t=` misafir token'ı varsa oturum olmasa bile randevu normal şekilde sorgulanır", async () => {
    getAppointment.mockResolvedValue(makeAppointment());
    render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token-abc" />);

    await waitFor(() => expect(getAppointment).toHaveBeenCalledWith("appointment-1", "guest-token-abc"));
    await waitFor(() => expect(screen.getByText(/Dr\. Elif Aydemir ile Görüşme/)).toBeInTheDocument());
    expect(screen.queryByText("Erişim Doğrulama Gerekli")).not.toBeInTheDocument();
  });

  it("oturum açmış kullanıcı için randevu sorgulanır ve başarıyla yüklenirse oda kabul ekranı render edilir", async () => {
    mockAuth = { status: "authenticated", user: { doctorProfileId: null } };
    getAppointment.mockResolvedValue(makeAppointment());
    render(<ConsultationRoom appointmentId="appointment-1" />);

    await waitFor(() => expect(getAppointment).toHaveBeenCalledWith("appointment-1", undefined));
    expect(await screen.findByText(/ile Görüşme/)).toBeInTheDocument();
    expect(screen.getByText("Görüşmeye Katıl")).toBeInTheDocument();
  });

  it("`doctor`/`patientName` eksik/null gelse bile (savunmacı erişim) çökmez, güvenli bir varsayılanla render eder", async () => {
    mockAuth = { status: "authenticated", user: { doctorProfileId: null } };
    getAppointment.mockResolvedValue(
      makeAppointment({ doctor: null as unknown as Appointment["doctor"], patientName: null as unknown as string })
    );
    render(<ConsultationRoom appointmentId="appointment-1" />);

    expect(await screen.findByText("Doktor ile Görüşme")).toBeInTheDocument();
    expect(screen.getByText(/Hasta/)).toBeInTheDocument();
  });

  it("API 404 (yetkisiz/geçersiz token) ile reddederse çökmez, satır içi hata + 'Tekrar Dene' gösterir", async () => {
    mockAuth = { status: "authenticated", user: { doctorProfileId: null } };
    getAppointment.mockRejectedValue(new ApiClientError(404, { code: "NOT_FOUND", message: "Randevu bulunamadı." }, "req-1"));
    render(<ConsultationRoom appointmentId="appointment-1" />);

    expect(await screen.findByText("Randevu bulunamadı.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tekrar Dene" })).toBeInTheDocument();
  });
});
