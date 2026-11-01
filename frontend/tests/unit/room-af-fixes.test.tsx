import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import { doctor, harness, installPointerEvent, local, removeMediaDevices } from "./helpers/room-harness";

/**
 * Paket AF e2e düzeltmeleri: (1) "Yeniden bağlanılıyor…" katmanı Connected'a geçince kalkar, (2) DUPLICATE_IDENTITY sonrası
 * kendiliğinden yeniden bağlanma YOK (Room geri çağrıları kararlı → eski token ile tekrar connect yok), "Burada devam et"
 * çalışır, (4) dar ekranda çubuk tek satır + "daha fazla", (5) geri sayım / katıl düğmesi ayrı satırda.
 */
vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", async () => (await import("./helpers/room-harness")).componentsReactMock);
vi.mock("livekit-client", async () => (await import("./helpers/room-harness")).livekitClientMock);
vi.mock("@/lib/api/telehealth", async () => {
  const h = await import("./helpers/room-harness");
  return {
    getAppointment: vi.fn(async () => ({ ...h.makeAppointment(), ...h.harness.appointmentOverride })),
    requestMeetingToken: (...args: unknown[]) => h.harness.requestMeetingToken(...args),
    getRecordingStatus: vi.fn(async () => null),
  };
});
vi.mock("@/lib/api/interpreter", () => ({
  removeAppointmentInterpreter: vi.fn(async () => undefined),
  getAppointmentInterpreter: vi.fn(async () => null),
}));
vi.mock("@/lib/api/modules", () => ({ listPublicModules: vi.fn(async () => []) }));
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => ({ status: "authenticated", user: { doctorProfileId: null } }) }));
vi.mock("@/context/locale-alternates-context", () => ({ useActiveLocaleCode: () => "tr", useLocalizePath: () => (p: string) => p }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const cam = (participant: typeof local) => ({ participant, source: "camera" });
const lk = () => harness.lkProps as unknown as { onDisconnected: (r?: number) => void; onError: unknown };

async function joinRoom() {
  render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
  const user = userEvent.setup({ delay: null });
  await user.click(await screen.findByRole("button", { name: "Görüşmeye Katıl" }));
  await screen.findByTestId("lk-room");
  return user;
}

beforeAll(() => installPointerEvent());
beforeEach(() => {
  harness.reset();
  harness.participants = [local, doctor];
  harness.tracks = [cam(doctor), cam(local)];
  window.localStorage.clear();
  removeMediaDevices();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
  cleanup();
});

describe("1) yeniden bağlanılıyor katmanı", () => {
  it("Reconnecting → Disconnected → Connected (Reconnected olayı OLMADAN) sonrası katman kalkar", async () => {
    await joinRoom();
    act(() => {
      harness.setConnState("reconnecting");
      harness.room.emit("reconnecting");
    });
    expect(screen.getByTestId("reconnecting-overlay")).toBeInTheDocument();
    act(() => harness.setConnState("disconnected"));
    act(() => harness.setConnState("connected"));
    expect(screen.queryByTestId("reconnecting-overlay")).not.toBeInTheDocument();
  });

  it("Reconnected olayı gelirse de kalkar (eski yol bozulmadı)", async () => {
    await joinRoom();
    act(() => {
      harness.setConnState("reconnecting");
      harness.room.emit("reconnecting");
    });
    act(() => harness.room.emit("reconnected"));
    expect(screen.queryByTestId("reconnecting-overlay")).not.toBeInTheDocument();
  });
});

describe("2) sekme çakışması", () => {
  it("DUPLICATE_IDENTITY: ekran kalıcı; Room geri çağrıları kararlı; token isteği ve yeni mount YOK", async () => {
    await joinRoom();
    const errorBefore = lk().onError;
    act(() => lk().onDisconnected(2));
    expect(screen.getByTestId("duplicate-identity")).toBeInTheDocument();
    // Faz değişimi sonrası render'larda `onError` kimliği aynı kalır → `useLiveKitRoom` bağlanma efekti yeniden çalışmaz.
    expect(lk().onError).toBe(errorBefore);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(harness.requestMeetingToken).toHaveBeenCalledTimes(1);
    expect(harness.mounts).toEqual(["t1"]);
    expect(harness.room.connect).not.toHaveBeenCalled();
    expect(screen.getByTestId("duplicate-identity")).toBeInTheDocument();
  });

  it("'Burada devam et' yeni token ile bağlanır ve çakışma ekranı kalkar", async () => {
    const user = await joinRoom();
    act(() => lk().onDisconnected(2));
    await user.click(within(screen.getByTestId("duplicate-identity")).getByRole("button"));
    await vi.waitFor(() => expect(harness.requestMeetingToken).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(harness.mounts).toEqual(["t1", "t2"]));
    act(() => harness.setConnState("connecting"));
    act(() => harness.setConnState("connected"));
    expect(screen.queryByTestId("duplicate-identity")).not.toBeInTheDocument();
  });
});

describe("4) dar ekranda kontrol çubuğu", () => {
  it("tek satır (nowrap), ikincil düğmeler 'daha fazla' panelinde; düğmeler ≥44 px", async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes("max-width: 639px"), addEventListener: () => {}, removeEventListener: () => {}, media: q })) as never;
    (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen = vi.fn();
    const user = await joinRoom();
    const bar = await screen.findByRole("toolbar");
    expect(bar.className).toContain("flex-nowrap");
    expect(bar.className).not.toContain("flex-wrap");
    expect(within(bar).queryByRole("button", { name: "Izgara görünümüne geç" })).not.toBeInTheDocument();
    for (const b of within(bar).getAllByRole("button")) expect(b.className).toMatch(/\bh-(11|12)\b/);

    await user.click(await within(bar).findByRole("button", { name: "Daha fazla" }));
    const panel = screen.getByTestId("more-panel");
    expect(within(panel).getByRole("button", { name: "Izgara görünümüne geç" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Ekranı paylaş" })).toBeInTheDocument();
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
  });
});

describe("5) giriş öncesi geri sayım", () => {
  it("rakamlar blok; 'Görüşmeye Katıl' kendi satırında", async () => {
    harness.appointmentOverride = { startsAt: new Date(Date.now() + 5 * 60_000).toISOString(), endsAt: new Date(Date.now() + 35 * 60_000).toISOString() };
    render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    const button = await screen.findByRole("button", { name: "Görüşmeye Katıl" });
    expect(button.parentElement!.className).toContain("mt-4");
    expect(button.parentElement!.tagName).toBe("DIV");
    const digits = button.closest(".text-center")!.querySelector("span.font-heading");
    expect(digits?.className).toContain("block");
  });
});
