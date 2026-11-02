import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MeetingStage, meetingGridClass } from "@/components/site/meeting/meeting-stage";
import { MeetingGuestControlBar } from "@/components/site/meeting/meeting-guest-control-bar";
import { MeetingRoom } from "@/components/site/meeting/meeting-room";
import { RoomUiProvider } from "@/components/site/telehealth/room/room-ui-context";
import { ParticipantLabelProvider } from "@/components/site/telehealth/room/label-context";
import { CONSULTATION_DICTIONARIES, fmt } from "@/lib/i18n/use-consultation-strings";
import { harness, installPointerEvent, removeMediaDevices, type FakeParticipant } from "./helpers/room-harness";

/**
 * Paket AG İş 3 — toplantı odası bileşenleri (§9.2 madde 2-3): misafir çubuğunda ekran paylaşımı YOK, ev sahibi çubuğunda
 * VAR; sahne ızgarası 1-8 katılımcıda doğru; etiket token `name`'inden gelir, identity hiç görünmez; terminal kopmalar.
 */
vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", async () => (await import("./helpers/room-harness")).componentsReactMock);
vi.mock("livekit-client", async () => {
  const h = await import("./helpers/room-harness");
  return {
    ...h.livekitClientMock,
    DisconnectReason: { ...h.livekitClientMock.DisconnectReason, PARTICIPANT_REMOVED: 4, ROOM_DELETED: 5, ROOM_CLOSED: 10 },
  };
});
vi.mock("@/context/locale-alternates-context", async () => {
  const h = await import("./helpers/room-harness");
  return { useActiveLocaleCode: () => h.harness.localeCode, useLocalizePath: () => (path: string) => path };
});

const me: FakeParticipant = { identity: "meet-guest:g1", name: "Zeynep Kaya", isLocal: true };
const host: FakeParticipant = { identity: "meet-host:u1", name: "Dr. Elif Aydemir", isLocal: false };
const others = (n: number): FakeParticipant[] =>
  Array.from({ length: n }, (_, i) => ({ identity: `meet-guest:x${i}`, name: `Misafir ${i}`, isLocal: false }));
const cam = (participant: FakeParticipant) => ({ participant, source: "camera" });
const screenShare = (participant: FakeParticipant) => ({ participant, source: "screen_share" });

const ct = CONSULTATION_DICTIONARIES.tr!;
const labelContext = { viewer: "patient" as const, t: ct, fmt };

function renderStage() {
  return render(
    <ParticipantLabelProvider value={labelContext}>
      <RoomUiProvider>
        <MeetingStage />
      </RoomUiProvider>
    </ParticipantLabelProvider>
  );
}

beforeAll(() => installPointerEvent());

beforeEach(() => {
  harness.reset();
  removeMediaDevices();
  window.localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("meetingGridClass", () => {
  it("1-8 kutu için sütun sayısı kademeli artar", () => {
    expect(meetingGridClass(1)).toBe("grid-cols-1");
    expect(meetingGridClass(2)).toBe("grid-cols-1 sm:grid-cols-2");
    expect(meetingGridClass(3)).toBe("grid-cols-2");
    expect(meetingGridClass(4)).toBe("grid-cols-2");
    expect(meetingGridClass(5)).toBe("grid-cols-2 lg:grid-cols-3");
    expect(meetingGridClass(6)).toBe("grid-cols-2 lg:grid-cols-3");
    expect(meetingGridClass(7)).toBe("grid-cols-2 lg:grid-cols-4");
    expect(meetingGridClass(8)).toBe("grid-cols-2 lg:grid-cols-4");
  });
});

describe("MeetingStage", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("%i katılımcıda tüm kutular çizilir ve ızgara sınıfı doğrudur", (count) => {
    harness.tracks = [cam(me), ...others(count - 1).map(cam)];
    renderStage();
    expect(screen.getAllByTestId("tile")).toHaveLength(count);
    const grid = screen.getByTestId("meeting-grid");
    expect(grid).toHaveAttribute("class", expect.stringContaining(meetingGridClass(count)));
    expect(screen.getByTestId("meeting-stage")).toHaveAttribute("data-tile-count", String(count));
  });

  it("yalnızca kendiniz varken 'diğerleri bekleniyor' bilgisi görünür; başkası gelince kalkar", () => {
    harness.tracks = [cam(me)];
    const { unmount } = renderStage();
    expect(screen.getByTestId("meeting-waiting-others")).toHaveTextContent("Diğer katılımcılar bekleniyor");
    unmount();
    harness.tracks = [cam(me), cam(host)];
    renderStage();
    expect(screen.queryByTestId("meeting-waiting-others")).not.toBeInTheDocument();
  });

  it("8'den fazla kamera kutusu gelse bile en çok 8 çizilir", () => {
    harness.tracks = [cam(me), ...others(9).map(cam)];
    renderStage();
    expect(screen.getAllByTestId("tile")).toHaveLength(8);
  });

  it("ekran paylaşımı ana kutuda; kameralar alttaki şeritte", () => {
    harness.tracks = [cam(me), cam(host), screenShare(host)];
    renderStage();
    const main = screen.getByTestId("meeting-main-tile");
    expect(within(main).getAllByTestId("tile")).toHaveLength(1);
    expect(within(main).getByTestId("tile-label")).toHaveTextContent("Dr. Elif Aydemir");
    const strip = screen.getByTestId("meeting-strip");
    expect(within(strip).getAllByTestId("tile")).toHaveLength(2);
    expect(screen.queryByTestId("meeting-grid")).not.toBeInTheDocument();
  });

  it("etiket token adından gelir; identity (meet-host:/meet-guest:) ekranda HİÇ görünmez", () => {
    harness.tracks = [cam(me), cam(host)];
    renderStage();
    const labels = screen.getAllByTestId("tile-label").map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Zeynep Kaya", "Dr. Elif Aydemir"]));
    expect(document.body.textContent).not.toMatch(/meet-host:|meet-guest:/);
  });

  it("adı olmayan katılımcıda etiket identity'ye düşmez", () => {
    harness.tracks = [cam(me), cam({ identity: "meet-guest:zzz", isLocal: false })];
    renderStage();
    expect(document.body.textContent).not.toMatch(/meet-guest:zzz/);
  });

  it("yerel kamera kutusu kendi görüntüsü işaretiyle (aynalama) sarılır", () => {
    harness.tracks = [cam(me), cam(host)];
    const { container } = renderStage();
    expect(container.querySelectorAll("[data-local-camera]")).toHaveLength(1);
  });
});

describe("MeetingGuestControlBar", () => {
  it("mikrofon, kamera, ayarlar ve ayrıl düğmeleri var; EKRAN PAYLAŞIMI düğmesi YOK", () => {
    render(<MeetingGuestControlBar />);
    const bar = screen.getByRole("toolbar");
    expect(within(bar).getByRole("button", { name: "Mikrofonu kapat" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Kamerayı kapat" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Ayarlar" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Toplantıdan ayrıl" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /paylaş/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("bar-share")).not.toBeInTheDocument();
    expect(harness.toggles.screen_share!.toggle).not.toHaveBeenCalled();
  });

  it("mikrofon/kamera düğmeleri durumu aria-pressed ile bildirir ve geçişi çağırır", () => {
    harness.toggles.microphone!.enabled = false;
    render(<MeetingGuestControlBar />);
    const mic = screen.getByRole("button", { name: "Mikrofonu aç" });
    expect(mic).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(mic);
    expect(harness.toggles.microphone!.toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Kamerayı kapat" }));
    expect(harness.toggles.camera!.toggle).toHaveBeenCalledTimes(1);
  });

  it("ayrıl düğmesi odadan çıkar", () => {
    render(<MeetingGuestControlBar />);
    fireEvent.click(screen.getByRole("button", { name: "Toplantıdan ayrıl" }));
    expect(harness.room.disconnect).toHaveBeenCalledTimes(1);
  });

  it("ayarlar düğmesi paneli açar (aria-expanded)", () => {
    render(<MeetingGuestControlBar />);
    const settings = screen.getByRole("button", { name: "Ayarlar" });
    expect(settings).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(settings);
    expect(settings).toHaveAttribute("aria-expanded", "true");
  });
});

describe("MeetingRoom", () => {
  const token = { token: "tok-1", serverUrl: "wss://lk.example.com", roomName: "meet_abc", expiresAt: "2026-12-01T12:00:00.000Z" };
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  function renderRoom(mode: "host" | "guest", endsAt = future) {
    const onExit = vi.fn();
    harness.tracks = [cam(me), cam(host)];
    harness.participants = [me, host];
    render(<MeetingRoom mode={mode} initialToken={token} fetchToken={async () => token} endsAt={endsAt} onExit={onExit} />);
    return onExit;
  }

  it("ev sahibi: AF kontrol çubuğu (ekran paylaşımı DAHİL); misafir: hafif çubuk (ekran paylaşımı YOK)", async () => {
    renderRoom("host");
    expect(await screen.findByTestId("bar-share")).toBeInTheDocument();
    expect(screen.queryByTestId("guest-control-bar")).not.toBeInTheDocument();
    cleanup();

    harness.reset();
    renderRoom("guest");
    expect(screen.getByTestId("guest-control-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-share")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /paylaş/i })).not.toBeInTheDocument();
  });

  it("odaya token ile bağlanır ve kayıt göstergesi çizmez", () => {
    renderRoom("guest");
    expect(screen.getByTestId("lk-room")).toHaveAttribute("data-token", "tok-1");
    expect(screen.queryByTestId("recording-indicator")).not.toBeInTheDocument();
  });

  it("kullanıcı ayrılınca (CLIENT_INITIATED) 'left' bildirilir", () => {
    const onExit = renderRoom("guest");
    (harness.lkProps.onDisconnected as (r?: number) => void)(1);
    expect(onExit).toHaveBeenCalledWith("left");
  });

  it("bitişten önce odadan çıkarılma (PARTICIPANT_REMOVED) 'removed'; yeniden bağlanma denenmez", () => {
    const onExit = renderRoom("guest");
    (harness.lkProps.onDisconnected as (r?: number) => void)(4);
    expect(onExit).toHaveBeenCalledWith("removed");
    expect(screen.queryByTestId("reconnecting-overlay")).not.toBeInTheDocument();
  });

  it("bitişten sonra çıkarılma ve oda kapanması (ROOM_DELETED) 'ended' sayılır", () => {
    const onExit = renderRoom("guest", past);
    (harness.lkProps.onDisconnected as (r?: number) => void)(4);
    expect(onExit).toHaveBeenLastCalledWith("ended");
    (harness.lkProps.onDisconnected as (r?: number) => void)(5);
    expect(onExit).toHaveBeenLastCalledWith("ended");
  });

  it("ilk bağlantı hatası 'failed' + çevrilmiş mesajla bildirilir (ham metin yok)", () => {
    const onExit = renderRoom("guest");
    (harness.lkProps.onError as (e: unknown) => void)(new Error("raw sdk text"));
    expect(onExit).toHaveBeenCalledTimes(1);
    const [reason, detail] = onExit.mock.calls[0]!;
    expect(reason).toBe("failed");
    expect(String(detail)).not.toContain("raw sdk text");
  });

  it("kamera/mikrofon hatası odayı kapatmaz; kapatılabilir uyarı gösterir", () => {
    const onExit = renderRoom("guest");
    act(() => (harness.lkProps.onMediaDeviceFailure as (f?: string) => void)("PermissionDenied"));
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByTestId("meeting-media-alert")).toBeInTheDocument();
  });
});
