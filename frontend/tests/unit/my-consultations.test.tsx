import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { ApiClientError } from "@/lib/api/error";
import type { CoordinatorConsultation, CoordinatorConsultationDetail } from "@/lib/api/service-desk-admin";

/**
 * AI İş 3 — /admin/my-consultations (koordinatör paneli): erişim kapısı (EDITOR dahil, yalnızca isServiceCoordinator),
 * bugün/yaklaşan bölümleri (yükleme/hata/boş), satır alanları, "Görüşmeye katıl" penceresi, detay ve talep mesajı (2FA).
 */
const api = { listCoordinatorConsultations: vi.fn(), getCoordinatorConsultation: vi.fn(), getCoordinatorConsultationMessage: vi.fn() };
vi.mock("@/lib/api/service-desk-admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/service-desk-admin")>();
  return {
    ...actual,
    listCoordinatorConsultations: (...a: unknown[]) => api.listCoordinatorConsultations(...a),
    getCoordinatorConsultation: (...a: unknown[]) => api.getCoordinatorConsultation(...a),
    getCoordinatorConsultationMessage: (...a: unknown[]) => api.getCoordinatorConsultationMessage(...a),
  };
});
let authState: { status: string; user: Record<string, unknown> | null } = { status: "authenticated", user: { id: "e1", role: "EDITOR", isServiceCoordinator: true } };
vi.mock("@/context/auth-context", () => ({ useAuth: () => authState }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import AdminMyConsultationsPage from "@/app/admin/my-consultations/page";

const MIN = 60_000;
function item(overrides: Partial<CoordinatorConsultation> = {}): CoordinatorConsultation {
  const start = Date.now() + 5 * MIN;
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
    needsInterpreter: true,
    interpreterLanguage: "ar",
    preferredContactChannel: "whatsapp",
    hasMessage: true,
    joinOpensAt: new Date(start - 15 * MIN).toISOString(),
    canJoin: true,
    patientTimeZone: "Europe/Berlin",
    ...overrides,
  };
}
const detail = (overrides: Partial<CoordinatorConsultationDetail> = {}): CoordinatorConsultationDetail => ({ ...item(), email: "z@example.com", phone: "+49 170 1234567", ...overrides });

async function renderPage() {
  const view = render(<AdminMyConsultationsPage />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  authState = { status: "authenticated", user: { id: "e1", role: "EDITOR", isServiceCoordinator: true } };
  api.listCoordinatorConsultations.mockImplementation(async (scope: string) => (scope === "today" ? [item()] : [item({ id: "c2", consultationNumber: "SVC-00002", startsAt: new Date(Date.now() + 26 * 60 * MIN).toISOString(), endsAt: new Date(Date.now() + 26 * 60 * MIN + 30 * MIN).toISOString() })]));
  api.getCoordinatorConsultation.mockResolvedValue(detail());
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("erişim", () => {
  it("koordinatör olmayan kullanıcı (EDITOR-değil) açıklama görür; API çağrılmaz", async () => {
    authState = { status: "authenticated", user: { id: "e2", role: "EDITOR", isServiceCoordinator: false } };
    await renderPage();
    expect(screen.getByText("Bu sayfa yalnızca hizmet masası koordinatörleri içindir")).toBeInTheDocument();
    expect(api.listCoordinatorConsultations).not.toHaveBeenCalled();
  });

  it("EDITOR rolündeki koordinatör sayfayı görür ve iki kapsamı da yükler", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Bugünkü görüşmelerim" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Yaklaşan görüşmeler" })).toBeInTheDocument();
    expect(api.listCoordinatorConsultations).toHaveBeenCalledWith("today");
    expect(api.listCoordinatorConsultations).toHaveBeenCalledWith("upcoming");
  });
});

describe("liste durumları", () => {
  it("yüklenirken skeleton (bölüm başına) gösterir", async () => {
    api.listCoordinatorConsultations.mockReturnValue(new Promise(() => {}));
    render(<AdminMyConsultationsPage />);
    await act(async () => {});
    expect(within(screen.getByTestId("my-consultations-today")).getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("boş durum metinleri", async () => {
    api.listCoordinatorConsultations.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("Bugün için görüşmeniz yok")).toBeInTheDocument();
    expect(screen.getByText("Yaklaşan görüşmeniz yok")).toBeInTheDocument();
  });

  it("bir bölüm hata verirse yalnızca o bölümde hata + 'Yeniden dene' gösterir", async () => {
    api.listCoordinatorConsultations.mockImplementation(async (scope: string) => {
      if (scope === "today") throw new ApiClientError(500, { code: "INTERNAL_ERROR", message: "Bugün yüklenemedi" });
      return [];
    });
    await renderPage();
    const today = screen.getByTestId("my-consultations-today");
    expect(within(today).getByRole("alert")).toHaveTextContent("Bugün yüklenemedi");
    expect(within(screen.getByTestId("my-consultations-upcoming")).queryByRole("alert")).not.toBeInTheDocument();
    api.listCoordinatorConsultations.mockResolvedValue([item()]);
    await act(async () => {
      fireEvent.click(within(today).getByRole("button", { name: "Yeniden dene" }));
    });
    expect(within(today).getByTestId("my-consultation-c1")).toBeInTheDocument();
  });

  it("satır: saat (İstanbul + hasta dilimi), hizmet, hasta, ülke, dil, tercüman, kanal, durum", async () => {
    await renderPage();
    const r = within(screen.getByTestId("my-consultations-today")).getByTestId("my-consultation-c1");
    expect(r).toHaveTextContent("(İstanbul)");
    expect(r).toHaveTextContent("Hastanın saati:");
    expect(r).toHaveTextContent("Europe/Berlin");
    expect(r).toHaveTextContent("Hair transplant");
    expect(r).toHaveTextContent("Zeynep Yılmaz");
    expect(r).toHaveTextContent("Ülke: DE");
    expect(r).toHaveTextContent("Dil: Almanca");
    expect(r).toHaveTextContent("Tercüman: Arapça");
    expect(r).toHaveTextContent("Tercih edilen kanal: WhatsApp");
    expect(r).toHaveTextContent("Planlandı");
  });
});

describe("Yaklaşanlar listesi tekrarı", () => {
  it("bugün listesinde olan görüşme Yaklaşanlar'da tekrar gösterilmez", async () => {
    api.listCoordinatorConsultations.mockImplementation(async (scope: string) =>
      scope === "today" ? [item()] : [item(), item({ id: "c2", consultationNumber: "SVC-00002" })]
    );
    await renderPage();
    const upcoming = screen.getByTestId("my-consultations-upcoming");
    expect(within(upcoming).queryByTestId("my-consultation-c1")).not.toBeInTheDocument();
    expect(within(upcoming).getByTestId("my-consultation-c2")).toBeInTheDocument();
    expect(within(screen.getByTestId("my-consultations-today")).getByTestId("my-consultation-c1")).toBeInTheDocument();
  });
});

describe("Görüşmeye katıl penceresi", () => {
  it("pencere açıkken (başlangıca 5 dk) etkin bağlantı odaya gider", async () => {
    await renderPage();
    const link = within(screen.getByTestId("my-consultations-today")).getByRole("link", { name: /Görüşmeye katıl.*SVC-00001/ });
    expect(link).toHaveAttribute("href", "/admin/my-consultations/c1/room");
    expect(link).toHaveTextContent("Görüşmeye katıl");
  });

  it("pencere açılmadıysa pasif düğme 'X dk sonra açılır' gösterir (bağlantı yok)", async () => {
    await renderPage();
    const upcoming = screen.getByTestId("my-consultations-upcoming");
    const btn = within(upcoming).getByRole("button", { name: /SVC-00002 görüşmesi .* sonra açılır/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/sonra açılır/);
    expect(within(upcoming).queryByRole("link", { name: /katıl/ })).not.toBeInTheDocument();
  });

  it("zaman ilerleyince düğme etkinleşir (30 sn'lik saat)", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const start = Date.now() + 20 * MIN;
    api.listCoordinatorConsultations.mockImplementation(async (scope: string) =>
      scope === "today" ? [item({ startsAt: new Date(start).toISOString(), endsAt: new Date(start + 30 * MIN).toISOString() })] : []
    );
    await renderPage();
    const today = screen.getByTestId("my-consultations-today");
    expect(within(today).getByRole("button", { name: /sonra açılır/ })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(6 * MIN);
    });
    expect(within(today).getByRole("link", { name: /Görüşmeye katıl.*SVC-00001/ })).toBeInTheDocument();
  });

  it("iptal edilmiş ve bitmiş görüşmede katıl düğmesi yoktur", async () => {
    const past = Date.now() - 2 * 60 * MIN;
    api.listCoordinatorConsultations.mockImplementation(async (scope: string) =>
      scope === "today"
        ? [item({ status: "CANCELLED" }), item({ id: "c3", consultationNumber: "SVC-00003", startsAt: new Date(past).toISOString(), endsAt: new Date(past + 30 * MIN).toISOString() })]
        : []
    );
    await renderPage();
    const today = screen.getByTestId("my-consultations-today");
    expect(within(today).queryByRole("link", { name: /katıl/ })).not.toBeInTheDocument();
    expect(within(today).queryByRole("button", { name: /sonra açılır/ })).not.toBeInTheDocument();
  });
});

describe("detay ve talep mesajı", () => {
  async function openDetail() {
    await renderPage();
    await act(async () => {
      fireEvent.click(within(screen.getByTestId("my-consultations-today")).getByRole("button", { name: "SVC-00001 detayı" }));
    });
    return screen.findByTestId("my-consultation-detail");
  }

  it("detay iletişim bilgilerini (e-posta, telefon) gösterir; mesaj otomatik YÜKLENMEZ", async () => {
    const d = await openDetail();
    expect(api.getCoordinatorConsultation).toHaveBeenCalledWith("c1");
    expect(d).toHaveTextContent("z@example.com");
    expect(d).toHaveTextContent("+49 170 1234567");
    expect(api.getCoordinatorConsultationMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId("my-consultation-message-box")).toHaveTextContent("Bu görüntüleme kayıt altına alınır");
  });

  it("2FA kapalıysa 403 TWO_FACTOR_REQUIRED -> uyarı + hesap güvenliği bağlantısı; mesaj gösterilmez", async () => {
    api.getCoordinatorConsultationMessage.mockRejectedValue(new ApiClientError(403, { code: "TWO_FACTOR_REQUIRED", message: "raw" }));
    await openDetail();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Talep mesajını göster" }));
    });
    const warn = screen.getByTestId("my-consultation-2fa-required");
    expect(warn).toHaveTextContent("Mesajı görmek için iki adımlı doğrulamayı açın");
    expect(within(warn).getByRole("link")).toHaveAttribute("href", "/admin/settings/security");
    expect(screen.queryByTestId("my-consultation-message")).not.toBeInTheDocument();
  });

  it("2FA açıkken mesaj ve 'Bu görüntüleme kayıt altına alınır' notu görünür", async () => {
    api.getCoordinatorConsultationMessage.mockResolvedValue({ message: "Saç ekimi hakkında bilgi almak istiyorum." });
    await openDetail();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Talep mesajını göster" }));
    });
    expect(api.getCoordinatorConsultationMessage).toHaveBeenCalledWith("c1");
    const box = screen.getByTestId("my-consultation-message");
    expect(box).toHaveTextContent("Saç ekimi hakkında bilgi almak istiyorum.");
    expect(box).toHaveTextContent("Bu görüntüleme kayıt altına alınır.");
  });

  it("mesaj boşsa 'Hasta mesaj bırakmadı' yazar; diğer hatalarda yeniden dene sunar", async () => {
    api.getCoordinatorConsultationMessage.mockResolvedValueOnce({ message: null });
    await openDetail();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Talep mesajını göster" }));
    });
    expect(screen.getByTestId("my-consultation-message")).toHaveTextContent("Hasta mesaj bırakmadı.");
    cleanup();
    api.getCoordinatorConsultationMessage.mockRejectedValueOnce(new ApiClientError(500, { code: "INTERNAL_ERROR", message: "Mesaj alınamadı" }));
    await openDetail();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Talep mesajını göster" }));
    });
    expect(screen.getByTestId("my-consultation-message-box")).toHaveTextContent("Mesaj alınamadı");
    expect(screen.getByRole("button", { name: "Yeniden dene" })).toBeInTheDocument();
  });

  it("mesajı olmayan görüşmede mesaj düğmesi yoktur", async () => {
    api.listCoordinatorConsultations.mockImplementation(async (scope: string) => (scope === "today" ? [item({ hasMessage: false })] : []));
    api.getCoordinatorConsultation.mockResolvedValue(detail({ hasMessage: false }));
    await openDetail();
    expect(screen.queryByRole("button", { name: "Talep mesajını göster" })).not.toBeInTheDocument();
  });
});

describe("erişilebilirlik", () => {
  it("axe ihlali yok", async () => {
    const { container } = await renderPage();
    expect(await axe(container, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
