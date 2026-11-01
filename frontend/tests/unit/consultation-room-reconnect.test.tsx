import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import { ApiClientError } from "@/lib/api/error";
import type { Appointment } from "@/lib/api/types";

/**
 * Paket AF (Aşama 1) — görüşme odası: uygulama düzeyi yeniden bağlanma (en fazla 3 deneme, 2/5/10 sn, 60 sn kararlılıkta hak
 * yenilenir, sonunda mesaj + düğme, mesajsız giriş ekranına düşmeme, DUPLICATE_IDENTITY), bağlantı durumu katmanları ve
 * video kutusu ad etiketleri (identity ASLA görünmez). `LiveKitRoom` stub'lanır; olay yayıcı sahte `room` ile sürülür.
 */
type FakeParticipant = { identity: string; name?: string; metadata?: string; isLocal: boolean };
type FakeTrack = { participant: FakeParticipant; source: string };

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
let tracks: FakeTrack[] = [];
let connState = "connecting";
const stateListeners = new Set<() => void>();
function setConnState(next: string) {
  connState = next;
  stateListeners.forEach((fn) => fn());
}
let appointmentOverride: Partial<Appointment> = {};
let localeCode = "tr";
let doctorSession = false;
let lkProps: { onDisconnected?: (reason?: number) => void; onError?: (e: unknown) => void; onMediaDeviceFailure?: (f?: string) => void; token?: string } = {};
const mountedTokens: string[] = [];

vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: { children?: React.ReactNode; token: string; onDisconnected?: (r?: number) => void; onError?: (e: unknown) => void; onMediaDeviceFailure?: (f?: string) => void }) => {
    lkProps = props;
    useEffect(() => {
      mountedTokens.push(props.token);
    }, [props.token]);
    return <div data-testid="lk-room" data-token={props.token}>{props.children}</div>;
  },
  ParticipantTile: ({ trackRef, children }: { trackRef: FakeTrack; children?: React.ReactNode }) => (
    <div data-testid="tile" data-identity={trackRef.participant.identity}>{children}</div>
  ),
  RoomAudioRenderer: () => null,
  VideoTrack: () => null,
  isTrackReference: () => true,
  useConnectionState: () => {
    const [state, setState] = useState(connState);
    useEffect(() => {
      const fn = () => setState(connState);
      stateListeners.add(fn);
      return () => {
        stateListeners.delete(fn);
      };
    }, []);
    return state;
  },
  useParticipants: () => participants,
  useRoomContext: () => room,
  useTrackToggle: () => ({ enabled: false, pending: false, toggle: vi.fn() }),
  useTracks: () => tracks,
  useConnectionQualityIndicator: () => ({ quality: "good" }),
  useTrackMutedIndicator: () => ({ isMuted: false }),
}));
vi.mock("livekit-client", () => ({
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
  },
  Track: { Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" } },
}));

const requestMeetingToken = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  getAppointment: vi.fn(async () => ({ ...makeAppointment(), ...appointmentOverride })),
  requestMeetingToken: (...args: unknown[]) => requestMeetingToken(...args),
  getRecordingStatus: vi.fn(async () => null),
}));
vi.mock("@/lib/api/interpreter", () => ({
  removeAppointmentInterpreter: vi.fn(async () => undefined),
  getAppointmentInterpreter: vi.fn(async () => null),
}));
vi.mock("@/lib/api/modules", () => ({ listPublicModules: vi.fn(async () => []) }));
vi.mock("@/context/auth-context", () => ({
  useAuthOptional: () => ({ status: "authenticated", user: { doctorProfileId: doctorSession ? "doctor-1" : null } }),
}));
vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => localeCode,
  useLocalizePath: () => (path: string) => path,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function makeAppointment(): Appointment {
  return {
    id: "appointment-1",
    doctorId: "doctor-1",
    doctor: { id: "doctor-1", title: "Dr.", fullName: "Elif Aydemir", slug: "dr-elif-aydemir" },
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
  } as Appointment;
}

let tokenSeq = 0;
function tokenResponse() {
  tokenSeq += 1;
  return { token: `t${tokenSeq}`, serverUrl: "wss://lk.example.com", roomName: "r1", expiresAt: "2026-09-22T12:00:00.000Z" };
}

async function joinRoom() {
  render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
  const user = userEvent.setup({ delay: null });
  await user.click(await screen.findByRole("button", { name: localeCode === "ar" ? "الانضمام إلى الاستشارة" : "Görüşmeye Katıl" }));
  await waitFor(() => expect(requestMeetingToken).toHaveBeenCalledTimes(1));
  await screen.findByTestId("lk-room");
  return user;
}

/**
 * Sahte zamanlayıcı YALNIZCA katılım tamamlandıktan sonra kurulur (RTL'nin findBy/waitFor yardımcıları sahte setTimeout ile
 * takılır); ardından oda "Connected" olur → 60 sn kararlılık zamanlayıcısı sahte saatte başlar (gerçek akışın aynısı).
 */
function startClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  act(() => setConnState("connected"));
}
async function join() {
  const user = await joinRoom();
  startClock();
  return user;
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const prejoinButton = () => screen.queryByRole("button", { name: "Görüşmeye Katıl" });

beforeEach(() => {
  room = new FakeRoom();
  appointmentOverride = {};
  stateListeners.clear();
  participants = [];
  tracks = [];
  connState = "connecting";
  localeCode = "tr";
  doctorSession = false;
  lkProps = {};
  mountedTokens.length = 0;
  tokenSeq = 0;
  requestMeetingToken.mockReset();
  requestMeetingToken.mockImplementation(async () => tokenResponse());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe("uygulama düzeyi yeniden bağlanma", () => {
  it("kopma → 'Yeniden bağlanılıyor…' katmanı; 2 sn sonra YENİ token ile oda yeniden kurulur; giriş ekranına düşülmez", async () => {
    await join();
    act(() => lkProps.onDisconnected!(5));

    const overlay = screen.getByTestId("reconnecting-overlay");
    expect(within(overlay).getByText("Yeniden bağlanılıyor…")).toBeInTheDocument();
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 1 / 3");
    expect(prejoinButton()).not.toBeInTheDocument();
    // Görüşme ekranı arkada kalır.
    expect(screen.getByTestId("lk-room")).toBeInTheDocument();

    await advance(1999);
    expect(requestMeetingToken).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(requestMeetingToken).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("lk-room")).toHaveAttribute("data-token", "t2");
    expect(mountedTokens).toEqual(["t1", "t2"]);
    // Yeni oda Connected olunca katman kalkar.
    expect(screen.queryByTestId("reconnecting-overlay")).not.toBeInTheDocument();
  });

  it("en fazla 3 deneme, artan bekleme (2 → 5 → 10 sn); sonunda çevrilmiş mesaj + 'Yeniden bağlan'; giriş ekranına düşmez", async () => {
    await join();

    act(() => lkProps.onDisconnected!(5));
    await advance(2000); // deneme 1
    expect(requestMeetingToken).toHaveBeenCalledTimes(2);

    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 2 / 3");
    await advance(4999);
    expect(requestMeetingToken).toHaveBeenCalledTimes(2);
    await advance(1); // deneme 2 (5 sn)
    expect(requestMeetingToken).toHaveBeenCalledTimes(3);

    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 3 / 3");
    await advance(9999);
    expect(requestMeetingToken).toHaveBeenCalledTimes(3);
    await advance(1); // deneme 3 (10 sn)
    expect(requestMeetingToken).toHaveBeenCalledTimes(4);

    // Üçü de başarısız: bir kopma daha → yeni deneme YOK, mesaj + düğme.
    act(() => lkProps.onDisconnected!(5));
    const failed = screen.getByTestId("reconnect-failed");
    expect(within(failed).getByText("Yeniden bağlanılamadı")).toBeInTheDocument();
    expect(screen.getByTestId("reconnect-failed-message")).toHaveTextContent("Görüşme sunucusuna ulaşılamadı");
    expect(screen.getByRole("button", { name: "Yeniden bağlan" })).toBeInTheDocument();
    await advance(60_000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(4);
    expect(prejoinButton()).not.toBeInTheDocument();
  });

  it("'Yeniden bağlan' sayacı sıfırlar ve beklemesiz dener", async () => {
    await join();
    for (const wait of [2000, 5000, 10_000]) {
      act(() => lkProps.onDisconnected!(5));
      await advance(wait);
    }
    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnect-failed")).toBeInTheDocument();
    expect(requestMeetingToken).toHaveBeenCalledTimes(4);

    await act(async () => {
      screen.getByRole("button", { name: "Yeniden bağlan" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requestMeetingToken).toHaveBeenCalledTimes(5); // beklemesiz
    expect(screen.queryByTestId("reconnect-failed")).not.toBeInTheDocument();

    // Sayaç sıfırlandı (retry = 1. deneme): sonraki kopmada bekleme 5 sn (2. deneme), 2 sn DEĞİL.
    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 2 / 3");
  });

  it("bağlantı 60 sn kesintisiz kalırsa hak yenilenir; 60 sn dolmadan kopmada sayaç sürer", async () => {
    await join();

    act(() => lkProps.onDisconnected!(5));
    await advance(2000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(2);

    // 59 sn sonra kopma: hak yenilenmedi → 2. deneme (5 sn).
    await advance(59_000);
    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 2 / 3");
    await advance(5000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(3);

    // Bu kez 60 sn kesintisiz: hak yenilenir → sonraki kopma yine 1. deneme (2 sn).
    await advance(60_000);
    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 1 / 3");
    await advance(2000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(4);
  });

  it("Connected olmayan durum kararlılık sayacını iptal eder (kesintisiz değilse hak yenilenmez)", async () => {
    await join();
    act(() => lkProps.onDisconnected!(5));
    await advance(2000);
    // Yeni oda 30 sn bağlı, sonra SDK yeniden bağlanmaya geçer (Connected değil) → zamanlayıcı iptal.
    await advance(30_000);
    act(() => setConnState("reconnecting"));
    act(() => room.emit("reconnecting"));
    await advance(40_000);
    act(() => lkProps.onDisconnected!(5));
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 2 / 3");
  });

  it("DUPLICATE_IDENTITY: kendiliğinden yeniden bağlanma YOK; açıklayıcı ekran; 'Burada devam et' yeni token ile bağlanır", async () => {
    await join();
    act(() => lkProps.onDisconnected!(2));

    const screenEl = screen.getByTestId("duplicate-identity");
    expect(within(screenEl).getByText("Bu görüşme başka bir sekmede veya cihazda açık")).toBeInTheDocument();
    await advance(120_000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(1);
    expect(prejoinButton()).not.toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Burada devam et" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requestMeetingToken).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("lk-room")).toHaveAttribute("data-token", "t2");
    expect(screen.queryByTestId("duplicate-identity")).not.toBeInTheDocument();
  });

  it("kullanıcı kendi ayrılırsa (CLIENT_INITIATED) giriş ekranına dönülür, yeniden bağlanma denenmez", async () => {
    await join();
    act(() => lkProps.onDisconnected!(1));
    expect(prejoinButton()).toBeInTheDocument();
    expect(screen.queryByTestId("reconnecting-overlay")).not.toBeInTheDocument();
    await advance(30_000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(1);
  });

  it("yeniden bağlanırken token 403 → yeniden denemek işe yaramaz, hemen yetki mesajı + düğme", async () => {
    await join();
    requestMeetingToken.mockRejectedValueOnce(new ApiClientError(403, { code: "FORBIDDEN", message: "ham sunucu metni" }));
    act(() => lkProps.onDisconnected!(5));
    await advance(2000);
    expect(screen.getByTestId("reconnect-failed-message")).toHaveTextContent("katılma yetkiniz yok");
    expect(screen.queryByText("ham sunucu metni")).not.toBeInTheDocument();
    await advance(30_000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(2);
  });

  it("yeniden bağlanırken ağ hatası → sonraki deneme planlanır", async () => {
    await join();
    requestMeetingToken.mockRejectedValueOnce(new ApiClientError(0, { code: "NETWORK_ERROR", message: "x" }));
    act(() => lkProps.onDisconnected!(5));
    await advance(2000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 2 / 3");
    await advance(5000);
    expect(requestMeetingToken).toHaveBeenCalledTimes(3);
  });

  it("yeniden bağlanırken yeni odanın bağlanamaması (onError) başarısız deneme sayılır — giriş ekranına düşmez", async () => {
    await join();
    act(() => lkProps.onDisconnected!(5));
    act(() => setConnState("connecting"));
    await advance(2000);
    act(() => lkProps.onError!(new Error("could not establish signal connection")));
    expect(screen.getByTestId("reconnect-attempt")).toHaveTextContent("Deneme 2 / 3");
    expect(prejoinButton()).not.toBeInTheDocument();
    expect(screen.queryByText(/could not establish/)).not.toBeInTheDocument();
  });
});

describe("hata mesajları — ham SDK metni ekrana gelmez", () => {
  it("onError: nedene göre çevrilmiş mesaj; ham metin yalnızca konsolda", async () => {
    await joinRoom();
    act(() => lkProps.onError!(new Error("RAW_SDK_MESSAGE_XYZ")));
    expect(await screen.findByText(/Görüşme bağlantısı kurulamadı/)).toBeInTheDocument();
    expect(screen.queryByText(/RAW_SDK_MESSAGE_XYZ/)).not.toBeInTheDocument();
    expect(console.warn).toHaveBeenCalled();
  });

  it.each([
    ["PermissionDenied", /Kamera\/mikrofon izni reddedildi/],
    ["NotFound", /Kamera veya mikrofon bulunamadı/],
    ["DeviceInUse", /başka bir uygulama tarafından kullanılıyor/],
    ["Other", /Kamera\/mikrofon erişiminde bir sorun/],
  ])("onMediaDeviceFailure %s → çevrilmiş mesaj", async (failure, pattern) => {
    await joinRoom();
    act(() => lkProps.onMediaDeviceFailure!(failure));
    expect(await screen.findByText(pattern)).toBeInTheDocument();
  });

  it("token hatası (409 görüşme süresi doldu) → çevrilmiş mesaj, sunucunun ham metni değil", async () => {
    requestMeetingToken.mockRejectedValueOnce(new ApiClientError(409, { code: "APPOINTMENT_NOT_JOINABLE", message: "RAW_SERVER_TEXT" }));
    render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Görüşmeye Katıl" }));
    expect(await screen.findByText(/sona ermiş ya da artık katılıma açık değil/)).toBeInTheDocument();
    expect(screen.queryByText("RAW_SERVER_TEXT")).not.toBeInTheDocument();
  });
});

describe("bağlantı durumu katmanları", () => {
  const local: FakeParticipant = { identity: "patient:appointment-1", isLocal: true };
  const doctor: FakeParticipant = { identity: "doctor:doctor-1", isLocal: false };

  it("SDK yeniden bağlanması: Reconnecting → katman; Reconnected → kalkar", async () => {
    await joinRoom();
    act(() => room.emit("reconnecting"));
    expect(screen.getByTestId("reconnecting-overlay")).toBeInTheDocument();
    act(() => room.emit("reconnected"));
    expect(screen.queryByTestId("reconnecting-overlay")).not.toBeInTheDocument();
    act(() => room.emit("signalReconnecting"));
    expect(screen.getByTestId("reconnecting-overlay")).toBeInTheDocument();
  });

  it("yerel bağlantı kalitesi Poor/Lost → 'Bağlantı zayıf' bandı; düzelince kalkar; karşı tarafın kalitesi bandı açmaz", async () => {
    await joinRoom();
    act(() => room.emit("connectionQualityChanged", "poor", doctor));
    expect(screen.queryByTestId("weak-connection-banner")).not.toBeInTheDocument();
    act(() => room.emit("connectionQualityChanged", "poor", local));
    expect(screen.getByTestId("weak-connection-banner")).toHaveTextContent("Bağlantı zayıf");
    act(() => room.emit("connectionQualityChanged", "good", local));
    expect(screen.queryByTestId("weak-connection-banner")).not.toBeInTheDocument();
    act(() => room.emit("connectionQualityChanged", "lost", local));
    expect(screen.getByTestId("weak-connection-banner")).toBeInTheDocument();
  });

  it("karşı taraf düşünce adla mesaj; geri gelince kalkar (tercüman/dinleyici için çıkmaz)", async () => {
    await joinRoom();
    const interpreter: FakeParticipant = { identity: "interpreter:p1:b1", metadata: '{"role":"interpreter","language":"ar"}', isLocal: false };
    act(() => room.emit("participantDisconnected", interpreter));
    expect(screen.queryByTestId("participant-lost-banner")).not.toBeInTheDocument();
    act(() => room.emit("participantDisconnected", doctor));
    expect(screen.getByTestId("participant-lost-banner")).toHaveTextContent("Dr. Elif Aydemir bağlantıyı kaybetti, bekleniyor…");
    expect(screen.getByTestId("participant-lost-banner")).not.toHaveTextContent("doctor:");
    act(() => room.emit("participantConnected", doctor));
    expect(screen.queryByTestId("participant-lost-banner")).not.toBeInTheDocument();
  });
});

describe("video kutusu ad etiketleri — identity ASLA görünmez", () => {
  const local: FakeParticipant = { identity: "patient:appointment-1", isLocal: true };
  const doctor: FakeParticipant = { identity: "doctor:77bd0977-1111", name: "Dr. Token Adı", isLocal: false };
  const interpreter: FakeParticipant = {
    identity: "interpreter:p1:b1",
    name: "A. Yılmaz · Interpreter (العربية)",
    metadata: JSON.stringify({ role: "interpreter", language: "ar" }),
    isLocal: false,
  };

  function setScene(list: FakeParticipant[]) {
    participants = list;
    tracks = list.map((p) => ({ participant: p, source: "camera" }));
  }
  const labels = () => screen.getAllByTestId("tile-label").map((el) => el.textContent);

  it("hasta ekranı: doktor = randevudaki unvan + ad, hasta = tam ad, tercüman = '<ad> · Tercüman (<dil>)'", async () => {
    setScene([local, doctor, interpreter]);
    await joinRoom();
    expect(labels()).toEqual(expect.arrayContaining(["Dr. Elif Aydemir", "Zeynep Kaya", "A. Yılmaz · Tercüman (العربية)"]));
    const text = document.body.textContent ?? "";
    for (const forbidden of ["doctor:", "patient:", "interpreter:", "77bd0977", "qa-listener-"]) expect(text).not.toContain(forbidden);
    expect(text).not.toContain("Interpreter");
  });

  it("doktor ekranı: hasta tam adı görünür", async () => {
    doctorSession = true;
    const patientRemote: FakeParticipant = { identity: "patient:appointment-1", isLocal: false };
    const doctorLocal: FakeParticipant = { identity: "doctor:doctor-1", isLocal: true };
    setScene([doctorLocal, patientRemote]);
    await joinRoom();
    expect(labels()).toEqual(expect.arrayContaining(["Zeynep Kaya", "Dr. Elif Aydemir"]));
  });

  it("ad yoksa izleyicinin dilinde rol adı (identity değil); tercümanda 'Tercüman · <dil>'", async () => {
    appointmentOverride = { doctor: null as unknown as Appointment["doctor"], patientName: "" };
    const bareInterpreter: FakeParticipant = { identity: "interpreter:p1:b1", metadata: '{"role":"interpreter","language":"ar"}', isLocal: false };
    setScene([{ identity: "patient:appointment-1", isLocal: true }, { identity: "doctor:d1", isLocal: false }, bareInterpreter]);
    await joinRoom();
    expect(labels()).toEqual(expect.arrayContaining(["Doktor", "Hasta", "Tercüman · العربية"]));
    expect(document.body.textContent).not.toContain("doctor:d1");
    expect(document.body.textContent).not.toContain("patient:appointment-1");
  });
});

describe("AR / RTL", () => {
  it("Arapça: kök dir='rtl' ve metinler Arapça", async () => {
    localeCode = "ar";
    const { container } = render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    expect(await screen.findByRole("button", { name: "الانضمام إلى الاستشارة" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
  });

  it("Türkçe: dir='ltr'", async () => {
    const { container } = render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    await screen.findByRole("button", { name: "Görüşmeye Katıl" });
    expect(container.firstElementChild).toHaveAttribute("dir", "ltr");
  });
});
