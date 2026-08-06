import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe } from "jest-axe";
import AdminStatsPage from "@/app/admin/stats/page";
import type { RevenueStats, SummaryStats, User, UsersStats } from "@/lib/api/types";

/**
 * `/admin/stats` — a11y + RBAC (ADMIN-only bölümlerin GERÇEKTEN mount edilmemesi) denetimi.
 * `a11y-admin-dashboard.test.tsx` (bkz. `admin/page.tsx`, KÖK dashboard) ile AYNI mock/render
 * deseni; bu dosya AYRI bir sayfa olan `admin/stats/page.tsx`'i (tarih aralığı filtresi +
 * ADMIN-only KPI/Kullanıcılar/Gelir bölümleri) kapsar.
 */
function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/stats",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/blog", () => ({ listPosts: vi.fn() }));
vi.mock("@/lib/api/stats", () => ({
  getViewStats: vi.fn(),
  getLiveVisitors: vi.fn(),
  getBreakdown: vi.fn(),
  getSummary: vi.fn(),
  getTopContent: vi.fn(),
  getUsersStats: vi.fn(),
  getRevenueStats: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const pagesApi = await import("@/lib/api/pages");
const blogApi = await import("@/lib/api/blog");
const statsApi = await import("@/lib/api/stats");

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

const viewStats = [
  { date: "2026-08-01", pageViews: 10, postViews: 5 },
  { date: "2026-08-02", pageViews: 12, postViews: 6 },
];
const breakdown = {
  devices: [{ type: "DESKTOP" as const, count: 8 }, { type: "MOBILE" as const, count: 2 }],
  countries: [{ country: "TR", count: 7 }, { country: "UNKNOWN", count: 3 }],
};
const topContent = {
  items: [{ contentType: "page" as const, id: "p1", title: "Test Sayfa", slug: "test-sayfa", views: 12 }],
  meta: { nextCursor: null },
};

const summary: SummaryStats = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-06T23:59:59.999Z",
  granularity: "day",
  pageViews: 22,
  postViews: 11,
  newUsers: 2,
  activeSubscriptions: 1,
  mrrCents: 1999,
  compare: null,
};
const usersStats: UsersStats = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-06T23:59:59.999Z",
  granularity: "day",
  series: [{ date: "2026-08-01", count: 2 }],
  roleDistribution: [{ role: "ADMIN", count: 1 }, { role: "EDITOR", count: 1 }],
};
const revenueStats: RevenueStats = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-06T23:59:59.999Z",
  granularity: "day",
  activeSubscriptions: 1,
  mrrCents: 1999,
  series: [{ date: "2026-08-01", newMrrCents: 1999, churnedCount: 0 }],
};

function mockContentAnalytics() {
  vi.mocked(pagesApi.listPages).mockResolvedValue({ items: [], meta: { nextCursor: null } });
  vi.mocked(blogApi.listPosts).mockResolvedValue({ items: [], meta: { nextCursor: null } });
  vi.mocked(statsApi.getViewStats).mockResolvedValue(viewStats);
  vi.mocked(statsApi.getBreakdown).mockResolvedValue(breakdown);
  vi.mocked(statsApi.getTopContent).mockResolvedValue(topContent);
}

describe("AdminStatsPage — ADMIN", () => {
  it("KPI kartları/Kullanıcılar/Gelir sekmeleri yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "ADMIN" });
    mockContentAnalytics();
    vi.mocked(statsApi.getSummary).mockResolvedValue(summary);
    vi.mocked(statsApi.getUsersStats).mockResolvedValue(usersStats);
    vi.mocked(statsApi.getRevenueStats).mockResolvedValue(revenueStats);

    const { container } = renderWithQueryClient(<AdminStatsPage />);

    expect(await screen.findByText("İstatistikler")).toBeInTheDocument();
    // ADMIN-only KPI kartı ve sekmeler GERÇEKTEN render edilir.
    expect(await screen.findByText("Aktif abonelik")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Kullanıcılar" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Gelir" })).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("AdminStatsPage — EDITOR (ADMIN-only bölümler GERÇEKTEN mount edilmez)", () => {
  it("KPI kartları/Kullanıcılar/Gelir sekmeleri render edilmez ve ilgili API'ler HİÇ çağrılmaz", async () => {
    mockUser = makeUser({ role: "EDITOR" });
    mockContentAnalytics();
    vi.mocked(statsApi.getSummary).mockClear();
    vi.mocked(statsApi.getUsersStats).mockClear();
    vi.mocked(statsApi.getRevenueStats).mockClear();

    const { container } = renderWithQueryClient(<AdminStatsPage />);

    expect(await screen.findByText("İstatistikler")).toBeInTheDocument();
    // İçerik analitiği (EDITOR+ADMIN) her zaman görünür.
    expect(await screen.findByText("En çok görüntülenen içerik")).toBeInTheDocument();

    // ADMIN-only KPI kartı/sekmeler HİÇ render edilmez (403 gürültüsü/gereksiz istek yok).
    expect(screen.queryByText("Aktif abonelik")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Kullanıcılar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Gelir" })).not.toBeInTheDocument();
    expect(statsApi.getSummary).not.toHaveBeenCalled();
    expect(statsApi.getUsersStats).not.toHaveBeenCalled();
    expect(statsApi.getRevenueStats).not.toHaveBeenCalled();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
