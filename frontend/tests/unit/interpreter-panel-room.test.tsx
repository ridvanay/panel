import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resolvePostLoginPath } from "@/lib/post-login-destination";
import type { InterpreterAssignment, InterpreterMe } from "@/lib/api/types";

/**
 * Paket AA — tercüman tarafı: panel (2FA → taahhüt → atamalar; hastanın yalnızca baş harfi), tercümanın
 * görüşme ekranı (yalnızca hasta/doktor videoları, kendi kamera/mikrofon ve Ayrıl; kayıt/belge/not
 * kontrolü YOK; kayıt açıksa uyarı), randevu sihirbazındaki talep kutusu ve giriş sonrası yönlendirme.
 */
type FakeParticipant = { identity: string; metadata?: string; isLocal: boolean };
let participants: FakeParticipant[] = [];
let tracks: { participant: FakeParticipant; source: string }[] = [];

vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: { children?: React.ReactNode }) => <div data-testid="lk-room">{props.children}</div>,
  ParticipantTile: ({ trackRef }: { trackRef: { participant: FakeParticipant } }) => <div data-testid="tile" data-identity={trackRef.participant.identity} />,
  RoomAudioRenderer: () => null,
  TrackToggle: ({ source, "aria-label": label }: { source: string; "aria-label": string }) => <button type="button" aria-label={label} data-source={source} />,
  useParticipants: () => participants,
  useTracks: () => tracks,
  useRoomContext: () => ({ disconnect: vi.fn() }),
}));
vi.mock("livekit-client", () => ({
  DisconnectReason: { PARTICIPANT_REMOVED: "participant-removed" },
  Track: { Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" } },
}));

let me: InterpreterMe;
let meError: unknown = null;
let assignments: InterpreterAssignment[];
let recordingStatus: string | null = null;
const acceptInterpreterConfidentiality = vi.fn(async () => undefined);
const requestInterpreterToken = vi.fn(async () => ({ token: "t", serverUrl: "wss://lk", roomName: "r", expiresAt: "x", sessionId: "s" }));
const setInterpreterRequest = vi.fn(async () => undefined);
vi.mock("@/lib/api/interpreter", () => ({
  getInterpreterMe: async () => {
    if (meError) throw meError;
    return me;
  },
  listInterpreterAssignments: async () => assignments,
  acceptInterpreterConfidentiality: (...a: unknown[]) => acceptInterpreterConfidentiality(...(a as [])),
  requestInterpreterToken: (...a: unknown[]) => requestInterpreterToken(...(a as [])),
  leaveInterpreterSession: vi.fn(async () => undefined),
  leaveInterpreterSessionOnUnload: vi.fn(),
  getInterpreterRecordingStatus: async () => ({ status: recordingStatus }),
  setInterpreterRequest: (...a: unknown[]) => setInterpreterRequest(...(a as [])),
}));
vi.mock("@/components/site/security/two-factor-setup-panel", () => ({ TwoFactorSetupPanel: () => <div data-testid="2fa-setup" /> }));
let sessionRole = "INTERPRETER";
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => ({ status: "authenticated", user: { role: sessionRole } }) }));
vi.mock("@/context/locale-alternates-context", () => ({ useActiveLocaleCode: () => "tr", useLocalizePath: () => (p: string) => p }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { InterpreterPanel } from "@/components/site/interpreter/interpreter-panel";
import { InterpreterRoom } from "@/components/site/interpreter/interpreter-room";
import { InterpreterRequestBox } from "@/components/site/interpreter/interpreter-request-box";

const assignment: InterpreterAssignment = {
  id: "as-1",
  language: "ar",
  languageName: "العربية",
  status: "ASSIGNED",
  startsAt: "2026-11-02T09:00:00.000Z",
  endsAt: "2026-11-02T09:30:00.000Z",
  doctorDisplayName: "H. Sofu",
  patientInitial: "Z.",
  canJoin: true,
  past: false,
};

function baseMe(over: Partial<InterpreterMe> = {}): InterpreterMe {
  return {
    displayName: "A. Yılmaz",
    languages: ["ar", "tr"],
    timeZone: "Europe/Istanbul",
    isActive: true,
    twoFactorEnabled: true,
    twoFactorRequired: false,
    confidentiality: { accepted: true, acceptedAt: "2026-10-30T00:00:00Z", version: "v-abc12345", textEn: "EN text", textTr: "Gizlilik taahhüdü metni" },
    ...over,
  };
}

beforeEach(() => {
  me = baseMe();
  meError = null;
  sessionRole = "INTERPRETER";
  assignments = [assignment];
  recordingStatus = null;
  participants = [];
  tracks = [];
  acceptInterpreterConfidentiality.mockClear();
  requestInterpreterToken.mockClear();
  setInterpreterRequest.mockClear();
});

describe("tercüman paneli", () => {
  it("2FA zorunluysa (admin ayarı) ve kurulmamışsa önce kurulum paneli", async () => {
    me = baseMe({ twoFactorEnabled: false, twoFactorRequired: true });
    render(<InterpreterPanel />);
    expect(await screen.findByTestId("2fa-setup")).toBeInTheDocument();
    expect(screen.getByText("İki adımlı doğrulama gerekli")).toBeInTheDocument();
  });

  it("Paket AA-ek: 2FA zorunlu değilse 2FA'sız tercüman doğrudan atamalarını görür", async () => {
    me = baseMe({ twoFactorEnabled: false, twoFactorRequired: false });
    render(<InterpreterPanel />);
    expect(await screen.findByTestId("interpreter-assignment")).toBeInTheDocument();
    expect(screen.queryByTestId("2fa-setup")).not.toBeInTheDocument();
  });

  it("Paket AA-ek: erişim rolden değil profilden — ADMIN rolüyle profil varsa panel açılır, profil yoksa 'yetki yok' mesajı", async () => {
    sessionRole = "ADMIN";
    const { unmount } = render(<InterpreterPanel />);
    expect(await screen.findByTestId("interpreter-assignment")).toBeInTheDocument();
    unmount();
    const { ApiClientError } = await import("@/lib/api/error");
    meError = Object.assign(Object.create(ApiClientError.prototype), { status: 403, code: "FORBIDDEN", message: "x" });
    sessionRole = "USER";
    render(<InterpreterPanel />);
    expect(await screen.findByTestId("interpreter-no-access")).toHaveTextContent("Bu hesapta tercümanlık yetkisi yok");
  });

  it("taahhüt onaylanmadan görüşme listesi yok; kutu işaretlenince güncel sürümle onaylanır", async () => {
    me = baseMe({ confidentiality: { accepted: false, acceptedAt: null, version: "v-abc12345", textEn: "EN", textTr: "Gizlilik taahhüdü metni" } });
    render(<InterpreterPanel />);
    expect(await screen.findByTestId("confidentiality-text")).toHaveTextContent("Gizlilik taahhüdü metni");
    expect(screen.queryByTestId("interpreter-assignment")).not.toBeInTheDocument();
    const user = userEvent.setup();
    const accept = screen.getByRole("button", { name: "Onayla ve devam et" });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(accept);
    await waitFor(() => expect(acceptInterpreterConfidentiality).toHaveBeenCalledWith("v-abc12345"));
  });

  it("atamalar: dil, doktorun görünen adı, hastanın yalnızca baş harfi ve Katıl bağlantısı", async () => {
    render(<InterpreterPanel />);
    const row = await screen.findByTestId("interpreter-assignment");
    expect(row).toHaveTextContent("العربية");
    expect(row).toHaveTextContent("H. Sofu");
    expect(row).toHaveTextContent("Hasta: Z.");
    expect(screen.getByRole("link", { name: "Katıl" })).toHaveAttribute("href", "/interpreter/session/as-1");
  });
});

describe("tercümanın görüşme ekranı", () => {
  it("katılınca yalnızca kamera/mikrofon ve Ayrıl; kayıt/belge/not kontrolleri yok; dinleyici kutusu gösterilmez", async () => {
    participants = [
      { identity: "interpreter:p1:b1", isLocal: true },
      { identity: "doctor:d1", isLocal: false },
      { identity: "patient:a1", isLocal: false },
      { identity: "qa-listener-u1", metadata: '{"role":"qa_listener"}', isLocal: false },
    ];
    tracks = participants.map((p) => ({ participant: p, source: "camera" }));
    render(<InterpreterRoom assignmentId="as-1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Katıl" }));
    await waitFor(() => expect(requestInterpreterToken).toHaveBeenCalledWith("as-1"));
    expect(screen.getByRole("button", { name: "Mikrofon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kamera" })).toBeInTheDocument();
    expect(screen.getByTestId("interpreter-leave")).toHaveTextContent("Ayrıl");
    const identities = screen.getAllByTestId("tile").map((el) => el.getAttribute("data-identity"));
    expect(identities).toEqual(expect.arrayContaining(["doctor:d1", "patient:a1", "interpreter:p1:b1"]));
    expect(identities).not.toContain("qa-listener-u1");
    expect(screen.queryByRole("button", { name: /kayd|record/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/belge|not ekle|reçete/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ekran|screen/i })).not.toBeInTheDocument();
  });

  it("kayıt açıksa 'Bu görüşme kaydediliyor' uyarısı", async () => {
    recordingStatus = "RECORDING";
    render(<InterpreterRoom assignmentId="as-1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Katıl" }));
    expect(await screen.findByTestId("interpreter-recording-notice")).toHaveTextContent("Bu görüşme kaydediliyor.");
  });

  it("katılım kapalıysa düğme pasif ('Henüz açılmadı')", async () => {
    assignments = [{ ...assignment, canJoin: false }];
    render(<InterpreterRoom assignmentId="as-1" />);
    expect(await screen.findByRole("button", { name: "Henüz açılmadı" })).toBeDisabled();
  });
});

describe("randevu sihirbazı talep kutusu", () => {
  it("işaretlenince seçili dil kaydedilir, kaldırılınca talep silinir; onay sonrası bilgi cümlesi", async () => {
    render(<InterpreterRequestBox bookingId="b1" accessToken="tok" languages={[{ code: "ar", nativeName: "العربية" }, { code: "ru", nativeName: "Русский" }]} defaultLanguage="ru" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(setInterpreterRequest).toHaveBeenLastCalledWith("b1", "ru", "tok"));
    expect(await screen.findByText(/Görüşmenize gizlilik taahhüdü vermiş bir tercüman katılacaktır\./)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(setInterpreterRequest).toHaveBeenLastCalledWith("b1", null, "tok"));
  });

  it("dil listesi boşsa (interpreterIncluded kapalı) render edilmez", () => {
    const { container } = render(<InterpreterRequestBox bookingId="b1" languages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("giriş sonrası yönlendirme", () => {
  it("INTERPRETER /interpreter'a gider; güvenli /en/interpreter/... dönüşü korunur; admin/doktor yolu kabul edilmez", () => {
    const base = { doctorProfileId: null, telehealthEnabled: true, role: "INTERPRETER" as const };
    expect(resolvePostLoginPath({ ...base, next: null })).toBe("/interpreter");
    expect(resolvePostLoginPath({ ...base, next: "/en/interpreter/session/x" })).toBe("/en/interpreter/session/x");
    expect(resolvePostLoginPath({ ...base, next: "/admin" })).toBe("/interpreter");
    expect(resolvePostLoginPath({ ...base, next: "//evil.com/interpreter" })).toBe("/interpreter");
  });
});
