import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MeetingsManager } from "@/components/meetings/meetings-manager";
import { ApiClientError } from "@/lib/api/error";
import type { Meeting } from "@/lib/api/meetings";
import { SITE_ORIGIN } from "@/lib/doctor-host";

/**
 * Paket AG İş 3 — "Toplantılar" yönetimi (§9.2 madde 5 + §12 kararları): yükleme / hata / boş durum, form doğrulaması ve
 * "misafirlere görünür" uyarısı, katılımcı sınırı 2–8 (varsayılan 4), bağlantı kartı + kopyalama + e-posta (yalnızca oluşturma
 * anında), yeni bağlantı = eskisini geçersiz kılar uyarısı, iptal onayı, pencere dışında "Katıl" pasif, ADMIN gözetimi
 * (katıl düğmesi yok), 2FA önerisi ve yetki kapısı.
 */
const api = {
  listMeetings: vi.fn(),
  listAdminMeetings: vi.fn(),
  createMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  regenerateGuestLink: vi.fn(),
  cancelMeeting: vi.fn(),
  adminCancelMeeting: vi.fn(),
  sendMeetingInviteEmail: vi.fn(),
};
vi.mock("@/lib/api/meetings", () => ({
  listMeetings: (...a: unknown[]) => api.listMeetings(...a),
  listAdminMeetings: (...a: unknown[]) => api.listAdminMeetings(...a),
  createMeeting: (...a: unknown[]) => api.createMeeting(...a),
  updateMeeting: (...a: unknown[]) => api.updateMeeting(...a),
  regenerateGuestLink: (...a: unknown[]) => api.regenerateGuestLink(...a),
  cancelMeeting: (...a: unknown[]) => api.cancelMeeting(...a),
  adminCancelMeeting: (...a: unknown[]) => api.adminCancelMeeting(...a),
  sendMeetingInviteEmail: (...a: unknown[]) => api.sendMeetingInviteEmail(...a),
}));

let mockUser: Record<string, unknown> | null = null;
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => ({ status: "authenticated", user: mockUser }) }));
vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => "tr",
  useLocalizePath: () => (path: string) => path,
}));

const HOUR = 3_600_000;
function meeting(overrides: Partial<Meeting> = {}): Meeting {
  const startsAt = new Date(Date.now() + 5 * 60_000).toISOString();
  return {
    id: "m1",
    title: "Ön görüşme",
    note: null,
    startsAt,
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
const page = (items: Meeting[], nextCursor: string | null = null) => ({ items, nextCursor });
const clipboardWrite = vi.fn();

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  mockUser = { id: "u1", role: "EDITOR", canHostMeetings: true, twoFactorEnabled: true, doctorProfileId: null };
  api.listMeetings.mockResolvedValue(page([meeting()]));
  clipboardWrite.mockReset();
  clipboardWrite.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboardWrite }, configurable: true });
});

afterEach(() => {
  cleanup();
});

async function renderManager(variant: "admin" | "doctor" = "admin") {
  render(<MeetingsManager variant={variant} />);
  await act(async () => {});
}

describe("veri durumları", () => {
  it("yüklenirken iskelet, sonra liste", async () => {
    let resolve!: (v: unknown) => void;
    api.listMeetings.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<MeetingsManager variant="admin" />);
    expect(screen.getByTestId("meetings-skeleton")).toBeInTheDocument();
    await act(async () => resolve(page([meeting()])));
    expect(screen.queryByTestId("meetings-skeleton")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("meeting-row")).toHaveLength(1);
    expect(screen.getByText("Ön görüşme")).toBeInTheDocument();
  });

  it("hata durumunda çevrilmiş mesaj + Tekrar dene; tekrar deneyince liste gelir", async () => {
    api.listMeetings.mockRejectedValueOnce(new ApiClientError(500, { code: "INTERNAL_ERROR", message: "RAW SERVER TEXT" }));
    await renderManager();
    const error = screen.getByTestId("meetings-error");
    expect(error).toHaveTextContent("Bir şeyler ters gitti");
    expect(error.textContent).not.toContain("RAW SERVER TEXT");
    await act(async () => {
      fireEvent.click(within(error).getByRole("button", { name: "Tekrar dene" }));
    });
    expect(screen.getAllByTestId("meeting-row")).toHaveLength(1);
  });

  it("boş durum: yaklaşan ve geçmiş için ayrı metin", async () => {
    api.listMeetings.mockResolvedValue(page([]));
    await renderManager();
    expect(screen.getByText("Yaklaşan toplantı yok")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Geçmiş" }));
    });
    expect(screen.getByText("Geçmiş toplantı yok")).toBeInTheDocument();
    expect(api.listMeetings).toHaveBeenLastCalledWith("past", undefined);
  });

  it("'Daha fazla yükle' sonraki sayfayı ekler", async () => {
    api.listMeetings.mockResolvedValueOnce(page([meeting({ id: "a", title: "Birinci" })], "cur1"));
    api.listMeetings.mockResolvedValueOnce(page([meeting({ id: "b", title: "İkinci" })]));
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Daha fazla yükle" }));
    });
    expect(api.listMeetings).toHaveBeenLastCalledWith("upcoming", "cur1");
    expect(screen.getAllByTestId("meeting-row")).toHaveLength(2);
  });
});

describe("Katıl düğmesi", () => {
  it("pencere içinde (başlangıca ≤ 15 dk) etkin bağlantıdır", async () => {
    await renderManager();
    const join = screen.getByTestId("meeting-join");
    expect(join).toHaveAttribute("href", "/meet/m1");
    expect(screen.queryByTestId("meeting-join-disabled")).not.toBeInTheDocument();
  });

  it("pencere dışında (başlangıca > 15 dk) pasif ve açıklamalıdır", async () => {
    api.listMeetings.mockResolvedValue(page([meeting({ startsAt: new Date(Date.now() + 3 * HOUR).toISOString(), endsAt: new Date(Date.now() + 4 * HOUR).toISOString() })]));
    await renderManager();
    const disabled = screen.getByTestId("meeting-join-disabled");
    expect(disabled).toBeDisabled();
    expect(disabled).toHaveAttribute("title", expect.stringContaining("saatinden itibaren katılabilirsiniz"));
    expect(screen.queryByTestId("meeting-join")).not.toBeInTheDocument();
  });

  it("doktor portalında oda ana sitedeki mutlak adrestir (doktor alt alan adından tam sayfa geçiş)", async () => {
    await renderManager("doctor");
    expect(screen.getByTestId("meeting-join")).toHaveAttribute("href", `${SITE_ORIGIN}/meet/m1`);
  });

  it("iptal edilmiş / bitmiş toplantıda işlem düğmesi yoktur", async () => {
    api.listMeetings.mockResolvedValue(page([meeting({ status: "CANCELLED", phase: "cancelled" })]));
    await renderManager();
    expect(screen.queryByTestId("meeting-join")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-cancel")).not.toBeInTheDocument();
    expect(screen.getByText("İptal")).toBeInTheDocument();
  });
});

describe("oluşturma formu", () => {
  async function openForm() {
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByTestId("meetings-new"));
    });
    return screen.getByTestId("meeting-form-dialog");
  }

  it("başlık altında 'Misafirlere görünür. Hasta adı yazmayın.' uyarısı; not alanı yalnızca ev sahibine görünür notu", async () => {
    const dialog = await openForm();
    expect(within(dialog).getByTestId("meeting-title-warning")).toHaveTextContent("Misafirlere görünür. Hasta adı yazmayın.");
    expect(within(dialog).getByText(/Bu notu yalnızca siz görürsünüz/)).toBeInTheDocument();
    // Uyarı başlık alanına aria-describedby ile bağlıdır.
    expect(within(dialog).getByLabelText(/Başlık/)).toHaveAttribute("aria-describedby", expect.stringContaining("meeting-title-warning"));
  });

  it("katılımcı sınırı 2–8, varsayılan 4 (ev sahibi dahil açıklamasıyla); süre seçenekleri 15–120", async () => {
    const dialog = await openForm();
    const capacity = within(dialog).getByLabelText(/Katılımcı sınırı/) as HTMLSelectElement;
    expect(capacity.value).toBe("4");
    expect([...capacity.options].map((o) => o.value)).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
    expect(within(dialog).getByText(/Siz dahil odadaki toplam kişi sayısı/)).toBeInTheDocument();
    const duration = within(dialog).getByLabelText(/Süre/) as HTMLSelectElement;
    expect([...duration.options].map((o) => o.value)).toEqual(["15", "30", "45", "60", "90", "120"]);
  });

  it("kısa başlıkta alan hatası gösterir ve API'yi çağırmaz", async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText(/Başlık/), { target: { value: "ab" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("meeting-form-submit"));
    });
    expect(within(dialog).getByText("3 ile 120 karakter arasında bir başlık girin.")).toBeInTheDocument();
    expect(api.createMeeting).not.toHaveBeenCalled();
  });

  it("geçmiş başlangıç zamanı reddedilir", async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText(/Başlık/), { target: { value: "Geçerli başlık" } });
    fireEvent.change(within(dialog).getByLabelText(/Tarih/), { target: { value: "2020-01-01" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("meeting-form-submit"));
    });
    expect(within(dialog).getByText("Başlangıç zamanı geçmişte olamaz.")).toBeInTheDocument();
    expect(api.createMeeting).not.toHaveBeenCalled();
  });

  it("geçerli form: oluşturur, ardından bağlantı kartı (bağlantı + kopyala + tek seferlik uyarı + e-posta) açılır", async () => {
    const created = meeting({ id: "new1", title: "Yeni toplantı" });
    api.createMeeting.mockResolvedValue({ meeting: created, guestLink: "https://site.test/tr/meet/join#mg_secret" });
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText(/Başlık/), { target: { value: "  Yeni toplantı  " } });
    fireEvent.change(within(dialog).getByLabelText(/Özel not/), { target: { value: "iç not" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("meeting-form-submit"));
    });
    expect(api.createMeeting).toHaveBeenCalledTimes(1);
    const payload = api.createMeeting.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({ title: "Yeni toplantı", durationMin: 30, maxParticipants: 4, autoAdmitGuests: false, note: "iç not" });
    expect(typeof payload.startsAt).toBe("string");
    expect(String(payload.startsAt)).toMatch(/Z$/);

    const card = await screen.findByTestId("meeting-link-card");
    expect(within(card).getByLabelText("Misafir bağlantısı")).toHaveValue("https://site.test/tr/meet/join#mg_secret");
    expect(within(card).getByTestId("meeting-link-once-warning")).toHaveTextContent("yalnızca şimdi tam olarak gösterilir");
    expect(within(card).getByText("E-postayla gönder (isteğe bağlı)")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(card).getByTestId("meeting-copy-link"));
    });
    expect(clipboardWrite).toHaveBeenCalledWith("https://site.test/tr/meet/join#mg_secret");
    expect(screen.getByTestId("meeting-copy-status")).toHaveTextContent("Bağlantı kopyalandı.");
  });

  it("sunucu 409 (20 toplantı sınırı) çevrilmiş mesajla gösterilir; form açık kalır", async () => {
    api.createMeeting.mockRejectedValue(new ApiClientError(409, { code: "MEETING_LIMIT_REACHED", message: "RAW" }));
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText(/Başlık/), { target: { value: "Geçerli başlık" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("meeting-form-submit"));
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Yaklaşan toplantı sınırına (20) ulaştınız.");
    expect(screen.queryByTestId("meeting-link-card")).not.toBeInTheDocument();
  });
});

describe("bağlantı kartı: e-postayla gönder (yalnızca oluşturma anında)", () => {
  async function createAndGetCard() {
    api.createMeeting.mockResolvedValue({ meeting: meeting({ id: "new1" }), guestLink: "https://site.test/tr/meet/join#mg_secret" });
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByTestId("meetings-new"));
    });
    const dialog = screen.getByTestId("meeting-form-dialog");
    fireEvent.change(within(dialog).getByLabelText(/Başlık/), { target: { value: "Yeni toplantı" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("meeting-form-submit"));
    });
    return screen.findByTestId("meeting-link-card");
  }

  it("geçersiz e-posta uyarılır, API çağrılmaz; geçerli adres bağlantıyla gönderilir", async () => {
    const card = await createAndGetCard();
    fireEvent.change(within(card).getByLabelText("Misafirin e-posta adresi"), { target: { value: "gecersiz" } });
    await act(async () => {
      fireEvent.click(within(card).getByTestId("meeting-send-invite"));
    });
    expect(within(card).getByText("Geçerli bir e-posta adresi girin.")).toBeInTheDocument();
    expect(api.sendMeetingInviteEmail).not.toHaveBeenCalled();

    api.sendMeetingInviteEmail.mockResolvedValue(undefined);
    fireEvent.change(within(card).getByLabelText("Misafirin e-posta adresi"), { target: { value: "misafir@example.com" } });
    await act(async () => {
      fireEvent.click(within(card).getByTestId("meeting-send-invite"));
    });
    expect(api.sendMeetingInviteEmail).toHaveBeenCalledWith("new1", { link: "https://site.test/tr/meet/join#mg_secret", to: "misafir@example.com" });
    expect(within(card).getByTestId("meeting-invite-sent")).toBeInTheDocument();
  });

  it("gönderim başarısız olursa bağlantıyı kendisi paylaşması söylenir", async () => {
    const card = await createAndGetCard();
    api.sendMeetingInviteEmail.mockRejectedValue(new ApiClientError(429, { code: "RATE_LIMITED", message: "RAW" }));
    fireEvent.change(within(card).getByLabelText("Misafirin e-posta adresi"), { target: { value: "misafir@example.com" } });
    await act(async () => {
      fireEvent.click(within(card).getByTestId("meeting-send-invite"));
    });
    expect(within(card).getByTestId("meeting-invite-failed")).toHaveTextContent("Bağlantıyı kopyalayıp kendiniz paylaşın");
  });

  it("liste satırında 'e-postayla gönder' YOKTUR (bağlantı yalnızca oluşturma anında bellekte)", async () => {
    await renderManager();
    const row = screen.getByTestId("meeting-row");
    expect(within(row).queryByText(/E-posta/i)).not.toBeInTheDocument();
    expect(within(row).queryByTestId("meeting-send-invite")).not.toBeInTheDocument();
  });
});

describe("yeni misafir bağlantısı", () => {
  it("onay metni 'eski bağlantıyı geçersiz kılar' uyarısını açıkça söyler; onaylanınca yeni bağlantı kartı açılır", async () => {
    api.regenerateGuestLink.mockResolvedValue({ guestLink: "https://site.test/tr/meet/join#mg_new" });
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByTestId("meeting-new-link"));
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("eski bağlantıyı geçersiz kılar");
    expect(api.regenerateGuestLink).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Yeni bağlantı üret" }));
    });
    expect(api.regenerateGuestLink).toHaveBeenCalledWith("m1");
    const card = await screen.findByTestId("meeting-link-card");
    expect(within(card).getByLabelText("Misafir bağlantısı")).toHaveValue("https://site.test/tr/meet/join#mg_new");
  });

  it("vazgeçilirse bağlantı yeniden üretilmez", async () => {
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByTestId("meeting-new-link"));
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Vazgeç" }));
    });
    expect(api.regenerateGuestLink).not.toHaveBeenCalled();
  });
});

describe("iptal", () => {
  it("onay diyaloğu sonucu açıklar; onaylanınca iptal çağrılır ve bildirim gösterilir", async () => {
    api.cancelMeeting.mockResolvedValue(meeting({ status: "CANCELLED", phase: "cancelled" }));
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByTestId("meeting-cancel"));
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("misafir bağlantısı çalışmaz ve odadaki herkes çıkarılır");
    expect(api.cancelMeeting).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Toplantıyı iptal et" }));
    });
    expect(api.cancelMeeting).toHaveBeenCalledWith("m1");
    expect(screen.getByTestId("meetings-notice")).toHaveTextContent("Toplantı iptal edildi.");
  });

  it("'Toplantı kalsın' ile vazgeçilirse iptal çağrılmaz", async () => {
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByTestId("meeting-cancel"));
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Toplantı kalsın" }));
    });
    expect(api.cancelMeeting).not.toHaveBeenCalled();
  });
});

describe("ADMIN gözetimi (S4)", () => {
  beforeEach(() => {
    mockUser = { id: "admin1", role: "ADMIN", canHostMeetings: true, twoFactorEnabled: true, doctorProfileId: null };
  });

  it("'Tüm toplantılar' görünümünde başkasının toplantısı için YALNIZCA iptal vardır; katıl / yeni bağlantı / düzenle yok", async () => {
    api.listAdminMeetings.mockResolvedValue(page([meeting({ id: "x1", title: "Başkasının toplantısı", hostName: "Dr. Elif" })]));
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tüm toplantılar" }));
    });
    expect(api.listAdminMeetings).toHaveBeenCalledWith("upcoming", undefined);
    expect(screen.getByTestId("meetings-admin-note")).toBeInTheDocument();
    const row = screen.getByTestId("meeting-row");
    expect(within(row).getByText(/Ev sahibi: Dr\. Elif/)).toBeInTheDocument();
    expect(within(row).queryByTestId("meeting-join")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("meeting-join-disabled")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("meeting-new-link")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("meeting-edit")).not.toBeInTheDocument();
    expect(within(row).getByTestId("meeting-cancel")).toBeInTheDocument();

    api.adminCancelMeeting.mockResolvedValue(meeting({ id: "x1", status: "CANCELLED", phase: "cancelled" }));
    await act(async () => {
      fireEvent.click(within(row).getByTestId("meeting-cancel"));
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Toplantıyı iptal et" }));
    });
    expect(api.adminCancelMeeting).toHaveBeenCalledWith("x1");
    expect(api.cancelMeeting).not.toHaveBeenCalled();
  });

  it("görünüm anahtarı yalnızca admin panelinde ve yalnızca ADMIN rolünde vardır", async () => {
    await renderManager("admin");
    expect(screen.getByRole("button", { name: "Toplantılarım" })).toBeInTheDocument();
    cleanup();
    await renderManager("doctor");
    expect(screen.queryByRole("button", { name: "Tüm toplantılar" })).not.toBeInTheDocument();
    cleanup();
    mockUser = { id: "u2", role: "EDITOR", canHostMeetings: true, twoFactorEnabled: true, doctorProfileId: null };
    await renderManager("admin");
    expect(screen.queryByRole("button", { name: "Tüm toplantılar" })).not.toBeInTheDocument();
  });
});

describe("2FA önerisi (S2) ve yetki kapısı", () => {
  it("2FA'sı olmayan ev sahibine zorunlu olmayan bilgilendirme gösterilir; liste yine yüklenir", async () => {
    mockUser = { id: "u1", role: "EDITOR", canHostMeetings: true, twoFactorEnabled: false, doctorProfileId: null };
    await renderManager();
    expect(screen.getByTestId("meetings-2fa-advice")).toHaveTextContent("Hesabınızı korumak için iki adımlı doğrulamayı açmanızı öneririz.");
    expect(screen.getAllByTestId("meeting-row")).toHaveLength(1);
  });

  it("2FA'sı açık kullanıcıya gösterilmez", async () => {
    await renderManager();
    expect(screen.queryByTestId("meetings-2fa-advice")).not.toBeInTheDocument();
  });

  it("yetkisiz kullanıcı (canHostMeetings yok, ADMIN değil) yalnızca açıklama görür; API çağrılmaz", async () => {
    mockUser = { id: "u3", role: "EDITOR", canHostMeetings: false, twoFactorEnabled: true, doctorProfileId: null };
    await renderManager();
    expect(screen.getByTestId("meetings-forbidden")).toBeInTheDocument();
    expect(api.listMeetings).not.toHaveBeenCalled();
  });
});

describe("düzenleme", () => {
  it("düzenle diyaloğu mevcut değerlerle açılır ve değişiklikleri PATCH eder", async () => {
    api.updateMeeting.mockResolvedValue(meeting({ title: "Yeni başlık" }));
    api.listMeetings.mockResolvedValue(
      page([meeting({ startsAt: new Date(Date.now() + 3 * HOUR).toISOString(), endsAt: new Date(Date.now() + 4 * HOUR).toISOString(), note: "özel" })])
    );
    await renderManager();
    await act(async () => {
      fireEvent.click(screen.getByTestId("meeting-edit"));
    });
    const dialog = screen.getByTestId("meeting-form-dialog");
    expect(within(dialog).getByLabelText(/Başlık/)).toHaveValue("Ön görüşme");
    expect(within(dialog).getByLabelText(/Özel not/)).toHaveValue("özel");
    fireEvent.change(within(dialog).getByLabelText(/Başlık/), { target: { value: "Yeni başlık" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("meeting-form-submit"));
    });
    await waitFor(() => expect(api.updateMeeting).toHaveBeenCalledTimes(1));
    expect(api.updateMeeting.mock.calls[0]![0]).toBe("m1");
    expect(api.updateMeeting.mock.calls[0]![1]).toMatchObject({ title: "Yeni başlık", maxParticipants: 4, note: "özel" });
  });
});
