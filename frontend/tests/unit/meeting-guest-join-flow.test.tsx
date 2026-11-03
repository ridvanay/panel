import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GuestJoinFlow, takeTokenFromLocation } from "@/components/site/meeting/guest-join-flow";
import { ApiClientError } from "@/lib/api/error";
import { harness, installPointerEvent, removeMediaDevices } from "./helpers/room-harness";

/**
 * Paket AG İş 3 — misafir giriş akışı (§9.2 madde 4): belirteç URL parçasından okunup adres çubuğundan silinir; 404 → tek tip
 * "geçersiz" ekranı; `waiting` → bekleme + yoklama; `ready` → oda; MEETING_FULL / MEETING_NOT_OPEN ekranları; terminal
 * kopmada yeniden bağlanma yok.
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

const guestPreflight = vi.fn();
const guestJoin = vi.fn();
vi.mock("@/lib/api/meetings", () => ({
  guestPreflight: (...args: unknown[]) => guestPreflight(...args),
  guestJoin: (...args: unknown[]) => guestJoin(...args),
}));

const TOKEN = `mg_${"A".repeat(43)}`;
const apiError = (status: number, code: string, details?: Record<string, string[]>) =>
  new ApiClientError(status, { code: code as never, message: "RAW SERVER TEXT", details });
const ready = (n = 1) => ({
  status: "ready" as const,
  guestSession: "gs_v1.session",
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

function openLink(hash = `#${TOKEN}`) {
  window.history.replaceState(null, "", `/tr/meet/join${hash}`);
}

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

beforeAll(() => installPointerEvent());

beforeEach(() => {
  harness.reset();
  removeMediaDevices();
  window.localStorage.clear();
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

describe("belirteç URL parçasından okunur ve adres çubuğundan silinir", () => {
  it("takeTokenFromLocation parçayı döndürür ve hash'i temizler", () => {
    openLink("#mg_abc");
    expect(takeTokenFromLocation()).toBe("mg_abc");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("mg_abc");
    expect(takeTokenFromLocation()).toBeNull();
  });

  it("preflight belirteçle çağrılır; sonrasında adres çubuğunda belirteç kalmaz", async () => {
    await renderFlow();
    expect(guestPreflight).toHaveBeenCalledWith(TOKEN);
    expect(window.location.href).not.toContain("mg_");
    expect(window.location.hash).toBe("");
  });

  it("belirteç yoksa ya da biçimi bozuksa API'ye hiç gidilmez; 'geçersiz' ekranı", async () => {
    openLink("");
    await renderFlow();
    expect(guestPreflight).not.toHaveBeenCalled();
    expect(await screen.findByTestId("guest-invalid")).toHaveTextContent("Bu bağlantı geçersiz");
    cleanup();
    openLink("#mg_kisa");
    await renderFlow();
    expect(guestPreflight).not.toHaveBeenCalled();
    expect(screen.getByTestId("guest-invalid")).toBeInTheDocument();
  });
});

describe("geçersiz bağlantı tek tip ekran", () => {
  it("preflight 404 → 'bağlantı geçersiz'; sebep (süresi dolmuş / iptal) belirtilmez", async () => {
    guestPreflight.mockRejectedValue(apiError(404, "MEETING_LINK_INVALID"));
    await renderFlow();
    const screenEl = await screen.findByTestId("guest-invalid");
    expect(screenEl).toHaveTextContent("Bu bağlantı geçersiz");
    expect(screenEl.textContent).not.toMatch(/RAW SERVER TEXT/);
    expect(screen.queryByTestId("guest-name-form")).not.toBeInTheDocument();
  });

  it("join 404 (bağlantı yenilendi / iptal) → aynı tek tip ekran", async () => {
    guestJoin.mockRejectedValue(apiError(404, "MEETING_LINK_INVALID"));
    await renderFlow();
    await fillAndJoin();
    expect(await screen.findByTestId("guest-invalid")).toHaveTextContent("Bu bağlantı geçersiz");
  });

  it("ağ hatası 'geçersiz' DEĞİL, yeniden dene seçenekli hata ekranıdır", async () => {
    guestPreflight.mockRejectedValueOnce(apiError(0, "NETWORK_ERROR"));
    await renderFlow();
    expect(await screen.findByTestId("guest-error")).toBeInTheDocument();
    expect(screen.queryByTestId("guest-invalid")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    });
    expect(guestPreflight).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("guest-name-form")).toBeInTheDocument();
  });
});

describe("henüz açılmadı", () => {
  it("başlangıca 15 dakikadan fazla varsa geri sayım ekranı; ad formu yok", async () => {
    guestPreflight.mockResolvedValue({ ...openPreflight(), phase: "upcoming", startsAt: new Date(Date.now() + 3 * 3_600_000).toISOString() });
    await renderFlow();
    expect(await screen.findByTestId("guest-upcoming")).toBeInTheDocument();
    expect(screen.getByTestId("guest-countdown")).toHaveTextContent("Açılmasına");
    expect(screen.queryByTestId("guest-name-form")).not.toBeInTheDocument();
  });

  it("hizmet görüşmesinde geri sayım ekranında amaç başlığı, aracı kuruluş ibaresi ve tıbbi muayene değildir notu görünür", async () => {
    harness.localeCode = "en";
    guestPreflight.mockResolvedValue({
      ...openPreflight(),
      purpose: "service_consultation",
      phase: "upcoming",
      startsAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    });
    await renderFlow();
    const notes = await screen.findByTestId("guest-purpose-notes-upcoming");
    expect(notes).toHaveTextContent("Online consultation with your WM Health patient coordinator");
    expect(notes).toHaveTextContent("health tourism intermediary");
    expect(notes).toHaveTextContent("This is not a medical examination");
  });

  it("genel toplantıda geri sayım ekranında amaç metinleri yoktur", async () => {
    guestPreflight.mockResolvedValue({ ...openPreflight(), phase: "upcoming", startsAt: new Date(Date.now() + 3 * 3_600_000).toISOString() });
    await renderFlow();
    await screen.findByTestId("guest-upcoming");
    expect(screen.queryByTestId("guest-purpose-notes-upcoming")).not.toBeInTheDocument();
  });

  it("join MEETING_NOT_OPEN dönerse açılış zamanıyla geri sayım ekranına geçer", async () => {
    guestJoin.mockRejectedValue(apiError(409, "MEETING_NOT_OPEN", { opensAt: [new Date(Date.now() + 2 * 3_600_000).toISOString()] }));
    await renderFlow();
    await fillAndJoin();
    expect(await screen.findByTestId("guest-upcoming")).toBeInTheDocument();
  });
});

describe("ad girişi", () => {
  it("başlık, ev sahibi adı, KVKK notu ve cihaz testi görünür", async () => {
    await renderFlow();
    expect(await screen.findByRole("heading", { name: "Ön görüşme" })).toBeInTheDocument();
    expect(screen.getByText(/Dr\. Elif Aydemir/)).toBeInTheDocument();
    expect(screen.getByTestId("guest-privacy")).toHaveTextContent("Yalnızca adınız ve katılım saatiniz kaydedilir");
    expect(screen.getByTestId("guest-privacy")).toHaveTextContent("Görüşmenin kendisi kaydedilmez");
  });

  it("geçersiz ad API'yi çağırmaz ve alan hatası gösterir; geçerli ad NFC/kırpılmış gider", async () => {
    await renderFlow();
    await fillAndJoin("A");
    expect(guestJoin).not.toHaveBeenCalled();
    expect(await screen.findByText("En az 2 karakter girin.")).toBeInTheDocument();

    guestJoin.mockResolvedValue({ status: "waiting", guestSession: "gs_v1.s", pollAfterSec: 5 });
    await fillAndJoin("  José   Maria ");
    expect(guestJoin).toHaveBeenCalledWith({ t: TOKEN, name: "José Maria" });
  });

  it("<script> gibi yasak karakter reddedilir", async () => {
    await renderFlow();
    await fillAndJoin("<script>");
    expect(guestJoin).not.toHaveBeenCalled();
    expect(await screen.findByText(/Harfle başlayın/)).toBeInTheDocument();
  });
});

describe("bekleme ekranı ve yoklama", () => {
  it("waiting → bekleme ekranı; 5 sn sonra aynı guestSession ile yoklar (adsız); ev sahibi gelince odaya girer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestJoin
      .mockResolvedValueOnce({ status: "waiting", guestSession: "gs_v1.s", pollAfterSec: 5 })
      .mockResolvedValueOnce({ status: "waiting", guestSession: "gs_v1.s", pollAfterSec: 5 })
      .mockResolvedValueOnce(ready());
    await renderFlow();
    await fillAndJoin();
    expect(await screen.findByTestId("guest-waiting")).toHaveTextContent("Ev sahibi bekleniyor");
    expect(guestJoin).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(guestJoin).toHaveBeenCalledTimes(2);
    expect(guestJoin).toHaveBeenLastCalledWith({ t: TOKEN, guestSession: "gs_v1.s" });
    expect(screen.getByTestId("guest-waiting")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(guestJoin).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("lk-room")).toHaveAttribute("data-token", "lk-1");
    expect(screen.getByTestId("guest-control-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-share")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guest-waiting")).not.toBeInTheDocument();
  });

  it("sekme gizliyken yoklama 15 sn'ye düşer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    guestJoin.mockResolvedValue({ status: "waiting", guestSession: "gs_v1.s", pollAfterSec: 5 });
    await renderFlow();
    await fillAndJoin();
    expect(guestJoin).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(guestJoin).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(guestJoin).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it("yoklamada geçici 429 bekleme ekranını bozmaz; sonraki yoklama sürer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestJoin
      .mockResolvedValueOnce({ status: "waiting", guestSession: "gs_v1.s", pollAfterSec: 5 })
      .mockRejectedValueOnce(apiError(429, "RATE_LIMITED"))
      .mockResolvedValueOnce(ready());
    await renderFlow();
    await fillAndJoin();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(screen.getByTestId("guest-waiting")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(screen.getByTestId("lk-room")).toBeInTheDocument();
  });

  it("bekleme sırasında bağlantı iptal edilirse (404) tek tip 'geçersiz' ekranı", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestJoin
      .mockResolvedValueOnce({ status: "waiting", guestSession: "gs_v1.s", pollAfterSec: 5 })
      .mockRejectedValueOnce(apiError(404, "MEETING_LINK_INVALID"));
    await renderFlow();
    await fillAndJoin();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(screen.getByTestId("guest-invalid")).toBeInTheDocument();
  });

  it("bekleme ekranından 'Ayrıl' yoklamayı durdurur", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestJoin.mockResolvedValue({ status: "waiting", guestSession: "gs_v1.s", pollAfterSec: 5 });
    await renderFlow();
    await fillAndJoin();
    fireEvent.click(await screen.findByRole("button", { name: "Ayrıl" }));
    expect(screen.getByTestId("guest-left")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(guestJoin).toHaveBeenCalledTimes(1);
  });
});

describe("oda", () => {
  it("ready → oda; token LiveKitRoom'a verilir", async () => {
    guestJoin.mockResolvedValue(ready());
    await renderFlow();
    await fillAndJoin();
    expect(await screen.findByTestId("lk-room")).toHaveAttribute("data-token", "lk-1");
  });

  it("MEETING_FULL → 'Toplantı dolu' ekranı", async () => {
    guestJoin.mockRejectedValue(apiError(409, "MEETING_FULL"));
    await renderFlow();
    await fillAndJoin();
    expect(await screen.findByTestId("guest-full")).toHaveTextContent("Toplantı dolu");
  });

  it("odadayken çıkarılma (terminal) → 'çıkarıldınız' ekranı; yeniden bağlanma (token isteği) YOK", async () => {
    guestJoin.mockResolvedValue(ready());
    await renderFlow();
    await fillAndJoin();
    await screen.findByTestId("lk-room");
    expect(guestJoin).toHaveBeenCalledTimes(1);
    act(() => (harness.lkProps.onDisconnected as (r?: number) => void)(4));
    expect(await screen.findByTestId("guest-removed")).toHaveTextContent("Toplantıdan çıkarıldınız");
    expect(screen.queryByTestId("reconnecting-overlay")).not.toBeInTheDocument();
    expect(guestJoin).toHaveBeenCalledTimes(1);
  });

  it("toplantı bitişinden sonra oda kapanınca (ROOM_DELETED) 'Toplantı sona erdi'", async () => {
    guestJoin.mockResolvedValue(ready());
    await renderFlow();
    await fillAndJoin();
    await screen.findByTestId("lk-room");
    act(() => (harness.lkProps.onDisconnected as (r?: number) => void)(5));
    expect(await screen.findByTestId("guest-ended")).toHaveTextContent("Toplantı sona erdi");
    expect(guestJoin).toHaveBeenCalledTimes(1);
  });

  it("kullanıcı kendi ayrılınca 'ayrıldınız' + 'Yeniden katıl' (aynı oturumla, adsız)", async () => {
    guestJoin.mockResolvedValue(ready());
    await renderFlow();
    await fillAndJoin();
    await screen.findByTestId("lk-room");
    act(() => (harness.lkProps.onDisconnected as (r?: number) => void)(1));
    expect(await screen.findByTestId("guest-left")).toBeInTheDocument();
    guestJoin.mockResolvedValue(ready(2));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yeniden katıl" }));
    });
    expect(guestJoin).toHaveBeenLastCalledWith({ t: TOKEN, guestSession: "gs_v1.session" });
    expect(await screen.findByTestId("lk-room")).toHaveAttribute("data-token", "lk-2");
  });
});

describe("dil ve yön", () => {
  it("Arapçada sayfa sağdan sola (dir=rtl) ve metinler Arapça", async () => {
    harness.localeCode = "ar";
    const { container } = render(<GuestJoinFlow />);
    await act(async () => {});
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(await screen.findByTestId("guest-name-form")).toBeInTheDocument();
    expect(screen.getByTestId("guest-join")).toHaveTextContent("انضمام");
  });
});

describe("AI İş 3 — hizmet görüşmesi amacı (purpose=service_consultation)", () => {
  const servicePreflight = () => ({ ...openPreflight(), title: "WM Health online consultation", hostName: "Patient Coordinator · Ayşe K.", purpose: "service_consultation" as const });

  it("amaç başlığı, aracı kuruluş ibaresi ve 'tıbbi muayene değildir' notu gösterilir; koordinatör adı ev sahibi satırındadır", async () => {
    harness.localeCode = "en";
    guestPreflight.mockResolvedValue(servicePreflight());
    await renderFlow();
    expect(await screen.findByRole("heading", { name: "Online consultation with your WM Health patient coordinator" })).toBeInTheDocument();
    const notes = screen.getByTestId("guest-purpose-notes");
    expect(notes).toHaveTextContent("WM Health is a health tourism intermediary, not a healthcare provider.");
    expect(notes).toHaveTextContent("This is not a medical examination. Medical assessment and treatment decisions are made by physicians at authorized healthcare facilities.");
    expect(screen.getByText(/Patient Coordinator · Ayşe K\./)).toBeInTheDocument();
  });

  it("bekleme ekranı koordinatörün alacağını söyler", async () => {
    harness.localeCode = "en";
    guestPreflight.mockResolvedValue(servicePreflight());
    guestJoin.mockResolvedValue({ status: "waiting", guestSession: "gs_v1.s", pollAfterSec: 5 });
    await renderFlow();
    fireEvent.change(await screen.findByLabelText(/Your name/), { target: { value: "Jane Roe" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("guest-join"));
    });
    expect(await screen.findByTestId("guest-waiting")).toHaveTextContent("The room opens when your coordinator joins");
    expect(screen.getByTestId("guest-purpose-notice-waiting")).toHaveTextContent("This is not a medical examination");
  });

  it("genel toplantıda (purpose yok / general) amaç metinleri görünmez", async () => {
    harness.localeCode = "en";
    guestPreflight.mockResolvedValue({ ...openPreflight(), purpose: "general" as const });
    await renderFlow();
    await screen.findByTestId("guest-name-form");
    expect(screen.queryByTestId("guest-purpose-notes")).not.toBeInTheDocument();
    expect(screen.queryByText(/patient coordinator/i)).not.toBeInTheDocument();
  });

  it.each(["Patient Coordinator", "patient coordinator Ayşe", "Coordinator", "  COORDINATOR Mehmet"])("misafir adı %j reddedilir; API çağrılmaz", async (name) => {
    harness.localeCode = "en";
    guestPreflight.mockResolvedValue(servicePreflight());
    await renderFlow();
    fireEvent.change(await screen.findByLabelText(/Your name/), { target: { value: name } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("guest-join"));
    });
    expect(guestJoin).not.toHaveBeenCalled();
    expect(await screen.findByText("This name is not allowed. Please choose another one.")).toBeInTheDocument();
  });
});
