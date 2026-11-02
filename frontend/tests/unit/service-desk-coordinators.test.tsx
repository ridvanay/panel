import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { ApiClientError } from "@/lib/api/error";
import type { Coordinator, CoordinatorCandidate } from "@/lib/api/service-desk-admin";

/** AI İş 3 — /admin/service-desk/coordinators: aday listesinden "Koordinatör yap", görünen ad, diller, aktif/pasif ve 409/422 mesajları. */
const api = {
  listCoordinators: vi.fn(),
  listCoordinatorCandidates: vi.fn(),
  createCoordinator: vi.fn(),
  updateCoordinator: vi.fn(),
};
vi.mock("@/lib/api/service-desk-admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/service-desk-admin")>();
  return {
    ...actual,
    listCoordinators: (...a: unknown[]) => api.listCoordinators(...a),
    listCoordinatorCandidates: (...a: unknown[]) => api.listCoordinatorCandidates(...a),
    createCoordinator: (...a: unknown[]) => api.createCoordinator(...a),
    updateCoordinator: (...a: unknown[]) => api.updateCoordinator(...a),
  };
});
let authState: { status: string; user: Record<string, unknown> | null } = { status: "authenticated", user: { id: "a1", role: "ADMIN" } };
vi.mock("@/context/auth-context", () => ({ useAuth: () => authState }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/service-desk/coordinators" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AdminServiceDeskCoordinatorsPage from "@/app/admin/service-desk/coordinators/page";

const candidate: CoordinatorCandidate = { id: "u10", name: "Ayşe Yılmaz", email: "ayse@example.com", role: "EDITOR" };
const coordinator: Coordinator = { id: "c1", userId: "u20", displayName: "Cem K.", languages: ["en", "de"], isActive: true, user: { name: "Cem Kaya", email: "cem@example.com", role: "EDITOR" } };

async function renderPage() {
  const view = render(<AdminServiceDeskCoordinatorsPage />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  authState = { status: "authenticated", user: { id: "a1", role: "ADMIN" } };
  api.listCoordinators.mockResolvedValue([coordinator]);
  api.listCoordinatorCandidates.mockResolvedValue([candidate]);
});
afterEach(() => cleanup());

describe("Koordinatörler", () => {
  it("yüklenirken skeleton gösterir", async () => {
    api.listCoordinators.mockReturnValue(new Promise(() => {}));
    render(<AdminServiceDeskCoordinatorsPage />);
    await act(async () => {});
    expect(screen.getByTestId("coordinators-loading")).toBeInTheDocument();
  });

  it("hata -> mesaj + 'Yeniden dene'", async () => {
    api.listCoordinators.mockRejectedValueOnce(new ApiClientError(500, { code: "INTERNAL_ERROR", message: "Liste alınamadı" }));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Liste alınamadı");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    });
    expect(screen.getByTestId("coordinator-row-c1")).toBeInTheDocument();
  });

  it("boş durum: koordinatör yoksa yönlendirici metin", async () => {
    api.listCoordinators.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("Henüz koordinatör yok")).toBeInTheDocument();
  });

  it("aday yoksa açıklama gösterir, form göstermez", async () => {
    api.listCoordinatorCandidates.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByTestId("coordinator-no-candidates")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Kullanıcı/)).not.toBeInTheDocument();
  });

  it("aday seçince görünen ad 'Ad S.' olarak dolar; diller seçilip koordinatör yapılır", async () => {
    api.createCoordinator.mockResolvedValue({ ...coordinator, id: "c2" });
    await renderPage();
    fireEvent.change(screen.getByLabelText(/Kullanıcı/), { target: { value: "u10" } });
    expect(screen.getByLabelText("Görünen ad")).toHaveValue("Ayşe Y.");
    fireEvent.click(screen.getByLabelText("Almanca"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Koordinatör yap" }));
    });
    expect(api.createCoordinator).toHaveBeenCalledWith({ userId: "u10", displayName: "Ayşe Y.", languages: ["en", "de"] });
    expect(api.listCoordinators).toHaveBeenCalledTimes(2);
  });

  it("kullanıcı seçilmeden veya dil olmadan göndermez", async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Koordinatör yap" }));
    });
    expect(screen.getByTestId("coordinator-add-card")).toHaveTextContent("Bir kullanıcı seçin.");
    fireEvent.change(screen.getByLabelText(/Kullanıcı/), { target: { value: "u10" } });
    fireEvent.click(screen.getByLabelText("İngilizce"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Koordinatör yap" }));
    });
    expect(screen.getByTestId("coordinator-add-card")).toHaveTextContent("En az bir dil seçin.");
    expect(api.createCoordinator).not.toHaveBeenCalled();
  });

  it("422 COORDINATOR_NOT_ELIGIBLE Türkçe mesaj gösterir", async () => {
    api.createCoordinator.mockRejectedValue(new ApiClientError(422, { code: "COORDINATOR_NOT_ELIGIBLE", message: "raw" }));
    await renderPage();
    fireEvent.change(screen.getByLabelText(/Kullanıcı/), { target: { value: "u10" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Koordinatör yap" }));
    });
    expect(within(screen.getByTestId("coordinator-add-card")).getByRole("alert")).toHaveTextContent("doktor profili olan kullanıcılar koordinatör yapılamaz");
  });

  it("pasifleştirme çağrısı isActive=false gönderir", async () => {
    api.updateCoordinator.mockResolvedValue({ ...coordinator, isActive: false });
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cem K. pasifleştir" }));
    });
    expect(api.updateCoordinator).toHaveBeenCalledWith("c1", { isActive: false });
  });

  it("409 COORDINATOR_HAS_UPCOMING_CONSULTATIONS gelecek görüşme sayısıyla mesaj gösterir", async () => {
    api.updateCoordinator.mockRejectedValue(new ApiClientError(409, { code: "COORDINATOR_HAS_UPCOMING_CONSULTATIONS", message: "raw", details: { count: ["4"] } }));
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cem K. pasifleştir" }));
    });
    const row = screen.getByTestId("coordinator-row-c1");
    expect(within(row).getByRole("alert")).toHaveTextContent("4 gelecek görüşmesi var");
  });

  it("görünen ad ve diller düzenlenip kaydedilir", async () => {
    api.updateCoordinator.mockResolvedValue(coordinator);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Cem K. düzenle" }));
    const row = screen.getByTestId("coordinator-row-c1");
    fireEvent.change(within(row).getByLabelText("Görünen ad"), { target: { value: "Cem Kaya" } });
    fireEvent.click(within(row).getByLabelText("Arapça"));
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Kaydet" }));
    });
    expect(api.updateCoordinator).toHaveBeenCalledWith("c1", { displayName: "Cem Kaya", languages: ["en", "de", "ar"] });
  });

  it("axe ihlali yok", async () => {
    const { container } = await renderPage();
    expect(await axe(container, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
