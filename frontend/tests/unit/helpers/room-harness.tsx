/**
 * Paket AF (Aşama 2) — görüşme odası testleri için ortak LiveKit sahte katmanı. `vi.mock` fabrikalarından dinamik `import`
 * ile kullanılır (bkz. room-*.test.tsx). Gerçek WebRTC/SDK YOK; `FakeRoom` olay yayıcıdır, `harness` testlerin sürdüğü durumdur.
 */
import { useEffect, useState, type ReactNode } from "react";
import { vi } from "vitest";
import type { Appointment } from "@/lib/api/types";

export type FakeParticipant = { identity: string; name?: string; metadata?: string; isLocal: boolean };
export type FakeTrack = { participant: FakeParticipant; source: string };

export class FakeRoom {
  handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  /** Bağlantıyı etkileyen çağrıların sayacı: testler "hiçbiri çağrılmadı" doğrular. */
  connect = vi.fn();
  disconnect = vi.fn();
  switchActiveDevice = vi.fn<(kind: string, id: string) => Promise<boolean>>(async () => true);
  activeDevices: Record<string, string> = {};
  publications: Record<string, { videoTrack?: unknown; audioTrack?: unknown }> = {};
  localParticipant = {
    getTrackPublication: (source: string) => this.publications[source],
  };
  getActiveDevice = (kind: string) => this.activeDevices[kind];
  on(ev: string | undefined, fn: (...a: unknown[]) => void) {
    const key = String(ev);
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(fn);
    return this;
  }
  off(ev: string | undefined, fn: (...a: unknown[]) => void) {
    this.handlers.get(String(ev))?.delete(fn);
    return this;
  }
  emit(ev: string, ...args: unknown[]) {
    this.handlers.get(ev)?.forEach((fn) => fn(...args));
  }
}

export const local: FakeParticipant = { identity: "patient:p1", isLocal: true };
export const doctor: FakeParticipant = { identity: "doctor:doctor-1", name: "Dr. Elif Aydemir", isLocal: false };
export const interpreter: FakeParticipant = {
  identity: "interpreter:p1:b1",
  name: "A. Yılmaz · Tercüman (العربية)",
  metadata: JSON.stringify({ role: "interpreter", language: "ar" }),
  isLocal: false,
};

export interface ToggleState {
  enabled: boolean;
  pending: boolean;
  toggle: ReturnType<typeof vi.fn>;
}

export const harness = {
  room: new FakeRoom(),
  participants: [] as FakeParticipant[],
  tracks: [] as FakeTrack[],
  connState: "connected",
  localeCode: "tr",
  doctorSession: false,
  appointmentOverride: {} as Partial<Appointment>,
  lkProps: {} as Record<string, unknown> & { token?: string; options?: unknown; video?: unknown; audio?: unknown },
  /** `<LiveKitRoom>` her (yeniden) mount olduğunda bir kayıt — "oda yeniden kurulmadı" doğrulaması. */
  mounts: [] as string[],
  unmounts: 0,
  toggles: {} as Record<string, ToggleState>,
  requestMeetingToken: vi.fn(),
  listeners: new Set<() => void>(),
  reset() {
    this.room = new FakeRoom();
    this.participants = [];
    this.tracks = [];
    this.connState = "connected";
    this.localeCode = "tr";
    this.doctorSession = false;
    this.appointmentOverride = {};
    this.lkProps = {};
    this.mounts = [];
    this.unmounts = 0;
    this.listeners.clear();
    this.toggles = {
      microphone: { enabled: true, pending: false, toggle: vi.fn() },
      camera: { enabled: true, pending: false, toggle: vi.fn() },
      screen_share: { enabled: false, pending: false, toggle: vi.fn() },
    };
    this.requestMeetingToken.mockReset();
    let seq = 0;
    this.requestMeetingToken.mockImplementation(async () => {
      seq += 1;
      return { token: `t${seq}`, serverUrl: "wss://lk.example.com", roomName: "r1", expiresAt: "2026-09-22T12:00:00.000Z" };
    });
  },
  setConnState(next: string) {
    this.connState = next;
    this.listeners.forEach((fn) => fn());
  },
};

export function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    doctorId: "doctor-1",
    doctor: { id: "doctor-1", title: "Dr.", fullName: "Elif Aydemir", displayName: "Elif Aydemir", slug: "dr-elif-aydemir" },
    patientUserId: null,
    patientName: "Zeynep Kaya",
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
    ...overrides,
  } as Appointment;
}

/** `@livekit/components-react` sahtesi. */
export const componentsReactMock = {
  LiveKitRoom: (props: { children?: ReactNode; token: string; video?: unknown; audio?: unknown; options?: unknown; onDisconnected?: (r?: number) => void }) => {
    harness.lkProps = props as typeof harness.lkProps;
    useEffect(() => {
      harness.mounts.push(props.token);
      return () => {
        harness.unmounts += 1;
      };
    }, [props.token]);
    return (
      <div data-testid="lk-room" data-token={props.token}>
        {props.children}
      </div>
    );
  },
  ParticipantTile: ({ trackRef, children }: { trackRef: FakeTrack; children?: ReactNode }) => (
    <div data-testid="tile" data-identity={trackRef.participant.identity}>
      {children}
    </div>
  ),
  RoomAudioRenderer: () => null,
  TrackToggle: ({ source, children, ...rest }: { source: string; children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" data-source={source} {...(rest as object)}>
      {children}
    </button>
  ),
  VideoTrack: ({ trackRef }: { trackRef: FakeTrack }) => <video data-testid={`video-${trackRef.participant.identity}`} data-identity={trackRef.participant.identity} />,
  isTrackReference: () => true,
  useConnectionState: () => {
    const [state, setState] = useState(harness.connState);
    useEffect(() => {
      const fn = () => setState(harness.connState);
      harness.listeners.add(fn);
      return () => {
        harness.listeners.delete(fn);
      };
    }, []);
    return state;
  },
  useParticipants: () => harness.participants,
  useRoomContext: () => harness.room,
  useTrackToggle: ({ source }: { source: string }) => harness.toggles[source] ?? { enabled: false, pending: false, toggle: vi.fn() },
  useTracks: () => harness.tracks,
  useConnectionQualityIndicator: () => ({ quality: "good" }),
  useTrackMutedIndicator: () => ({ isMuted: false }),
};

/** `livekit-client` sahtesi. */
export const livekitClientMock = {
  ConnectionState: { Connected: "connected", Disconnected: "disconnected", Reconnecting: "reconnecting", SignalReconnecting: "signal-reconnecting", Connecting: "connecting" },
  DisconnectReason: { CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2, SIGNAL_CLOSE: 5 },
  MediaDeviceFailure: { PermissionDenied: "PermissionDenied", NotFound: "NotFound", DeviceInUse: "DeviceInUse", Other: "Other" },
  RoomEvent: {
    DataReceived: "dataReceived",
    Reconnected: "reconnected",
    Reconnecting: "reconnecting",
    SignalReconnecting: "signalReconnecting",
    ConnectionQualityChanged: "connectionQualityChanged",
    ParticipantDisconnected: "participantDisconnected",
    ParticipantConnected: "participantConnected",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    ActiveDeviceChanged: "activeDeviceChanged",
    LocalTrackPublished: "localTrackPublished",
  },
  Track: { Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" } },
};

/** `PointerEvent` jsdom'da yoktur → `clientX/pointerId` taşıyan basit bir uygulama (jest-dom `fireEvent.pointer*` bunu kullanır). */
export function installPointerEvent() {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", { value: TestPointerEvent, configurable: true, writable: true });
}

/** Sahte `LocalVideoTrack`/`LocalAudioTrack`: `restartTrack` çağrılarını kaydeder, ayarları (facingMode, deviceId) günceller. */
export function makeLocalTrack(initial: { facingMode?: string; deviceId?: string; label?: string }) {
  const settings = { ...initial };
  const track = {
    mediaStreamTrack: {
      label: initial.label ?? "",
      getSettings: () => ({ ...settings }),
    },
    settings,
    restartTrack: vi.fn(async (opts?: { facingMode?: string; deviceId?: string }) => {
      if (opts?.facingMode) settings.facingMode = opts.facingMode;
      if (opts?.deviceId) settings.deviceId = opts.deviceId;
    }),
  };
  return track;
}

export function installMediaDevices(devices: Array<{ kind: string; deviceId: string; label: string }>, opts: { facingModeSupported?: boolean } = {}) {
  const md = {
    enumerateDevices: vi.fn(async () => devices),
    getSupportedConstraints: () => ({ facingMode: opts.facingModeSupported ?? true }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getUserMedia: vi.fn(),
  };
  Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true });
  return md;
}

export function removeMediaDevices() {
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
}
