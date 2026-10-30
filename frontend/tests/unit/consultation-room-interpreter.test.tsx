import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import { QA_LISTENER_NOTICE_TEXT } from "@/components/site/telehealth/qa-listener-notice";
import { interpreterLanguageOf, isInterpreterParticipant } from "@/components/site/interpreter/interpreter-participant";
import type { Appointment } from "@/lib/api/types";

/**
 * Paket AA — hasta/doktor görüşme odasında tercüman: 3. kutu ve "Tercüman · dil" etiketi; spotlight
 * karşı taraf kalır; katıldı/ayrıldı bildirimi; yalnızca doktorda "Görüşmeden çıkar" (onay penceresiyle);
 * dinleyiciyle birlikte üç rolün ayrımı; ön-katılımda "Bu görüşmeye bir tercüman katılıyor." satırı.
 * `consultation-room-qa-listener.test.tsx` ile aynı LiveKit stub deseni.
 */
type FakeParticipant = { identity: string; metadata?: string; isLocal: boolean };
type FakeTrack = { participant: FakeParticipant; source: string };

let participants: FakeParticipant[] = [];
let tracks: FakeTrack[] = [];
let doctorSession = false;

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
const removeAppointmentInterpreter = vi.fn(async () => undefined);
const getAppointmentInterpreter = vi.fn();
vi.mock("@/lib/api/interpreter", () => ({
  removeAppointmentInterpreter: (...args: unknown[]) => removeAppointmentInterpreter(...(args as [])),
  getAppointmentInterpreter: (...args: unknown[]) => getAppointmentInterpreter(...args),
}));
vi.mock("@/lib/api/modules", () => ({ listPublicModules: vi.fn(async () => []) }));
vi.mock("@/context/auth-context", () => ({
  useAuthOptional: () => ({ status: "authenticated", user: { doctorProfileId: doctorSession ? "doctor-1" : null } }),
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
  } as Appointment;
}

const local: FakeParticipant = { identity: "patient:appointment-1", isLocal: true };
const doctor: FakeParticipant = { identity: "doctor:doctor-1", isLocal: false };
const interpreter: FakeParticipant = { identity: "interpreter:p1:b1", metadata: JSON.stringify({ role: "interpreter", language: "ar" }), isLocal: false };
const listener: FakeParticipant = { identity: "qa-listener-admin-1", metadata: JSON.stringify({ role: "qa_listener" }), isLocal: false };

async function renderJoined() {
  const view = render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Görüşmeye Katıl" }));
  await waitFor(() => expect(requestMeetingToken).toHaveBeenCalled());
  return { ...view, user };
}

describe("tercüman katılımcısı ayrımı", () => {
  it("kimlik öneki ya da `role: interpreter` metadata'sı; dil metadata'dan; dinleyici tercüman sayılmaz", () => {
    expect(isInterpreterParticipant(interpreter)).toBe(true);
    expect(isInterpreterParticipant({ identity: "x", metadata: '{"role":"interpreter"}' })).toBe(true);
    expect(isInterpreterParticipant(listener)).toBe(false);
    expect(isInterpreterParticipant(doctor)).toBe(false);
    expect(interpreterLanguageOf(interpreter)).toBe("ar");
  });
});

describe("ConsultationRoom — tercüman", () => {
  beforeEach(() => {
    doctorSession = false;
    requestMeetingToken.mockReset();
    requestMeetingToken.mockResolvedValue({ token: "t1", serverUrl: "wss://lk.example.com", roomName: "r1", expiresAt: "2026-09-22T12:00:00.000Z" });
    removeAppointmentInterpreter.mockClear();
    getAppointmentInterpreter.mockReset();
    getAppointmentInterpreter.mockResolvedValue(null);
  });

  it("tercüman 3. kutu, 'Tercüman · العربية' etiketiyle; spotlight doktor kalır; hastada çıkarma düğmesi yok", async () => {
    participants = [local, doctor, interpreter];
    tracks = [
      { participant: interpreter, source: "camera" },
      { participant: doctor, source: "camera" },
    ];
    await renderJoined();
    const box = screen.getByTestId("interpreter-tile");
    expect(within(box).getByTestId("tile")).toHaveAttribute("data-identity", "interpreter:p1:b1");
    expect(box).toHaveTextContent("Tercüman · العربية");
    const spotlight = screen.getAllByTestId("tile").find((el) => !box.contains(el));
    expect(spotlight).toHaveAttribute("data-identity", "doctor:doctor-1");
    expect(screen.queryByTestId("interpreter-remove")).not.toBeInTheDocument();
  });

  it("yalnızca tercüman varken karşı taraf sayılmaz (bekleme odası)", async () => {
    participants = [local, interpreter];
    tracks = [{ participant: interpreter, source: "camera" }];
    await renderJoined();
    expect(screen.getByText("Bekleme Odası")).toBeInTheDocument();
    expect(screen.getByTestId("interpreter-tile")).toBeInTheDocument();
  });

  it("katıldı / ayrıldı bildirimi bir kez gösterilir", async () => {
    participants = [local, doctor];
    tracks = [{ participant: doctor, source: "camera" }];
    const { rerender } = await renderJoined();
    expect(screen.queryByTestId("interpreter-notice")).not.toBeInTheDocument();
    participants = [local, doctor, interpreter];
    tracks = [...tracks, { participant: interpreter, source: "camera" }];
    rerender(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    expect(await screen.findByText("Tercüman görüşmeye katıldı.")).toBeInTheDocument();
    participants = [local, doctor];
    tracks = [{ participant: doctor, source: "camera" }];
    rerender(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    expect(await screen.findByText("Tercüman görüşmeden ayrıldı.")).toBeInTheDocument();
  });

  it("doktor 'Görüşmeden çıkar' → onay penceresi → sunucu çağrısı", async () => {
    doctorSession = true;
    participants = [local, doctor, interpreter];
    tracks = [
      { participant: doctor, source: "camera" },
      { participant: interpreter, source: "camera" },
    ];
    const { user } = await renderJoined();
    await user.click(screen.getByRole("button", { name: "Görüşmeden çıkar" }));
    expect(await screen.findByText("Tercüman çıkarılsın mı?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Çıkar" }));
    await waitFor(() => expect(removeAppointmentInterpreter).toHaveBeenCalledWith("appointment-1"));
  });

  it("dinleyici + tercüman + doktor: üç rol ayrı — dinleyici uyarısı, tercüman kutusu, spotlight doktor", async () => {
    participants = [local, listener, interpreter, doctor];
    tracks = [
      { participant: listener, source: "camera" },
      { participant: interpreter, source: "camera" },
      { participant: doctor, source: "camera" },
    ];
    await renderJoined();
    expect(screen.getByText(QA_LISTENER_NOTICE_TEXT)).toBeInTheDocument();
    const box = screen.getByTestId("interpreter-tile");
    expect(within(box).getByTestId("tile")).toHaveAttribute("data-identity", "interpreter:p1:b1");
    const others = screen.getAllByTestId("tile").filter((el) => !box.contains(el)).map((el) => el.getAttribute("data-identity"));
    expect(others).toEqual(["doctor:doctor-1"]);
  });

  it("ön-katılım: atanmış tercüman varsa tek satır bilgi", async () => {
    getAppointmentInterpreter.mockResolvedValue({ language: "ar", languageName: "العربية", displayName: "A. Yılmaz", status: "ASSIGNED" });
    participants = [];
    tracks = [];
    render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    const line = await screen.findByTestId("interpreter-prejoin-notice");
    expect(line).toHaveTextContent("Bu görüşmeye bir tercüman katılıyor.");
    expect(line).toHaveTextContent("A. Yılmaz");
    expect(getAppointmentInterpreter).toHaveBeenCalledWith("appointment-1", "guest-token");
  });
});
