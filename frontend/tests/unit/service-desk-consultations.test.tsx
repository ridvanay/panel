import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { ApiClientError } from "@/lib/api/error";
import type { AdminServiceConsultation } from "@/lib/api/service-desk-admin";

/** AI İş 3 — /admin/service-desk/consultations: liste (baş harfli hasta adı), süzgeçler, detay, iptal onayı + gerekçe. */
const api = { listAdminConsultations: vi.fn(), getAdminConsultation: vi.fn(), cancelAdminConsultation: vi.fn() };
vi.mock("@/lib/api/service-desk-admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/service-desk-admin")>();
  return {
    ...actual,
    listAdminConsultations: (...a: unknown[]) => api.listAdminConsultations(...a),
    getAdminConsultation: (...a: unknown[]) => api.getAdminConsultation(...a),
    cancelAdminConsultation: (...a: unknown[]) => api.cancelAdminConsultation(...a),
  };
});
let authState: { status: string; user: Record<string, unknown> | null } = { status: "authenticated", user: { id: "m1", role: "MANAGER" } };
vi.mock("@/context/auth-context", () => ({ useAuth: () => authState }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/service-desk/consultations" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AdminServiceDeskConsultationsPage from "@/app/admin/service-desk/consultations/page";

function row(overrides: Partial<AdminServiceConsultation> = {}): AdminServiceConsultation {
  return {
    id: "s1",
    consultationNumber: "SVC-00012",
    startsAt: "2026-11-12T11:00:00.000Z",
    endsAt: "2026-11-12T11:30:00.000Z",
    status: "SCHEDULED",
    serviceName: "Dental treatment",
    patientName: "Z. Y.",
    contactLanguage: "de",
    needsInterpreter: true,
    interpreterLanguage: "ar",
    coordinatorName: "Cem K.",
    ...overrides,
  };
}
const emptyPage = { items: [], page: 1, hasNext: false };

async function renderPage() {
  const view = render(<AdminServiceDeskConsultationsPage />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  authState = { status: "authenticated", user: { id: "m1", role: "MANAGER" } };
  api.listAdminConsultations.mockResolvedValue({ items: [row()], page: 1, hasNext: false });
});
afterEach(() => cleanup());

describe("Hizmet görüşmeleri listesi", () => {
  it("yüklenirken skeleton gösterir", async () => {
    api.listAdminConsultations.mockReturnValue(new Promise(() => {}));
    render(<AdminServiceDeskConsultationsPage />);
    await act(async () => {});
    expect(screen.getByTestId("consultations-loading")).toBeInTheDocument();
  });

  it("satırda numara, İstanbul saati, hizmet, baş harfli hasta, koordinatör, dil, tercüman ve durum gösterir", async () => {
    await renderPage();
    const r = screen.getByTestId("consultation-row-s1");
    expect(r).toHaveTextContent("SVC-00012");
    expect(r).toHaveTextContent("12 Kas 2026 14:00");
    expect(r).toHaveTextContent("Dental treatment");
    expect(r).toHaveTextContent("Z. Y.");
    expect(r).toHaveTextContent("Cem K.");
    expect(r).toHaveTextContent("Almanca");
    expect(r).toHaveTextContent("Arapça");
    expect(r).toHaveTextContent("Planlandı");
  });

  it("boş durum ve hata/yeniden dene", async () => {
    api.listAdminConsultations.mockResolvedValueOnce(emptyPage);
    await renderPage();
    expect(screen.getByText("Görüşme bulunamadı")).toBeInTheDocument();
    cleanup();
    api.listAdminConsultations.mockRejectedValueOnce(new ApiClientError(500, { code: "INTERNAL_ERROR", message: "Hata oluştu" }));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Hata oluştu");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    });
    expect(screen.getByTestId("consultation-row-s1")).toBeInTheDocument();
  });

  it("durum ve tarih süzgeci sunucuya iletilir, sayfa 1'e döner", async () => {
    await renderPage();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Durum"), { target: { value: "CANCELLED" } });
    });
    expect(api.listAdminConsultations).toHaveBeenLastCalledWith({ from: "", to: "", status: "CANCELLED", page: 1 });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Başlangıç tarihi"), { target: { value: "2026-11-01" } });
    });
    expect(api.listAdminConsultations).toHaveBeenLastCalledWith({ from: "2026-11-01", to: "", status: "CANCELLED", page: 1 });
  });

  it("sonraki sayfaya geçer", async () => {
    api.listAdminConsultations.mockResolvedValue({ items: [row()], page: 1, hasNext: true });
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sonraki/ }));
    });
    expect(api.listAdminConsultations).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it("detay diyaloğu detay ucunu çağırır", async () => {
    api.getAdminConsultation.mockResolvedValue(row({ patientTimeZone: "Europe/Berlin" }));
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "SVC-00012 detayı" }));
    });
    expect(api.getAdminConsultation).toHaveBeenCalledWith("s1");
    const detail = await screen.findByTestId("consultation-detail");
    expect(detail).toHaveTextContent("Hastanın saati");
    expect(detail).toHaveTextContent("12 Kas 2026 12:00");
  });

  it("iptal: onay diyaloğu + gerekçe -> cancel ucu, ardından liste yenilenir", async () => {
    api.cancelAdminConsultation.mockResolvedValue({ status: "CANCELLED" });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "SVC-00012 iptal et" }));
    expect(await screen.findByText("Görüşme iptal edilsin mi?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Gerekçe/), { target: { value: "Koordinatör hasta" } });
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Görüşmeyi iptal et" }));
    });
    expect(api.cancelAdminConsultation).toHaveBeenCalledWith("s1", "Koordinatör hasta");
    expect(api.listAdminConsultations).toHaveBeenCalledTimes(2);
  });

  it("iptal edilmiş satırda İptal düğmesi yoktur", async () => {
    api.listAdminConsultations.mockResolvedValue({ items: [row({ status: "CANCELLED" })], page: 1, hasNext: false });
    await renderPage();
    expect(screen.queryByRole("button", { name: /iptal et/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("consultation-row-s1")).toHaveTextContent("İptal edildi");
  });

  it("axe ihlali yok", async () => {
    const { container } = await renderPage();
    expect(await axe(container, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
