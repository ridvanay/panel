import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InterpreterAssignment } from "@/lib/api/types";

/**
 * Paket AF (Aşama 1) — tercümanın görüşme ekranı: kendiliğinden yeniden bağlanma (hasta/doktor odasıyla AYNI hook),
 * odadan çıkarılınca yeniden bağlanmama, sekme çakışması ekranı, ham hata metninin gizlenmesi ve hasta adının maskelenmesi
 * (tercüman hastayı yalnızca baş harflerle görür; identity ASLA görünmez). Yetki kuralları/token ucu değişmez.
 */
type FakeParticipant = { identity: string; name?: string; metadata?: string; isLocal: boolean };

class FakeRoom {
  handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  disconnect = vi.fn();
  on(ev: string, fn: (...a: unknown[]) => void) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
    return this;
  }
  off(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.get(ev)?.delete(fn);
    return this;
  }
  emit(ev: string, ...args: unknown[]) {
    this.handlers.get(ev)?.forEach((fn) => fn(...args));
  }
}

let room = new FakeRoom();
let participants: FakeParticipant[] = [];
let lkProps: { onDisconnected?: (r?: number) => void; onError?: (e: unknown) => void; onMediaDeviceFailure?: (f?: string) => void } = {};

vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: { children?: React.ReactNode; token: string; onDisconnected?: (r?: number) => void; onError?: (e: unknown) => void; onMediaDeviceFailure?: (f?: string) => void }) => {
    lkProps = props;
    return <div data-testid="lk-room" data-token={props.token}>{props.children}</div>;
  },
  ParticipantTile: ({ trackRef, children }: { trackRef: { participant: FakeParticipant }; children?: React.ReactNode }) => (
    <div data-testid="tile" data-identity={trackRef.participant.identity}>{children}</div>
  ),
  RoomAudioRenderer: () => null,
  TrackToggle: ({ "aria-label": label }: { "aria-label": string }) => <button type="button" aria-label={label} />,
  VideoTrack: () => null,
  isTrackReference: () => true,
  useConnectionState: () => "connected",
  useParticipants: () => participants,
  useTracks: () => participants.map((p) => ({ participant: p, source: "camera" })),
  useRoomContext: () => room,
  useConnectionQualityIndicator: () => ({ quality: "good" }),
  useTrackMutedIndicator: () => ({ isMuted: false }),
}));
vi.mock("livekit-client", () => ({
  ConnectionState: { Connected: "connected" },
  DisconnectReason: { CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2, PARTICIPANT_REMOVED: 4, SIGNAL_CLOSE: 5 },
  RoomEvent: {
    Reconnecting: "reconnecting",
    SignalReconnecting: "signalReconnecting",
    Reconnected: "reconnected",
    ConnectionQualityChanged: "connectionQualityChanged",
    ParticipantDisconnected: "participantDisconnected",
    ParticipantConnected: "participantConnected",
  },
  Track: { Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" } },
}));

let tokenSeq = 0;
const requestInterpreterToken = vi.fn();
const leaveInterpreterSession = vi.fn(async () => undefined);
vi.mock("@/lib/api/interpreter", () => ({
  listInterpreterAssignments: async () => [assignment],
  requestInterpreterToken: (...a: unknown[]) => requestInterpreterToken(...a),
  leaveInterpreterSession: (...a: unknown[]) => leaveInterpreterSession(...(a as [])),
  leaveInterpreterSessionOnUnload: vi.fn(),
  getInterpreterRecordingStatus: async () => ({ status: null }),
}));
vi.mock("@/context/locale-alternates-context", () => ({ useActiveLocaleCode: () => "tr", useLocalizePath: () => (p: string) => p }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { InterpreterRoom } from "@/components/site/interpreter/interpreter-room";

const assignment: InterpreterAssignment = {
  id: "as-1",
  language: "ar",
  languageName: "العربية",
  status: "ASSIGNED",
  startsAt: "2026-11-02T09:00:00.000Z",
  endsAt: "2026-11-02T09:30:00.000Z",
  doctorDisplayName: "H. Sofu",
  patientInitial: "Z. K.",
  canJoin: true,
  past: false,
};

const me: FakeParticipant = { identity: "interpreter:p1:b1", name: "A. Yılmaz · Interpreter (العربية)", metadata: '{"role":"interpreter","language":"ar"}', isLocal: true };
const doctor: FakeParticipant = { identity: "doctor:77bd0977-aaaa", name: "Prof. Dr. D. Yıldırım", isLocal: false };
const patient: FakeParticipant = { identity: "patient:appointment-1", isLocal: false };

async function joinRoom(fake = true) {
  render(<InterpreterRoom assignmentId="as-1" />);
  const user = userEvent.setup({ delay: null });
  await user.click(await screen.findByRole("button", { name: "Katıl" }));
  await screen.findByTestId("lk-room");
  if (fake) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  room = new FakeRoom();
  participants = [me, doctor, patient];
  lkProps = {};
  tokenSeq = 0;
  requestInterpreterToken.mockReset();
  requestInterpreterToken.mockImplementation(async () => {
    tokenSeq += 1;
    return { token: `i${tokenSeq}`, serverUrl: "wss://lk", roomName: "r", expiresAt: "x", sessionId: `s${tokenSeq}` };
  });
  leaveInterpreterSession.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe("tercüman odası — yeniden bağlanma", () => {
  it("kopma → 'Yeniden bağlanılıyor…' katmanı, 2 sn sonra yeni token; ayrılış kaydı yazılmaz; giriş ekranına düşmez", async () => {
    await joinRoom();
    expect(requestInterpreterToken).toHaveBeenCalledTimes(1);
    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnecting-overlay")).toBeInTheDocument();
    expect(screen.queryByTestId("interpreter-join")).not.toBeInTheDocument();
    await advance(2000);
    expect(requestInterpreterToken).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("lk-room")).toHaveAttribute("data-token", "i2");
    expect(leaveInterpreterSession).not.toHaveBeenCalled();
  });

  it("3 deneme tükenince çevrilmiş mesaj + 'Yeniden bağlan'; ayrılış kaydı bir kez yazılır; giriş ekranına düşmez", async () => {
    await joinRoom();
    for (const wait of [2000, 5000, 10_000]) {
      act(() => lkProps.onDisconnected!(5));
      await advance(wait);
    }
    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnect-failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yeniden bağlan" })).toBeInTheDocument();
    expect(requestInterpreterToken).toHaveBeenCalledTimes(4);
    expect(leaveInterpreterSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("interpreter-join")).not.toBeInTheDocument();
  });

  it("DUPLICATE_IDENTITY: otomatik yeniden bağlanma yok, ayrılış kaydı yok; 'Burada devam et' bağlanır", async () => {
    await joinRoom();
    act(() => lkProps.onDisconnected!(2));
    expect(screen.getByTestId("duplicate-identity")).toBeInTheDocument();
    await advance(60_000);
    expect(requestInterpreterToken).toHaveBeenCalledTimes(1);
    expect(leaveInterpreterSession).not.toHaveBeenCalled();
    await act(async () => {
      screen.getByRole("button", { name: "Burada devam et" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requestInterpreterToken).toHaveBeenCalledTimes(2);
  });

  it("odadan çıkarılma (PARTICIPANT_REMOVED) ve kendi ayrılışı (CLIENT_INITIATED) yeniden bağlanma başlatmaz", async () => {
    await joinRoom();
    act(() => lkProps.onDisconnected!(4));
    expect(screen.getByTestId("interpreter-join")).toBeInTheDocument();
    expect(screen.getByText(/odadan çıkarıldınız|çıkarıl/i)).toBeInTheDocument();
    await advance(30_000);
    expect(requestInterpreterToken).toHaveBeenCalledTimes(1);
    expect(leaveInterpreterSession).toHaveBeenCalledTimes(1);
  });

  it("ham SDK hata metni ekranda yok (çevrilmiş mesaj); ilk bağlantı hatasında katılım ekranına mesajla dönülür", async () => {
    await joinRoom(false);
    act(() => lkProps.onError!(new Error("RAW_SDK_MESSAGE_XYZ")));
    await waitFor(() => expect(screen.getByTestId("interpreter-join")).toBeInTheDocument());
    expect(screen.getByText(/Görüşme bağlantısı kurulamadı/)).toBeInTheDocument();
    expect(screen.queryByText(/RAW_SDK_MESSAGE_XYZ/)).not.toBeInTheDocument();
  });
});

describe("tercüman odası — ad etiketleri", () => {
  it("hasta yalnızca baş harflerle ('Z. K.'), doktor token adıyla, kendisi '<ad> · Tercüman (<dil>)'; identity görünmez", async () => {
    await joinRoom();
    const labels = screen.getAllByTestId("tile-label").map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Z. K.", "Prof. Dr. D. Yıldırım", "A. Yılmaz · Tercüman (العربية)"]));
    const text = document.body.textContent ?? "";
    for (const forbidden of ["doctor:", "patient:", "interpreter:", "77bd0977", "Interpreter"]) expect(text).not.toContain(forbidden);
    // Hasta tam adı bu ekrana HİÇ gelmez (veri kaynağında yok; etiket baş harflerden ibaret).
    expect(text).not.toMatch(/Zeynep|Kaya/);
  });

  it("doktor adı token'da yoksa atamadaki görünen ad, o da yoksa rol adı", async () => {
    participants = [me, { identity: "doctor:d1", isLocal: false }, patient];
    await joinRoom();
    expect(screen.getAllByTestId("tile-label").map((el) => el.textContent)).toContain("H. Sofu");
  });
});
