import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe } from "jest-axe";
import AdminDashboardPage from "@/app/admin/page";

// `admin/page.tsx` altındaki grafik/rozet bileşenleri artık TanStack Query hook'ları kullanıyor
// (bkz. hooks/use-stats.ts) — `providers.tsx`'teki `QueryClientProvider` bu izole render'da
// YOK, bu yüzden testin kendisi sağlıyor (`retry: false` — başarısız mock'larda testi yavaşlatmaz).
function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/blog", () => ({ listPosts: vi.fn() }));
vi.mock("@/lib/api/stats", () => ({
  getViewStats: vi.fn(),
  getLiveVisitors: vi.fn(),
  getBreakdown: vi.fn(),
}));

const pagesApi = await import("@/lib/api/pages");
const blogApi = await import("@/lib/api/blog");
const statsApi = await import("@/lib/api/stats");

// Bu sayfa <main>/<h1> gibi üst-seviye landmark'ları admin/layout.tsx'ten alır; burada
// sadece sayfa gövdesi izole render edildiği için `region` kuralı bilerek kapatılıyor
// (bkz. tests/unit/a11y-content-list-table.test.tsx aynı gerekçe).
const axeOptions = { rules: { region: { enabled: false } } };

describe("AdminDashboardPage — a11y", () => {
  beforeEach(() => {
    vi.mocked(pagesApi.listPages).mockResolvedValue({ items: [], meta: { nextCursor: null } });
    vi.mocked(blogApi.listPosts).mockResolvedValue({ items: [], meta: { nextCursor: null } });
    vi.mocked(statsApi.getViewStats).mockResolvedValue([
      { date: "2026-08-01", pageViews: 10, postViews: 5 },
      { date: "2026-08-02", pageViews: 12, postViews: 6 },
    ]);
    vi.mocked(statsApi.getLiveVisitors).mockResolvedValue({ count: 3 });
    vi.mocked(statsApi.getBreakdown).mockResolvedValue({
      devices: [{ type: "DESKTOP", count: 8 }, { type: "MOBILE", count: 2 }],
      countries: [{ country: "TR", count: 7 }, { country: "UNKNOWN", count: 3 }],
    });
  });

  it("özet kartlar ve grafikler yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = renderWithQueryClient(<AdminDashboardPage />);

    expect(await screen.findByText("Toplam sayfa")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
