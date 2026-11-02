import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MeetingHostToggle, isMeetingHostEligible } from "@/components/admin/users/meeting-host-toggle";
import { ApiClientError } from "@/lib/api/error";
import type { AdminUser } from "@/lib/api/types";

/**
 * Paket AG İş 3 — Admin → Kullanıcılar: "Harici toplantı oluşturabilir" anahtarı. ADMIN satırında kilitli ve açık; uygun
 * olmayan kullanıcıda gizli; verme/geri alma onay diyaloğuyla (geri alma: gelecekteki toplantılar iptal uyarısı).
 */
const setMeetingHostAccess = vi.fn();
vi.mock("@/lib/api/meetings", () => ({ setMeetingHostAccess: (...a: unknown[]) => setMeetingHostAccess(...a) }));
vi.mock("@/context/locale-alternates-context", () => ({ useActiveLocaleCode: () => "tr", useLocalizePath: () => (p: string) => p }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) } }));

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "u1",
    email: "editor@example.com",
    name: "Ece Editör",
    avatarUrl: null,
    emailVerifiedAt: null,
    role: "EDITOR",
    canUseAdvancedBuilder: false,
    canHostMeetings: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE",
    lastLoginAt: null,
    deletedAt: null,
    doctorProfileId: null,
    ...overrides,
  };
}

beforeEach(() => {
  setMeetingHostAccess.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => cleanup());

describe("isMeetingHostEligible", () => {
  it("panel rolleri ve doktor profiline bağlı kullanıcılar uygundur; CUSTOMER/USER/INTERPRETER ve silinmiş değildir", () => {
    expect(isMeetingHostEligible(user({ role: "ADMIN" }))).toBe(true);
    expect(isMeetingHostEligible(user({ role: "MANAGER" }))).toBe(true);
    expect(isMeetingHostEligible(user({ role: "EDITOR" }))).toBe(true);
    expect(isMeetingHostEligible(user({ role: "USER", doctorProfileId: "d1" }))).toBe(true);
    expect(isMeetingHostEligible(user({ role: "USER" }))).toBe(false);
    expect(isMeetingHostEligible(user({ role: "CUSTOMER" }))).toBe(false);
    expect(isMeetingHostEligible(user({ role: "INTERPRETER" }))).toBe(false);
    expect(isMeetingHostEligible(user({ role: "EDITOR", status: "DELETED" }))).toBe(false);
  });
});

describe("MeetingHostToggle", () => {
  it("uygun olmayan kullanıcıda hiç render edilmez", () => {
    const { container } = render(<MeetingHostToggle user={user({ role: "CUSTOMER" })} onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ADMIN satırında kilitli ve açıktır; 'Yöneticiler her zaman yetkilidir' notu görünür", () => {
    render(<MeetingHostToggle user={user({ role: "ADMIN", canHostMeetings: true })} onChanged={vi.fn()} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Yöneticiler her zaman yetkilidir")).toBeInTheDocument();
  });

  it("anahtarın erişilebilir adı etiket + kullanıcı adını içerir; durum canHostMeetings'ten gelir", () => {
    render(<MeetingHostToggle user={user({ canHostMeetings: true })} onChanged={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: /Harici toplantı oluşturabilir.*Ece Editör/ });
    expect(toggle).toBeChecked();
  });

  it("verme: onay diyaloğu, onayla → API(enabled:true), toast, liste tazelenir", async () => {
    setMeetingHostAccess.mockResolvedValue({ canHostMeetings: true });
    const onChanged = vi.fn();
    render(<MeetingHostToggle user={user()} onChanged={onChanged} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Harici toplantı yetkisi verilsin mi?");
    expect(setMeetingHostAccess).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Yetki ver" }));
    });
    expect(setMeetingHostAccess).toHaveBeenCalledWith("u1", true);
    expect(toast.success).toHaveBeenCalledWith("Toplantı yetkisi verildi.");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("geri alma: gelecekteki toplantıların iptal edileceği uyarılır; onaylanınca enabled:false", async () => {
    setMeetingHostAccess.mockResolvedValue({ canHostMeetings: false });
    const onChanged = vi.fn();
    render(<MeetingHostToggle user={user({ canHostMeetings: true })} onChanged={onChanged} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Gelecekteki toplantıları iptal edilecek");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Yetkiyi kaldır" }));
    });
    expect(setMeetingHostAccess).toHaveBeenCalledWith("u1", false);
    expect(toast.success).toHaveBeenCalledWith("Toplantı yetkisi kaldırıldı.");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("vazgeçilirse API çağrılmaz", async () => {
    render(<MeetingHostToggle user={user()} onChanged={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Vazgeç" }));
    });
    expect(setMeetingHostAccess).not.toHaveBeenCalled();
  });

  it("422 uygun değil → çevrilmiş hata toast'ı; liste tazelenmez", async () => {
    setMeetingHostAccess.mockRejectedValue(new ApiClientError(422, { code: "MEETING_HOST_NOT_ELIGIBLE", message: "RAW" }));
    const onChanged = vi.fn();
    render(<MeetingHostToggle user={user()} onChanged={onChanged} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Yetki ver" }));
    });
    expect(toast.error).toHaveBeenCalledWith("Bu hesap türüne toplantı yetkisi verilemez.");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
