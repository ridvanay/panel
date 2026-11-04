import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GuestJoinFlow } from "@/components/site/meeting/guest-join-flow";
import { ApiClientError } from "@/lib/api/error";
import { harness, installPointerEvent, removeMediaDevices } from "./helpers/room-harness";

/** Paket AM — sessionStorage'da belirteç/oturum, yoklama jitter'ı, Retry-After, dolu ekranı, ağ değişimi. */
vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", async () => (await import("./helpers/room-harness")).componentsReactMock);
vi.mock("livekit-client", async () => {
  const h = await import("./helpers/room-harness");
  return { ...h.livekitClientMock, DisconnectReason: { ...h.livekitClientMock.DisconnectReason, PARTICIPANT_REMOVED: 4, ROOM_DELETED: 5, ROOM_CLOSED: 10 } };
});
vi.mock("@/context/locale-alternates-context", async () => {
  const h = await import("./helpers/room-harness");
  return { useActiveLocaleCode: () => h.harness.localeCode, useLocalizePath: () => (path: string) => path };
});

const guestPreflight = vi.fn();
const guestJoin = vi.fn();
vi.mock("@/lib/api/meetings", () => ({
  guestPreflight: (...args: unknown[]) => guestPreflight(...args),
  guestJoin: (...args: unknown[]) => guestJoin(...args),
}));

const TOKEN = `mg_${"A".repeat(43)}`;
const apiError = (status: number, code: string, details?: Record<string, string[]>) =>
  new ApiClientError(status, { code: code as never, message: "RAW SERVER TEXT", details });
const waiting = { status: "waiting" as const, guestSession: "gs_v1.s", pollAfterSec: 5 };
const ready = (n = 1) => ({
  status: "ready" as const,
  guestSession: "gs_v1.s",
  token: `lk-${n}`,
  serverUrl: "wss://lk.example.com",
  roomName: "meet_abc",
  expiresAt: "2026-12-01T12:00:00.000Z",
});
const openPreflight = () => ({
  title: "Ön görüşme",
  hostName: "Dr. Elif Aydemir",
  startsAt: new Date(Date.now() + 60_000).toISOString(),
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  phase: "open" as const,
});
const openLink = (hash = `#${TOKEN}`) => window.history.replaceState(null, "", `/tr/meet/join${hash}`);
const stored = () => Object.keys(window.sessionStorage).filter((k) => k.startsWith("wm.meet.guest:"));

async function renderFlow() {
  render(<GuestJoinFlow />);
  await act(async () => {});
}
async function fillAndJoin(name = "Zeynep Kaya") {
  fireEvent.change(await screen.findByLabelText(/Adınız/), { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("guest-join"));
  });
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeAll(() => installPointerEvent());
beforeEach(() => {
  harness.reset();
  removeMediaDevices();
  window.localStorage.clear();
  window.sessionStorage.clear();
  guestPreflight.mockReset();
  guestJoin.mockReset();
  guestPreflight.mockResolvedValue(openPreflight());
  openLink();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("sessionStorage'da belirteç ve misafir oturumu", () => {
  it("belirteç sessionStorage'a yazılır, adres temizlenir; localStorage kullanılmaz", async () => {
    const lsSet = vi.spyOn(window.localStorage.__proto__, "setItem");
    await renderFlow();
    expect(window.location.hash).toBe("");
    expect(stored()).toHaveLength(2);
    expect(window.localStorage.length).toBe(0);
    expect(lsSet.mock.instances.every((i) => i === window.sessionStorage)).toBe(true);
  });

  it("yenileme: aynı guestSession gönderilir, ad formu / invalid / tam bağlantı ekranı yok", async () => {
    guestJoin.mockResolvedValue(waiting);
    await renderFlow();
    await fillAndJoin();
    cleanup();
    openLink("");
    guestJoin.mockReset();
    guestJoin.mockResolvedValue(ready());
    await renderFlow();
    expect(guestPreflight).toHaveBeenLastCalledWith(TOKEN);
    expect(guestJoin).toHaveBeenCalledTimes(1);
    expect(guestJoin).toHaveBeenCalledWith({ t: TOKEN, guestSession: "gs_v1.s" });
    expect(await screen.findByTestId("lk-room")).toBeInTheDocument();
    expect(screen.queryByTestId("guest-name-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guest-invalid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guest-needs-link")).not.toBeInTheDocument();
  });

  it("farklı bağlantı aynı sekmede önceki oturumu devralmaz", async () => {
    guestJoin.mockResolvedValue(waiting);
    await renderFlow();
    await fillAndJoin();
    cleanup();
    openLink(`#mg_${"B".repeat(43)}`);
    await renderFlow();
    expect(await screen.findByTestId("guest-name-form")).toBeInTheDocument();
    expect(guestJoin).toHaveBeenCalledTimes(1);
  });

  it("belirteç yok ve sessionStorage boş → 'tam bağlantı gerekli' (invalid değil)", async () => {
    openLink("");
    await renderFlow();
    expect(await screen.findByTestId("guest-needs-link")).toBeInTheDocument();
    expect(screen.queryByTestId("guest-invalid")).not.toBeInTheDocument();
    expect(guestPreflight).not.toHaveBeenCalled();
  });

  it("backend 404 → invalid ve anahtar silinir; yenilemede 'tam bağlantı gerekli'", async () => {
    guestPreflight.mockRejectedValue(apiError(404, "MEETING_LINK_INVALID"));
    await renderFlow();
    expect(await screen.findByTestId("guest-invalid")).toBeInTheDocument();
    expect(stored()).toHaveLength(0);
    cleanup();
    openLink("");
    await renderFlow();
    expect(await screen.findByTestId("guest-needs-link")).toBeInTheDocument();
  });

  it.each([
    [4, "guest-removed"],
    [5, "guest-ended"],
  ])("odadan çıkış nedeni %i → anahtar silinir", async (reason, testId) => {
    guestJoin.mockResolvedValue(ready());
    await renderFlow();
    await fillAndJoin();
    await screen.findByTestId("lk-room");
    expect(stored()).toHaveLength(2);
    act(() => (harness.lkProps.onDisconnected as (r?: number) => void)(reason));
    await screen.findByTestId(testId);
    expect(stored()).toHaveLength(0);
  });

  it("saklanan oturum reddedilirse bir kez kayıtlı adla yeni kayda düşer", async () => {
    guestJoin.mockResolvedValueOnce(waiting);
    await renderFlow();
    await fillAndJoin();
    cleanup();
    openLink("");
    guestJoin.mockReset();
    guestJoin.mockRejectedValueOnce(apiError(404, "MEETING_LINK_INVALID")).mockResolvedValueOnce(ready());
    await renderFlow();
    expect(await screen.findByTestId("lk-room")).toBeInTheDocument();
    expect(guestJoin).toHaveBeenNthCalledWith(2, { t: TOKEN, name: "Zeynep Kaya" });
  });
});

describe("yoklama jitter'ı, Retry-After, ilk join 429", () => {
  it("yoklama 5 sn + 0–2 sn: 5 sn'den önce gitmez, 7 sn'de gider", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    guestJoin.mockResolvedValue(waiting);
    await renderFlow();
    await fillAndJoin();
    await advance(4_900);
    expect(guestJoin).toHaveBeenCalledTimes(1);
    await advance(2_200);
    expect(guestJoin).toHaveBeenCalledTimes(2);
  });

  it("jitter 0 iken yoklama 5 sn'de gider", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0);
    guestJoin.mockResolvedValue(waiting);
    await renderFlow();
    await fillAndJoin();
    await advance(5_100);
    expect(guestJoin).toHaveBeenCalledTimes(2);
  });

  it("yoklamada 429 + Retry-After(20) → 20 sn dolmadan istek yok", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0);
    guestJoin
      .mockResolvedValueOnce(waiting)
      .mockRejectedValueOnce(apiError(429, "RATE_LIMITED", { retryAfterSeconds: ["20"] }))
      .mockResolvedValue(waiting);
    await renderFlow();
    await fillAndJoin();
    await advance(5_100);
    expect(guestJoin).toHaveBeenCalledTimes(2);
    await advance(19_000);
    expect(guestJoin).toHaveBeenCalledTimes(2);
    await advance(1_500);
    expect(guestJoin).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("guest-waiting")).toBeInTheDocument();
  });

  it("ilk join 429 → dost mesaj ve Retry-After sonrası otomatik yeniden deneme", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0);
    guestJoin.mockRejectedValueOnce(apiError(429, "RATE_LIMITED", { retryAfterSeconds: ["8"] })).mockResolvedValueOnce(ready());
    await renderFlow();
    await fillAndJoin();
    expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
    expect(screen.queryByText(/RAW SERVER TEXT/)).not.toBeInTheDocument();
    await advance(7_000);
    expect(guestJoin).toHaveBeenCalledTimes(1);
    await advance(1_500);
    expect(await screen.findByTestId("lk-room")).toBeInTheDocument();
  });
});

describe("dolu ekranı", () => {
  it("'Tekrar dene' aynı adla yeniden dener ve odaya girer", async () => {
    guestJoin.mockRejectedValueOnce(apiError(409, "MEETING_FULL")).mockResolvedValueOnce(ready());
    await renderFlow();
    await fillAndJoin();
    await screen.findByTestId("guest-full");
    await act(async () => {
      fireEvent.click(screen.getByTestId("guest-full-retry"));
    });
    expect(await screen.findByTestId("lk-room")).toBeInTheDocument();
    expect(guestJoin).toHaveBeenLastCalledWith({ t: TOKEN, name: "Zeynep Kaya" });
  });

  it("15 sn'de bir otomatik dener; en çok 8 kez", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestJoin.mockRejectedValue(apiError(409, "MEETING_FULL"));
    await renderFlow();
    await fillAndJoin();
    await screen.findByTestId("guest-full");
    for (let i = 0; i < 12; i++) await advance(15_100);
    expect(guestJoin).toHaveBeenCalledTimes(1 + 8);
  });
});

describe("Farklı IP / ağ değişimi", () => {
  it("bekleme sırasında offline→online: hemen aynı guestSession ile yoklar; form/invalid/tam bağlantı ekranı çıkmaz", async () => {
    guestJoin.mockResolvedValueOnce(waiting).mockRejectedValueOnce(apiError(0, "NETWORK_ERROR")).mockResolvedValueOnce(ready());
    await renderFlow();
    await fillAndJoin();
    await screen.findByTestId("guest-waiting");
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    expect(guestJoin).toHaveBeenNthCalledWith(2, { t: TOKEN, guestSession: "gs_v1.s" });
    expect(screen.queryByTestId("guest-name-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guest-invalid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guest-needs-link")).not.toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByTestId("lk-room")).toBeInTheDocument();
    expect(guestJoin).toHaveBeenNthCalledWith(3, { t: TOKEN, guestSession: "gs_v1.s" });
  });

  it("yenilemede ağ yokken hata ekranı (form değil); online olunca aynı guestSession ile girer", async () => {
    guestJoin.mockResolvedValueOnce(waiting);
    await renderFlow();
    await fillAndJoin();
    cleanup();
    openLink("");
    guestJoin.mockReset();
    guestJoin.mockRejectedValueOnce(apiError(0, "NETWORK_ERROR")).mockResolvedValueOnce(ready());
    await renderFlow();
    expect(await screen.findByTestId("guest-error")).toBeInTheDocument();
    expect(screen.queryByTestId("guest-name-form")).not.toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByTestId("lk-room")).toBeInTheDocument();
    expect(guestJoin).toHaveBeenLastCalledWith({ t: TOKEN, guestSession: "gs_v1.s" });
  });
});

describe("admin katılımcı sınırı etiketi", () => {
  it("seçenek etiketi 'N kişi (siz dahil)'", async () => {
    const { meetingStrings } = await import("@/lib/i18n/site-dictionaries/tr/meeting");
    const { fmt } = await import("@/lib/i18n/use-meeting-strings");
    expect(fmt(meetingStrings.capacityOption, { count: 4 })).toBe("4 kişi (siz dahil)");
  });
});
