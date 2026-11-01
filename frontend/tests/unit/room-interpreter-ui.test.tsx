import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InterpreterAssignment } from "@/lib/api/types";
import { doctor, harness, installMediaDevices, makeLocalTrack, removeMediaDevices } from "./helpers/room-harness";

/**
 * Paket AF (Aşama 2) — tercüman odası: YALNIZCA arayüz eklemeleri (kamerayı çevir, cihaz ayarları, yerel önizleme aynalama).
 * Yetki / token akışı bu testlerin konusu değildir (bkz. interpreter-panel-room / interpreter-room-reconnect testleri).
 */
vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", async () => (await import("./helpers/room-harness")).componentsReactMock);
vi.mock("livekit-client", async () => (await import("./helpers/room-harness")).livekitClientMock);
vi.mock("@/lib/api/interpreter", () => ({
  listInterpreterAssignments: async () => [assignment],
  requestInterpreterToken: async () => ({ token: "i1", serverUrl: "wss://lk", roomName: "r", expiresAt: "x", sessionId: "s1" }),
  leaveInterpreterSession: vi.fn(async () => undefined),
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
const me = { identity: "interpreter:p1:b1", metadata: '{"role":"interpreter","language":"ar"}', isLocal: true };

async function joinRoom() {
  render(<InterpreterRoom assignmentId="as-1" />);
  const user = userEvent.setup({ delay: null });
  await user.click(await screen.findByRole("button", { name: "Katıl" }));
  await screen.findByTestId("lk-room");
  return user;
}

beforeEach(() => {
  harness.reset();
  window.localStorage.clear();
  removeMediaDevices();
  harness.participants = [me, doctor];
  harness.tracks = [
    { participant: doctor, source: "camera" },
    { participant: me, source: "camera" },
  ];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("tercüman odası — arayüz eklemeleri", () => {
  it("birden çok kamera varsa 'Kamerayı çevir' çalışır; arka kamerada yerel önizleme aynalanmaz", async () => {
    installMediaDevices([
      { kind: "videoinput", deviceId: "cam-front", label: "Front" },
      { kind: "videoinput", deviceId: "cam-back", label: "Back" },
    ]);
    const track = makeLocalTrack({ facingMode: "user", deviceId: "cam-front" });
    track.restartTrack.mockImplementation(async (opts?: { facingMode?: string }) => {
      track.settings.facingMode = opts?.facingMode;
      track.settings.deviceId = opts?.facingMode === "environment" ? "cam-back" : "cam-front";
    });
    harness.room.publications.camera = { videoTrack: track };
    const user = await joinRoom();

    const local = document.querySelector('[data-local-camera="true"]')!;
    expect(local).toHaveAttribute("data-mirrored", "true");
    const flip = await screen.findByRole("button", { name: "Kamerayı çevir" });
    expect(flip.className).toMatch(/\bh-11\b/);
    await user.click(flip);
    expect(track.restartTrack).toHaveBeenCalledWith({ facingMode: "environment" });
    expect(local).toHaveAttribute("data-mirrored", "false");
    expect(harness.room.disconnect).not.toHaveBeenCalled();
  });

  it("ayarlar düğmesi cihaz ayarları panelini açar; leave düğmesi ve yetki akışı yerinde", async () => {
    installMediaDevices([{ kind: "videoinput", deviceId: "cam-front", label: "Front" }]);
    const user = await joinRoom();
    await user.click(screen.getByRole("button", { name: "Ayarlar" }));
    const panel = await screen.findByRole("dialog", { name: "Cihaz ayarları" });
    expect(within(panel).getByRole("switch", { name: "Gürültü bastırma" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("interpreter-leave")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kamerayı çevir" })).not.toBeInTheDocument();
  });
});
