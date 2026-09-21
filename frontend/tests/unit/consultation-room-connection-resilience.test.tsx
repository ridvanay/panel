import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import type { Appointment, MeetingTokenResponse } from "@/lib/api/types";

/**
 * Bug-fix turu (2026-09-21, kullanıcı talebi) — "Bağlanıyor…"da sonsuza dek takılı kalma raporu.
 * Kök neden: `<LiveKitRoom>`in `onDisconnected`'ı YALNIZCA ÖNCE KURULMUŞ bir bağlantı koptuğunda
 * tetiklenir; `room.connect()`'in KENDİSİ (ilk WS/ICE handshake) başarısız olursa NE
 * `onDisconnected` NE DE herhangi bir yerel state güncellenirdi. Bu dosya, `LiveKitRoom`'u
 * gerçek WebRTC/SDK davranışı OLMADAN, yalnızca `onError`/`onMediaDeviceFailure`
 * callback'lerini DIŞARIDAN tetiklenebilir bir stub'a indirgeyerek, `consultation-room.tsx`'in bu
 * callback'leri doğru bağladığını VE UI'ı çıkmaz bir "Bağlanıyor…" durumunda BIRAKMADIĞINI
 * doğrular.
 */

vi.mock("@livekit/components-styles", () => ({}));

let capturedLiveKitProps: { onError?: (err: Error) => void; onMediaDeviceFailure?: (failure?: string) => void } = {};
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: {
    children?: React.ReactNode;
    onError?: (err: Error) => void;
    onMediaDeviceFailure?: (failure?: string) => void;
  }) => {
    capturedLiveKitProps = { onError: props.onError, onMediaDeviceFailure: props.onMediaDeviceFailure };
    return props.children ?? null;
  },
  ParticipantTile: () => null,
  RoomAudioRenderer: () => null,
  useConnectionState: () => "connecting",
  useParticipants: () => [],
  useRoomContext: () => ({ on: vi.fn(), off: vi.fn(), disconnect: vi.fn() }),
  useTrackToggle: () => ({ enabled: false, pending: false, toggle: vi.fn() }),
  useTracks: () => [],
}));
vi.mock("livekit-client", () => ({
  ConnectionState: { Connected: "connected", Disconnected: "disconnected", Reconnecting: "reconnecting", SignalReconnecting: "signal-reconnecting", Connecting: "connecting" },
  DisconnectReason: { CLIENT_INITIATED: "client-initiated" },
  MediaDeviceFailure: { PermissionDenied: "PermissionDenied", NotFound: "NotFound", DeviceInUse: "DeviceInUse", Other: "Other" },
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

vi.mock("@/context/auth-context", () => ({
  useAuthOptional: () => ({ status: "authenticated", user: { doctorProfileId: null } }),
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

function makeMeeting(overrides: Partial<MeetingTokenResponse> = {}): MeetingTokenResponse {
  return {
    token: "meeting-token-abc",
    serverUrl: "wss://livekit.example.com",
    roomName: "room-appointment-1",
    expiresAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
  };
}

async function joinRoom() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Görüşmeye Katıl" }));
  await waitFor(() => expect(requestMeetingToken).toHaveBeenCalled());
}

describe("ConsultationRoom — LiveKit bağlantı hatası dayanıklılığı", () => {
  beforeEach(() => {
    getAppointment.mockReset();
    requestMeetingToken.mockReset();
    getRecordingStatus.mockReset();
    getRecordingStatus.mockResolvedValue(null);
    capturedLiveKitProps = {};
  });

  it("`room.connect()` ilk denemede başarısız olursa (`onError`) kullanıcı 'Bağlanıyor…'da ASILI KALMAZ — ön-katılım ekranına açık bir hatayla döner", async () => {
    getAppointment.mockResolvedValue(makeAppointment());
    requestMeetingToken.mockResolvedValue(makeMeeting());
    render(<ConsultationRoom appointmentId="appointment-1" />);

    await joinRoom();
    await waitFor(() => expect(capturedLiveKitProps.onError).toBeInstanceOf(Function));

    act(() => {
      capturedLiveKitProps.onError!(new Error("WebSocket bağlantısı kurulamadı"));
    });

    expect(await screen.findByText("WebSocket bağlantısı kurulamadı")).toBeInTheDocument();
    // Ön-katılım ekranına dönüldü — "Görüşmeye Katıl" butonu tekrar görünür (çıkmaz durum YOK).
    expect(screen.getByRole("button", { name: "Görüşmeye Katıl" })).toBeInTheDocument();
  });

  it("kamera/mikrofon izni reddedilirse (`onMediaDeviceFailure`) anlaşılır bir Türkçe hata gösterilir", async () => {
    getAppointment.mockResolvedValue(makeAppointment());
    requestMeetingToken.mockResolvedValue(makeMeeting());
    render(<ConsultationRoom appointmentId="appointment-1" />);

    await joinRoom();
    await waitFor(() => expect(capturedLiveKitProps.onMediaDeviceFailure).toBeInstanceOf(Function));

    act(() => {
      capturedLiveKitProps.onMediaDeviceFailure!("PermissionDenied");
    });

    expect(await screen.findByText(/Kamera\/mikrofon izni reddedildi/)).toBeInTheDocument();
  });
});
