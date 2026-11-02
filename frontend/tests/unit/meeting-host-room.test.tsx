import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HostMeetingRoom } from "@/components/site/meeting/host-meeting-room";
import { MeetingParticipantsPanel, splitGuests } from "@/components/site/meeting/meeting-participants-panel";
import { ApiClientError } from "@/lib/api/error";
import type { Meeting, MeetingGuestRow } from "@/lib/api/meetings";
import { harness, installPointerEvent, removeMediaDevices } from "./helpers/room-harness";

/**
 * Paket AG İş 3 — ev sahibi odası ve katılımcılar paneli: ADMIN dahil ev sahibi olmayan "bulunamadı" görür; pencere dışında
 * "Katıl" pasif; oturumsuz ziyaretçi giriş ister; panelde bekleyen/odadaki misafirler, "Çıkar", doğrudan al anahtarı;
 * kabul/ret lobisi YOK (S8); yeni bağlantı eskisini geçersiz kılar uyarısı.
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

let authState: { status: string; user: Record<string, unknown> | null } = { status: "authenticated", user: { id: "u1", role: "EDITOR", doctorProfileId: null } };
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => authState }));

const api = {
  getMeeting: vi.fn(),
  requestHostToken: vi.fn(),
  listMeetingGuests: vi.fn(),
  removeMeetingGuest: vi.fn(),
  updateMeeting: vi.fn(),
  regenerateGuestLink: vi.fn(),
};
vi.mock("@/lib/api/meetings", () => ({
  getMeeting: (...a: unknown[]) => api.getMeeting(...a),
  requestHostToken: (...a: unknown[]) => api.requestHostToken(...a),
  listMeetingGuests: (...a: unknown[]) => api.listMeetingGuests(...a),
  removeMeetingGuest: (...a: unknown[]) => api.removeMeetingGuest(...a),
  updateMeeting: (...a: unknown[]) => api.updateMeeting(...a),
  regenerateGuestLink: (...a: unknown[]) => api.regenerateGuestLink(...a),
  sendMeetingInviteEmail: vi.fn(),
}));

const HOUR = 3_600_000;
function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    title: "Ön görüşme",
    note: null,
    startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + HOUR).toISOString(),
    durationMin: 30,
    maxParticipants: 4,
    autoAdmitGuests: false,
    status: "SCHEDULED",
    phase: "upcoming",
    hostJoinedAt: null,
    guestLinkActive: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}
const guest = (overrides: Partial<MeetingGuestRow> = {}): MeetingGuestRow => ({
  id: "g1",
  displayName: "Zeynep Kaya",
  createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  admittedAt: null,
  removedAt: null,
  waiting: true,
  ...overrides,
});

beforeAll(() => installPointerEvent());
beforeEach(() => {
  harness.reset();
  removeMediaDevices();
  window.localStorage.clear();
  Object.values(api).forEach((fn) => fn.mockReset());
  router.push.mockReset();
  authState = { status: "authenticated", user: { id: "u1", role: "EDITOR", doctorProfileId: null } };
  api.getMeeting.mockResolvedValue(meeting());
  api.listMeetingGuests.mockResolvedValue([]);
  api.requestHostToken.mockResolvedValue({ token: "host-tok", serverUrl: "wss://lk.example.com", roomName: "meet_abc", expiresAt: "2026-12-01T12:00:00.000Z" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

async function renderHost() {
  render(<HostMeetingRoom meetingId="m1" />);
  await act(async () => {});
}

describe("HostMeetingRoom", () => {
  it("oturumsuz ziyaretçi giriş yapması istenir; API çağrılmaz", async () => {
    authState = { status: "unauthenticated", user: null };
    await renderHost();
    expect(screen.getByTestId("host-room-signin")).toBeInTheDocument();
    expect(api.getMeeting).not.toHaveBeenCalled();
  });

  it("ev sahibi olmayan (ADMIN dahil) 404 → 'bulunamadı'; başka ayrıntı sızmaz", async () => {
    authState = { status: "authenticated", user: { id: "admin1", role: "ADMIN", doctorProfileId: null } };
    api.getMeeting.mockRejectedValue(new ApiClientError(404, { code: "MEETING_NOT_FOUND", message: "RAW" }));
    await renderHost();
    const notFound = screen.getByTestId("host-room-notfound");
    expect(notFound).toHaveTextContent("bulunamadı ya da ev sahibi siz değilsiniz");
    expect(notFound.textContent).not.toContain("RAW");
    expect(api.requestHostToken).not.toHaveBeenCalled();
  });

  it("pencere içinde ön ekran: başlık + Katıl etkin; Katıl → host-token → oda + katılımcılar paneli", async () => {
    await renderHost();
    expect(screen.getByRole("heading", { name: "Ön görüşme" })).toBeInTheDocument();
    const join = screen.getByTestId("host-room-join");
    expect(join).toBeEnabled();
    await act(async () => {
      fireEvent.click(join);
    });
    expect(api.requestHostToken).toHaveBeenCalledWith("m1");
    expect(screen.getByTestId("lk-room")).toHaveAttribute("data-token", "host-tok");
    expect(harness.lkProps["data-mode"]).toBe("host");
    expect(screen.getByTestId("bar-share")).toBeInTheDocument();
    expect(screen.getByTestId("meeting-participants-panel")).toBeInTheDocument();
  });

  it("pencere dışında (başlangıca > 15 dk) Katıl pasif ve geri sayım görünür", async () => {
    api.getMeeting.mockResolvedValue(meeting({ startsAt: new Date(Date.now() + 3 * HOUR).toISOString(), endsAt: new Date(Date.now() + 4 * HOUR).toISOString() }));
    await renderHost();
    expect(screen.getByTestId("host-room-join")).toBeDisabled();
    expect(screen.getByTestId("host-room-countdown")).toBeInTheDocument();
    expect(api.requestHostToken).not.toHaveBeenCalled();
  });

  it("iptal edilmiş toplantıda oda açılmaz", async () => {
    api.getMeeting.mockResolvedValue(meeting({ status: "CANCELLED", phase: "cancelled" }));
    await renderHost();
    expect(screen.getByTestId("host-room-ended")).toHaveTextContent("Bu toplantı iptal edildi.");
    expect(screen.queryByTestId("host-room-join")).not.toBeInTheDocument();
  });

  it("ayrılınca panel listesine döner (panel kullanıcısı → /admin/meetings)", async () => {
    await renderHost();
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-room-join"));
    });
    act(() => (harness.lkProps.onDisconnected as (r?: number) => void)(1));
    expect(router.push).toHaveBeenCalledWith("/admin/meetings");
  });

  it("doktor ayrılınca doktor portalındaki listeye döner", async () => {
    authState = { status: "authenticated", user: { id: "u1", role: "USER", doctorProfileId: "d1" } };
    await renderHost();
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-room-join"));
    });
    act(() => (harness.lkProps.onDisconnected as (r?: number) => void)(1));
    expect(router.push).toHaveBeenCalledWith("/doctor/meetings");
  });
});

describe("splitGuests", () => {
  it("bekleyen / odadaki ayrımı; çıkarılanlar hiçbirinde yok", () => {
    const rows = [
      guest({ id: "w", waiting: true }),
      guest({ id: "i", waiting: false, admittedAt: new Date().toISOString() }),
      guest({ id: "r", waiting: false, admittedAt: new Date().toISOString(), removedAt: new Date().toISOString() }),
      guest({ id: "n", waiting: false, admittedAt: null }),
    ];
    const { waiting, inRoom } = splitGuests(rows);
    expect(waiting.map((g) => g.id)).toEqual(["w"]);
    expect(inRoom.map((g) => g.id)).toEqual(["i"]);
  });
});

describe("MeetingParticipantsPanel", () => {
  const base = { id: "m1", title: "Ön görüşme", startsAt: new Date(Date.now() + 5 * 60_000).toISOString(), autoAdmitGuests: false };

  async function renderPanel(onMeetingChange = vi.fn()) {
    render(<MeetingParticipantsPanel meeting={base} onMeetingChange={onMeetingChange} />);
    await act(async () => {});
    return onMeetingChange;
  }

  it("bekleyen misafir adı ve bekleme süresi; adlar düz metin (HTML çalışmaz)", async () => {
    api.listMeetingGuests.mockResolvedValue([guest({ displayName: "<b>Ali</b>" })]);
    await renderPanel();
    const list = screen.getByTestId("meeting-waiting-list");
    expect(list).toHaveTextContent("<b>Ali</b>");
    expect(list.querySelector("b")).toBeNull();
    expect(list).toHaveTextContent("3 dk bekliyor");
    expect(screen.getByText("Katılmayı bekleyenler (1)")).toBeInTheDocument();
  });

  it("odadaki misafir listelenir; kabul / ret düğmesi YOKTUR, yalnızca 'Çıkar'", async () => {
    api.listMeetingGuests.mockResolvedValue([guest({ id: "g2", displayName: "Mehmet", waiting: false, admittedAt: new Date().toISOString() })]);
    await renderPanel();
    const inRoom = screen.getByTestId("meeting-inroom-list");
    expect(inRoom).toHaveTextContent("Mehmet");
    expect(screen.queryByRole("button", { name: /kabul|reddet|accept|reject|admit/i })).not.toBeInTheDocument();
    expect(within(inRoom).getByRole("button", { name: "Mehmet kişisini toplantıdan çıkar" })).toBeInTheDocument();
  });

  it("Çıkar → removeMeetingGuest; durum bölgesi duyurur; liste tazelenir", async () => {
    api.listMeetingGuests.mockResolvedValueOnce([guest()]).mockResolvedValue([]);
    api.removeMeetingGuest.mockResolvedValue(undefined);
    await renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zeynep Kaya kişisini toplantıdan çıkar" }));
    });
    expect(api.removeMeetingGuest).toHaveBeenCalledWith("m1", "g1");
    expect(screen.getByTestId("meeting-panel-status")).toHaveTextContent("Zeynep Kaya çıkarıldı.");
    expect(screen.getByText("Bekleyen kimse yok.")).toBeInTheDocument();
  });

  it("'Misafirleri doğrudan al' anahtarı PATCH eder; hata olursa geri alınır", async () => {
    api.updateMeeting.mockResolvedValue(meeting({ autoAdmitGuests: true }));
    const onChange = await renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /Ben katılmadan da misafirleri içeri al/ }));
    });
    expect(api.updateMeeting).toHaveBeenCalledWith("m1", { autoAdmitGuests: true });
    expect(onChange).toHaveBeenCalledWith({ autoAdmitGuests: true });

    api.updateMeeting.mockRejectedValue(new ApiClientError(409, { code: "MEETING_NOT_EDITABLE", message: "RAW" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /Ben katılmadan da misafirleri içeri al/ }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ autoAdmitGuests: false });
    expect(screen.getByRole("alert")).toHaveTextContent("Bu toplantı artık değiştirilemez.");
  });

  it("yeni bağlantı: 'eski bağlantıyı geçersiz kılar' uyarısı; onaylanınca yeni bağlantı kartı", async () => {
    api.regenerateGuestLink.mockResolvedValue({ guestLink: "https://site.test/tr/meet/join#mg_new" });
    await renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByTestId("meeting-panel-new-link"));
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("eski bağlantıyı geçersiz kılar");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Yeni bağlantı üret" }));
    });
    expect(api.regenerateGuestLink).toHaveBeenCalledWith("m1");
    expect(within(await screen.findByTestId("meeting-link-card")).getByLabelText("Misafir bağlantısı")).toHaveValue("https://site.test/tr/meet/join#mg_new");
  });

  it("5 sn'de bir yoklar; sekme gizliyken 15 sn", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderPanel();
    expect(api.listMeetingGuests).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(api.listMeetingGuests).toHaveBeenCalledTimes(2);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(api.listMeetingGuests).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(api.listMeetingGuests).toHaveBeenCalledTimes(3);
    visibility.mockRestore();
  });
});
