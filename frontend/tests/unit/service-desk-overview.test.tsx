import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ApiClientError } from "@/lib/api/error";
import type { ServiceDeskOverview } from "@/lib/api/service-desk-admin";

/**
 * AI İş 3 — /admin/service-desk: yükleme/hata/yeniden dene, genel anahtar (yalnızca ADMIN; koşul kontrolü), masa ayarları
 * (ücretli anahtarı kilitli), çalışma saatleri (çakışma uyarısı), tatil günleri (409 CLOSURE_HAS_CONSULTATIONS), rol kapısı.
 */
const api = {
  getServiceDesk: vi.fn(),
  updateServiceDesk: vi.fn(),
  setServiceDeskHours: vi.fn(),
  createClosure: vi.fn(),
  deleteClosure: vi.fn(),
};
vi.mock("@/lib/api/service-desk-admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/service-desk-admin")>();
  return {
    ...actual,
    getServiceDesk: (...a: unknown[]) => api.getServiceDesk(...a),
    updateServiceDesk: (...a: unknown[]) => api.updateServiceDesk(...a),
    setServiceDeskHours: (...a: unknown[]) => api.setServiceDeskHours(...a),
    createClosure: (...a: unknown[]) => api.createClosure(...a),
    deleteClosure: (...a: unknown[]) => api.deleteClosure(...a),
  };
});

let authState: { status: string; user: Record<string, unknown> | null } = { status: "authenticated", user: { id: "a1", role: "ADMIN" } };
vi.mock("@/context/auth-context", () => ({ useAuth: () => authState }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/service-desk", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) } }));

import AdminServiceDeskPage from "@/app/admin/service-desk/page";

function overview(overrides: Partial<ServiceDeskOverview> = {}): ServiceDeskOverview {
  return {
    desk: { timeZone: "Europe/Istanbul", durationMin: 30, minNoticeMin: 120, horizonDays: 30, paidEnabled: false },
    serviceBookingEnabled: false,
    hours: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
    closures: [{ id: "cl1", date: "2026-12-25", note: "Resmi tatil" }],
    stats: { activeCoordinators: 1, next7DaysSlots: 42 },
    ...overrides,
  };
}

async function renderPage() {
  const view = render(<AdminServiceDeskPage />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  toast.success.mockReset();
  toast.error.mockReset();
  authState = { status: "authenticated", user: { id: "a1", role: "ADMIN" } };
  api.getServiceDesk.mockResolvedValue(overview());
  api.updateServiceDesk.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe("Hizmet Masası genel sayfa", () => {
  it("yüklenirken skeleton, sonra içerik gösterir", async () => {
    let resolve!: (v: ServiceDeskOverview) => void;
    api.getServiceDesk.mockReturnValue(new Promise<ServiceDeskOverview>((r) => (resolve = r)));
    render(<AdminServiceDeskPage />);
    expect(screen.getByTestId("desk-loading")).toBeInTheDocument();
    await act(async () => resolve(overview()));
    expect(screen.queryByTestId("desk-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-booking-switch-card")).toBeInTheDocument();
    expect(screen.getByTestId("desk-stats")).toHaveTextContent("42");
  });

  it("hatada mesaj ve 'Yeniden dene' gösterir; yeniden deneyince yükler", async () => {
    api.getServiceDesk.mockRejectedValueOnce(new ApiClientError(500, { code: "INTERNAL_ERROR", message: "Sunucu hatası" }));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Sunucu hatası");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    });
    expect(api.getServiceDesk).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("desk-booking-switch-card")).toBeInTheDocument();
  });

  it("EDITOR rolü hizmet masası yönetimini göremez (rol kapısı); API çağrılmaz", async () => {
    authState = { status: "authenticated", user: { id: "e1", role: "EDITOR", isServiceCoordinator: true } };
    await renderPage();
    expect(screen.getByText("Bu sayfaya erişim yetkiniz yok")).toBeInTheDocument();
    expect(api.getServiceDesk).not.toHaveBeenCalled();
  });

  it("MANAGER sayfayı görür ama genel anahtar devre dışıdır (yalnızca ADMIN)", async () => {
    authState = { status: "authenticated", user: { id: "m1", role: "MANAGER" } };
    await renderPage();
    expect(screen.getByRole("switch", { name: "Online consultation booking" })).toHaveAttribute("data-disabled");
    expect(screen.getByText(/yalnızca yönetici \(ADMIN\) değiştirebilir/)).toBeInTheDocument();
  });

  it("ADMIN anahtarı açar: koşullar sağlanıyorsa PATCH serviceBookingEnabled=true", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("switch", { name: "Online consultation booking" }));
    expect(api.updateServiceDesk).toHaveBeenCalledWith({ serviceBookingEnabled: true });
    expect(toast.success).toHaveBeenCalled();
  });

  it("aktif koordinatör yoksa açmadan önce uyarır ve API'yi çağırmaz", async () => {
    api.getServiceDesk.mockResolvedValue(overview({ stats: { activeCoordinators: 0, next7DaysSlots: 0 } }));
    await renderPage();
    await userEvent.click(screen.getByRole("switch", { name: "Online consultation booking" }));
    expect(screen.getByTestId("desk-enable-warning")).toHaveTextContent("en az bir aktif koordinatör");
    expect(api.updateServiceDesk).not.toHaveBeenCalled();
  });

  it("çalışma saati yoksa açmadan önce uyarır", async () => {
    api.getServiceDesk.mockResolvedValue(overview({ hours: [] }));
    await renderPage();
    await userEvent.click(screen.getByRole("switch", { name: "Online consultation booking" }));
    expect(screen.getByTestId("desk-enable-warning")).toHaveTextContent("en az bir çalışma saati");
    expect(api.updateServiceDesk).not.toHaveBeenCalled();
  });

  it("açıkken anahtarı kapatır", async () => {
    api.getServiceDesk.mockResolvedValue(overview({ serviceBookingEnabled: true }));
    await renderPage();
    await userEvent.click(screen.getByRole("switch", { name: "Online consultation booking" }));
    expect(api.updateServiceDesk).toHaveBeenCalledWith({ serviceBookingEnabled: false });
  });

  it("ücretli görüşme anahtarı kilitli ve 'Yakında' etiketli; ayarlar kaydedilir (süre, saat, ufuk, dilim)", async () => {
    await renderPage();
    expect(screen.getByRole("switch", { name: "Ücretli görüşme" })).toHaveAttribute("data-disabled");
    expect(screen.getByText("Yakında")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("En erken rezervasyon"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("En fazla kaç gün ileri"), { target: { value: "45" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ayarları kaydet" }));
    });
    expect(api.updateServiceDesk).toHaveBeenCalledWith({ durationMin: 30, minNoticeMin: 240, horizonDays: 45, timeZone: "Europe/Istanbul" });
  });

  it("geçersiz ufuk ve saat dilimi sunucuya gitmeden reddedilir", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("En fazla kaç gün ileri"), { target: { value: "500" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ayarları kaydet" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Ufuk 1 ile 90 gün");
    fireEvent.change(screen.getByLabelText("En fazla kaç gün ileri"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Saat dilimi"), { target: { value: "Mars/Olympus" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ayarları kaydet" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Geçerli bir saat dilimi");
    expect(api.updateServiceDesk).not.toHaveBeenCalled();
  });
});

describe("çalışma saatleri", () => {
  it("aralık ekleyince tam liste PUT edilir", async () => {
    api.setServiceDeskHours.mockResolvedValue([
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
    ]);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Salı için çalışma aralığı ekle" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Çalışma saatlerini kaydet" }));
    });
    expect(api.setServiceDeskHours).toHaveBeenCalledWith([
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
    ]);
  });

  it("aynı gün çakışan aralıklarda uyarı gösterir ve kaydı engeller", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pazartesi için çalışma aralığı ekle" }));
    expect(screen.getByTestId("desk-hours-overlap")).toHaveTextContent("Pazartesi");
    expect(screen.getByRole("button", { name: "Çalışma saatlerini kaydet" })).toBeDisabled();
  });

  it("sunucu hatasını (çakışma doğrulaması) gösterir", async () => {
    api.setServiceDeskHours.mockRejectedValue(new ApiClientError(422, { code: "VALIDATION_ERROR", message: "Pazartesi aralıkları çakışıyor." }));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Salı için çalışma aralığı ekle" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Çalışma saatlerini kaydet" }));
    });
    expect(within(screen.getByTestId("desk-hours-card")).getByRole("alert")).toHaveTextContent("Pazartesi aralıkları çakışıyor.");
  });
});

describe("tatil günleri", () => {
  it("listeler, tarih+not ile ekler", async () => {
    api.createClosure.mockResolvedValue({ id: "cl2", date: "2026-12-31", note: "Yılbaşı" });
    await renderPage();
    expect(screen.getByText("Resmi tatil")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Tarih/), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("İç not (isteğe bağlı)"), { target: { value: "Yılbaşı" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tatil günü ekle" }));
    });
    expect(api.createClosure).toHaveBeenCalledWith({ date: "2026-12-31", note: "Yılbaşı" });
    expect(api.getServiceDesk).toHaveBeenCalledTimes(2);
  });

  it("409 CLOSURE_HAS_CONSULTATIONS sayıyla Türkçe mesaj gösterir", async () => {
    api.createClosure.mockRejectedValue(new ApiClientError(409, { code: "CLOSURE_HAS_CONSULTATIONS", message: "raw", details: { count: ["3"] } }));
    await renderPage();
    fireEvent.change(screen.getByLabelText(/Tarih/), { target: { value: "2026-12-31" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tatil günü ekle" }));
    });
    const card = screen.getByTestId("desk-closures-card");
    expect(within(card).getByRole("alert")).toHaveTextContent("Bu güne planlanmış 3 görüşme var");
    expect(card.textContent).not.toContain("raw");
  });

  it("tarih seçilmeden eklenmez", async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tatil günü ekle" }));
    });
    expect(api.createClosure).not.toHaveBeenCalled();
    expect(within(screen.getByTestId("desk-closures-card")).getByRole("alert")).toHaveTextContent("Tarih seçin");
  });

  it("silme onay diyaloğuyla yapılır", async () => {
    api.deleteClosure.mockResolvedValue(undefined);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /tatil gününü sil/ }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Sil" }));
    });
    await waitFor(() => expect(api.deleteClosure).toHaveBeenCalledWith("cl1"));
  });

  it("yaklaşan tatil yoksa boş durum gösterir", async () => {
    api.getServiceDesk.mockResolvedValue(overview({ closures: [] }));
    await renderPage();
    expect(screen.getByTestId("desk-closures-empty")).toBeInTheDocument();
  });
});

describe("erişilebilirlik", () => {
  it("axe ihlali yok", async () => {
    const { container } = await renderPage();
    expect(await axe(container, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
