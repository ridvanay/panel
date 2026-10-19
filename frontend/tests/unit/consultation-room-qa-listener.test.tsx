import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QaListenerNotice } from "@/components/site/telehealth/qa-listener-notice";
import userEvent from "@testing-library/user-event";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import { isQaListenerParticipant, QA_LISTENER_NOTICE_TEXT } from "@/components/site/telehealth/qa-listener-notice";
import type { Appointment } from "@/lib/api/types";

/**
 * Paket C (2026-10-18) — kalite kontrol dinleyicisi hasta/doktor ekranında: kalıcı uyarı görünür;
 * katılımcı mantığı (bekleme odası / spotlight) dinleyiciyi "karşı taraf" SAYMAZ.
 * `LiveKitRoom` ve hook'lar stub'lanır (`consultation-room-connection-resilience.test.tsx` deseni);
 * katılımcı/track listeleri test başına ayarlanır.
 */

type FakeParticipant = { identity: string; metadata?: string; isLocal: boolean };
type FakeTrack = { participant: FakeParticipant; source: string };

let participants: FakeParticipant[] = [];
let tracks: FakeTrack[] = [];

vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: { children?: React.ReactNode }) => props.children ?? null,
  ParticipantTile: ({ trackRef }: { trackRef: FakeTrack }) => <div data-testid="tile" data-identity={trackRef.participant.identity} />,
  RoomAudioRenderer: () => null,
  useConnectionState: () => "connected",
  useParticipants: () => participants,
  useRoomContext: () => ({ on: vi.fn(), off: vi.fn(), disconnect: vi.fn() }),
  useTrackToggle: () => ({ enabled: false, pending: false, toggle: vi.fn() }),
  useTracks: () => tracks,
}));
vi.mock("livekit-client", () => ({
  ConnectionState: { Connected: "connected", Disconnected: "disconnected", Reconnecting: "reconnecting", SignalReconnecting: "signal-reconnecting", Connecting: "connecting" },
  DisconnectReason: { CLIENT_INITIATED: "client-initiated" },
  MediaDeviceFailure: { PermissionDenied: "PermissionDenied", NotFound: "NotFound", DeviceInUse: "DeviceInUse", Other: "Other" },
  RoomEvent: { DataReceived: "dataReceived", Reconnected: "reconnected" },
  Track: { Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" } },
}));

const requestMeetingToken = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  getAppointment: vi.fn(async () => makeAppointment()),
  requestMeetingToken: (...args: unknown[]) => requestMeetingToken(...args),
  getRecordingStatus: vi.fn(async () => null),
}));
vi.mock("@/lib/api/modules", () => ({ listPublicModules: vi.fn(async () => []) }));
vi.mock("@/context/auth-context", () => ({
  useAuthOptional: () => ({ status: "authenticated", user: { doctorProfileId: null } }),
}));
vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => "tr",
  useLocalizePath: () => (path: string) => path,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function makeAppointment(): Appointment {
  return {
    id: "appointment-1",
    doctorId: "doctor-1",
    doctor: { id: "doctor-1", title: "Dr.", fullName: "Elif Aydemir", slug: "dr-elif-aydemir" },
    patientUserId: null,
    patientName: "Test Hasta",
    patientEmail: "hasta@example.com",
    startsAt: "2026-09-22T09:00:00.000Z",
    endsAt: "2026-09-22T09:30:00.000Z",
    status: "IN_PROGRESS",
    priceCents: 50000,
    currency: "TRY",
    startedAt: null,
    endedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const local: FakeParticipant = { identity: "patient:appointment-1", isLocal: true };
const doctor: FakeParticipant = { identity: "doctor:doctor-1", isLocal: false };
const listener: FakeParticipant = { identity: "qa-listener-admin-1", metadata: JSON.stringify({ role: "qa_listener" }), isLocal: false };

async function renderJoined() {
  render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Görüşmeye Katıl" }));
  await waitFor(() => expect(requestMeetingToken).toHaveBeenCalled());
}

describe("isQaListenerParticipant", () => {
  it("sunucu imzalı kimlik ön eki veya `role: qa_listener` metadata'sı ile eşleşir", () => {
    expect(isQaListenerParticipant({ identity: "qa-listener-u1" })).toBe(true);
    expect(isQaListenerParticipant({ identity: "x", metadata: '{"role":"qa_listener"}' })).toBe(true);
    expect(isQaListenerParticipant({ identity: "doctor:d1" })).toBe(false);
    expect(isQaListenerParticipant({ identity: "patient:a1", metadata: "bozuk-json" })).toBe(false);
  });
});

describe("ConsultationRoom — kalite kontrol dinleyicisi", () => {
  beforeEach(() => {
    requestMeetingToken.mockReset();
    requestMeetingToken.mockResolvedValue({ token: "t1", serverUrl: "wss://lk.example.com", roomName: "r1", expiresAt: "2026-09-22T12:00:00.000Z" });
  });

  it("dinleyici yokken uyarı GÖRÜNMEZ", async () => {
    participants = [local, doctor];
    tracks = [{ participant: doctor, source: "camera" }];
    await renderJoined();
    expect(screen.queryByText(QA_LISTENER_NOTICE_TEXT)).not.toBeInTheDocument();
    expect(screen.getByTestId("tile")).toHaveAttribute("data-identity", "doctor:doctor-1");
  });

  it("dinleyici varken kalıcı uyarı ve 'WM Health – Kalite Kontrol' adı GÖRÜNÜR (kapatma düğmesi yok)", async () => {
    participants = [local, doctor, listener];
    tracks = [{ participant: doctor, source: "camera" }];
    await renderJoined();
    const banner = screen.getByText(QA_LISTENER_NOTICE_TEXT).closest('[role="status"]');
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/Katılımcı: WM Health – Kalite Kontrol/)).toBeInTheDocument();
    expect(banner!.querySelector("button")).toBeNull();
  });

  it("yalnızca dinleyici varken karşı taraf SAYILMAZ — bekleme odası görünür", async () => {
    participants = [local, listener];
    tracks = [{ participant: listener, source: "camera" }];
    await renderJoined();
    expect(screen.getByText("Bekleme Odası")).toBeInTheDocument();
    expect(screen.queryByTestId("tile")).not.toBeInTheDocument();
    expect(screen.getByText(QA_LISTENER_NOTICE_TEXT)).toBeInTheDocument();
  });

  it("dinleyicinin placeholder track'i doktorun yerine spotlight'a ÇIKMAZ", async () => {
    participants = [local, listener, doctor];
    tracks = [
      { participant: listener, source: "camera" },
      { participant: doctor, source: "camera" },
    ];
    await renderJoined();
    expect(screen.getByTestId("tile")).toHaveAttribute("data-identity", "doctor:doctor-1");
  });

  it("dinleyici ayrılınca uyarı ekrandan kalkar", () => {
    participants = [local, doctor, listener];
    const { rerender } = render(<QaListenerNotice />);
    expect(screen.getByText(QA_LISTENER_NOTICE_TEXT)).toBeInTheDocument();
    participants = [local, doctor];
    rerender(<QaListenerNotice />);
    expect(screen.queryByText(QA_LISTENER_NOTICE_TEXT)).not.toBeInTheDocument();
  });
});
