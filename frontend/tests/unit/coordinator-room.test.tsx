import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CoordinatorRoom } from "@/components/admin/service-desk/coordinator-room";
import { ApiClientError } from "@/lib/api/error";
import type { CoordinatorConsultationDetail } from "@/lib/api/service-desk-admin";
import { harness, installPointerEvent, removeMediaDevices } from "./helpers/room-harness";

/**
 * AI İş 3 — koordinatör odası: AG HostMeetingRoom/MeetingRoom koordinatör uçlarıyla (host-token) kullanılır; AG
 * `GET /meetings/:id` ve `POST /meetings/:id/host-token` ÇAĞRILMAZ; katılımcı paneli yok; kayıt yok; çıkışta listeye dönülür.
 */
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
const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
let authState: { status: string; user: Record<string, unknown> | null } = { status: "authenticated", user: { id: "e1", role: "EDITOR", doctorProfileId: null, isServiceCoordinator: true } };
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => authState }));

const meetingsApi = { getMeeting: vi.fn(), requestHostToken: vi.fn(), listMeetingGuests: vi.fn() };
vi.mock("@/lib/api/meetings", () => ({
  getMeeting: (...a: unknown[]) => meetingsApi.getMeeting(...a),
  requestHostToken: (...a: unknown[]) => meetingsApi.requestHostToken(...a),
  listMeetingGuests: (...a: unknown[]) => meetingsApi.listMeetingGuests(...a),
  removeMeetingGuest: vi.fn(),
  updateMeeting: vi.fn(),
  regenerateGuestLink: vi.fn(),
  sendMeetingInviteEmail: vi.fn(),
}));
const deskApi = { getCoordinatorConsultation: vi.fn(), requestCoordinatorHostToken: vi.fn() };
vi.mock("@/lib/api/service-desk-admin", () => ({
  getCoordinatorConsultation: (...a: unknown[]) => deskApi.getCoordinatorConsultation(...a),
  requestCoordinatorHostToken: (...a: unknown[]) => deskApi.requestCoordinatorHostToken(...a),
}));

const MIN = 60_000;
function consultation(startOffsetMin: number, overrides: Partial<CoordinatorConsultationDetail> = {}): CoordinatorConsultationDetail {
  const start = Date.now() + startOffsetMin * MIN;
  return {
    id: "c1",
    consultationNumber: "SVC-00001",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 30 * MIN).toISOString(),
    status: "SCHEDULED",
    serviceName: "Hair transplant",
    patientName: "Zeynep Yılmaz",
    country: "DE",
    contactLanguage: "de",
    needsInterpreter: false,
    interpreterLanguage: null,
    preferredContactChannel: "email",
    hasMessage: false,
    joinOpensAt: new Date(start - 15 * MIN).toISOString(),
    canJoin: true,
    email: "z@example.com",
    phone: null,
    ...overrides,
  };
}

beforeAll(() => installPointerEvent());
beforeEach(() => {
  harness.reset();
  removeMediaDevices();
  window.localStorage.clear();
  Object.values(meetingsApi).forEach((fn) => fn.mockReset());
  Object.values(deskApi).forEach((fn) => fn.mockReset());
  router.push.mockReset();
  authState = { status: "authenticated", user: { id: "e1", role: "EDITOR", doctorProfileId: null, isServiceCoordinator: true } };
  deskApi.getCoordinatorConsultation.mockResolvedValue(consultation(5));
  deskApi.requestCoordinatorHostToken.mockResolvedValue({ token: "coord-tok", serverUrl: "wss://lk.example.com", roomName: "meet_abc", expiresAt: "2026-12-01T12:00:00.000Z" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

async function renderRoom() {
  render(<CoordinatorRoom consultationId="c1" />);
  await act(async () => {});
}

describe("CoordinatorRoom", () => {
  it("görüşmeyi koordinatör ucundan yükler; sabit oda başlığını gösterir (hasta/hizmet adı yok)", async () => {
    await renderRoom();
    expect(deskApi.getCoordinatorConsultation).toHaveBeenCalledWith("c1");
    expect(meetingsApi.getMeeting).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "WM Health online consultation" })).toBeInTheDocument();
    expect(screen.queryByText(/Zeynep/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hair transplant/)).not.toBeInTheDocument();
  });

  it("Katıl -> POST /coordinator/.../host-token; oda ev sahibi modunda, katılımcı paneli YOK, AG host-token çağrılmaz", async () => {
    await renderRoom();
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-room-join"));
    });
    expect(deskApi.requestCoordinatorHostToken).toHaveBeenCalledWith("c1");
    expect(meetingsApi.requestHostToken).not.toHaveBeenCalled();
    expect(screen.getByTestId("lk-room")).toHaveAttribute("data-token", "coord-tok");
    expect(harness.lkProps["data-mode"]).toBe("host");
    expect(screen.getByTestId("bar-share")).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-participants-panel")).not.toBeInTheDocument();
    expect(meetingsApi.listMeetingGuests).not.toHaveBeenCalled();
  });

  it("pencere dışında (başlangıca 3 saat) Katıl pasif, token istenmez", async () => {
    deskApi.getCoordinatorConsultation.mockResolvedValue(consultation(180));
    await renderRoom();
    expect(screen.getByTestId("host-room-join")).toBeDisabled();
    expect(deskApi.requestCoordinatorHostToken).not.toHaveBeenCalled();
  });

  it("başkasının görüşmesi (404) -> 'bulunamadı' ekranı ve listeye dönüş bağlantısı", async () => {
    deskApi.getCoordinatorConsultation.mockRejectedValue(new ApiClientError(404, { code: "NOT_FOUND", message: "raw" }));
    await renderRoom();
    expect(screen.getByTestId("host-room-notfound")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /.+/ })).toHaveAttribute("href", "/admin/my-consultations");
  });

  it("iptal edilmiş görüşmede oda açılmaz", async () => {
    deskApi.getCoordinatorConsultation.mockResolvedValue(consultation(5, { status: "CANCELLED" }));
    await renderRoom();
    expect(screen.getByTestId("host-room-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("host-room-join")).not.toBeInTheDocument();
  });

  it("odadan ayrılınca Görüşmelerim listesine döner", async () => {
    await renderRoom();
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-room-join"));
    });
    await act(async () => {
      (harness.lkProps.onDisconnected as (r?: number) => void)(1);
    });
    expect(router.push).toHaveBeenCalledWith("/admin/my-consultations");
  });
});
