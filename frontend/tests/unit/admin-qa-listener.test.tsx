import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QaListenerJoinDialog } from "@/components/admin/telehealth/qa-listener-join-dialog";
import { QaListenerSessionPanel, describeParticipant } from "@/components/admin/telehealth/qa-listener-session-panel";
import type { Appointment } from "@/lib/api/types";

/** Paket C — admin dinleyici akışı: zorunlu gerekçe, yalnızca-dinleme odası, tek seferlik ayrılış kaydı. */

let liveKitProps: Record<string, unknown> = {};
vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    liveKitProps = props;
    return props.children ?? null;
  },
  RoomAudioRenderer: () => null,
  useConnectionState: () => "connected",
  useParticipants: () => [
    { identity: "doctor:d1", isLocal: false },
    { identity: "qa-listener-admin-1", isLocal: true },
  ],
}));
vi.mock("livekit-client", () => ({ ConnectionState: { Connected: "connected" } }));

const requestQaListenerToken = vi.fn();
const leaveQaListenerSession = vi.fn();
const requestMeetingToken = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  requestQaListenerToken: (...args: unknown[]) => requestQaListenerToken(...args),
  leaveQaListenerSession: (...args: unknown[]) => leaveQaListenerSession(...args),
  requestMeetingToken: (...args: unknown[]) => requestMeetingToken(...args),
}));

const appointment = {
  id: "appointment-1",
  doctorId: "d1",
  doctor: { id: "d1", title: "Dr.", fullName: "Elif Aydemir", slug: "dr-elif" },
  patientName: "Test Hasta",
  status: "IN_PROGRESS",
} as unknown as Appointment;

const session = { token: "t", serverUrl: "wss://lk", roomName: "r", expiresAt: "2026-10-18T10:10:00.000Z", sessionId: "s-1" };

describe("QaListenerJoinDialog", () => {
  beforeEach(() => requestQaListenerToken.mockReset());

  it("gerekçe en az 10 karakter olmadan katılım düğmesi pasif; onaylanınca gerekçeyle token istenir", async () => {
    const onJoined = vi.fn();
    requestQaListenerToken.mockResolvedValue(session);
    render(<QaListenerJoinDialog open onOpenChange={vi.fn()} appointment={appointment} onJoined={onJoined} />);
    const user = userEvent.setup();

    expect(screen.getByText(/bu görüşmeyi dinliyor/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Dinleyici olarak katıl" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/Katılım gerekçesi/), "kısa");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Katılım gerekçesi/), " ama artık yeterli");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(appointment, session));
    expect(requestQaListenerToken).toHaveBeenCalledWith("appointment-1", "kısa ama artık yeterli");
  });
});

describe("QaListenerSessionPanel", () => {
  beforeEach(() => {
    leaveQaListenerSession.mockReset();
    requestMeetingToken.mockReset();
  });

  it("yayın yapmadan bağlanır, katılımcıları PII'siz etiketler; 'Ayrıl' ayrılışı TEK KEZ bildirir", async () => {
    const onEnded = vi.fn();
    const { unmount } = render(<QaListenerSessionPanel appointment={appointment} session={session} onEnded={onEnded} />);

    expect(liveKitProps.audio).toBe(false);
    expect(liveKitProps.video).toBe(false);
    expect(screen.getByText("Doktor")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /Ayrıl/ }));
    expect(onEnded).toHaveBeenCalled();
    // Bağlantı kopması + unmount + pagehide aynı oturum için ikinci kayıt üretmez.
    (liveKitProps.onDisconnected as () => void)();
    window.dispatchEvent(new Event("pagehide"));
    unmount();
    await new Promise((r) => setTimeout(r, 5));
    expect(leaveQaListenerSession).toHaveBeenCalledTimes(1);
    expect(leaveQaListenerSession).toHaveBeenCalledWith("appointment-1", "s-1", {});
    expect(requestMeetingToken).not.toHaveBeenCalled();
  });

  it("sayfadan ayrılırken (pagehide) ayrılış bildirilir", () => {
    render(<QaListenerSessionPanel appointment={appointment} session={session} onEnded={vi.fn()} />);
    window.dispatchEvent(new Event("pagehide"));
    expect(leaveQaListenerSession).toHaveBeenCalledTimes(1);
    expect(leaveQaListenerSession).toHaveBeenCalledWith("appointment-1", "s-1", { keepalive: true });
  });

  it("describeParticipant kimlikten rol üretir", () => {
    expect(describeParticipant({ identity: "patient:a1" })).toBe("Hasta");
    expect(describeParticipant({ identity: "doctor:d1" })).toBe("Doktor");
    expect(describeParticipant({ identity: "qa-listener-u1" })).toBe("Kalite kontrol dinleyicisi");
  });
});
