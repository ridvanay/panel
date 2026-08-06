import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe } from "jest-axe";
import AdminReportsPage from "@/app/admin/reports/page";
import type { ExportJob, User } from "@/lib/api/types";

/**
 * `/admin/reports` — a11y + RBAC denetimi. `admin/reports/page.tsx` backend RBAC'ının
 * (TÜM `/admin/reports/exports/*` uçları YALNIZCA ADMIN, bkz. reports.routes.ts) istemci
 * tarafındaki yansımasını (EDITOR için "erişiminiz yok" mesajı + API'nin HİÇ çağrılmaması)
 * ve ADMIN görünümünde (tablo + "Yeni Dışa Aktarma" diyaloğu) a11y'yi doğrular.
 */
function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock("@/lib/api/reports", () => ({
  listExportJobs: vi.fn(),
  createExportJob: vi.fn(),
  getExportJob: vi.fn(),
  downloadExportJob: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const reportsApi = await import("@/lib/api/reports");

const axeOptions = { rules: { region: { enabled: false } } };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "Test Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "EDITOR",
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

const jobs: ExportJob[] = [
  {
    id: "job-1",
    type: "VIEWS",
    format: "CSV",
    status: "COMPLETED",
    filters: {},
    containsPii: false,
    errorSummary: null,
    createdById: "user-1",
    createdBy: { id: "user-1", name: "Test Kullanıcı", email: "user@example.com", avatarUrl: null },
    expiresAt: "2026-12-01T00:00:00.000Z",
    startedAt: "2026-08-01T00:00:01.000Z",
    finishedAt: "2026-08-01T00:00:02.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:02.000Z",
  },
];

describe("AdminReportsPage — ADMIN", () => {
  it("dışa aktarma tablosu yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "ADMIN" });
    vi.mocked(reportsApi.listExportJobs).mockResolvedValue({ items: jobs, meta: { nextCursor: null } });

    const { container } = renderWithQueryClient(<AdminReportsPage />);

    expect(await screen.findByText("Görüntülenme (Views)")).toBeInTheDocument();
    expect(reportsApi.listExportJobs).toHaveBeenCalled();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("\"Yeni Dışa Aktarma\" diyaloğu açıkken kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "ADMIN" });
    vi.mocked(reportsApi.listExportJobs).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    const user = userEvent.setup();
    const { container } = renderWithQueryClient(<AdminReportsPage />);

    await screen.findByText("Henüz dışa aktarma işi yok");
    await user.click(screen.getByRole("button", { name: /Yeni Dışa Aktarma/ }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Bir rapor tipi ve tarih aralığı seçin/)).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("AdminReportsPage — EDITOR (RBAC — ADMIN-only bölüm GERÇEKTEN gizlenir)", () => {
  it("\"Bu bölüme erişiminiz yok\" mesajı gösterilir, export API'leri HİÇ çağrılmaz", async () => {
    mockUser = makeUser({ role: "EDITOR" });
    vi.mocked(reportsApi.listExportJobs).mockClear();

    const { container } = renderWithQueryClient(<AdminReportsPage />);

    expect(await screen.findByText("Bu bölüme erişiminiz yok")).toBeInTheDocument();
    expect(reportsApi.listExportJobs).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Yeni Dışa Aktarma/ })).not.toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
