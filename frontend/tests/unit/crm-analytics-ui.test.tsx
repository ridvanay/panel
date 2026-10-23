import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CrmOverview, CrmVisitorDetail } from "@/lib/api/crm";

/**
 * Paket N3 — analitik ekranları (admin): genel bakış, şu an sitede (20 sn yenileme), ziyaretçiler (Ref
 * araması), ziyaretçi detayı ("Talebe dönüştür"), sayfa ağacı, ısı haritası (script'siz sandbox iframe).
 * Sahte olayla gelen zararlı metin panelde KAÇIŞLANMIŞ metin olarak görünür.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/admin/crm" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactNode }) => <div style={{ width: 600, height: 300 }}>{children}</div> };
});
vi.mock("@/lib/api/crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/crm")>();
  return {
    ...actual,
    getCrmSettings: vi.fn(),
    getCrmOverview: vi.fn(),
    getCrmLive: vi.fn(),
    listCrmVisitors: vi.fn(),
    getCrmVisitor: vi.fn(),
    createCrmLead: vi.fn(),
    getCrmHeatmapPages: vi.fn(),
    getCrmHeatmap: vi.fn(),
  };
});

import * as crmApi from "@/lib/api/crm";
import CrmOverviewPage from "@/app/admin/crm/page";
import CrmLivePage from "@/app/admin/crm/live/page";
import CrmVisitorsPage from "@/app/admin/crm/visitors/page";
import CrmVisitorDetailPage from "@/app/admin/crm/visitors/[id]/page";
import CrmHeatmapPage from "@/app/admin/crm/heatmap/page";
import { buildPageTree, flattenPageTree } from "@/lib/crm/page-tree";
import { isSafePreviewPath } from "@/lib/crm/safe-path";

const XSS = `<img src=x onerror="alert(1)">`;

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>{node}</Suspense>
    </QueryClientProvider>
  );
}

const overview: CrmOverview = {
  kpis: { liveNow: 3, visitors: 120, pageviews: 480, whatsappClicks: 9, phoneClicks: 4, emailClicks: 1, leads: 6, conversionRate: 5 },
  series: [{ date: "2026-10-23", visitors: 120, pageviews: 480, contacts: 14 }],
  sources: [{ source: "google", medium: "organic", campaign: null, sessions: 80, visitors: 70, contacts: 10, bookingsStarted: 3 }],
  contactPages: [{ path: "/de/doctors/a", pageviews: 50, visitors: 40, entries: 10, contacts: 8, clicks: 20, avgEngagedSeconds: 60, avgScrollPct: 70 }],
  entryPages: [],
  prePages: [{ path: "/de", sessions: 5, visitors: 5 }],
  topClicks: [{ path: "/de", selector: "main>button", text: XSS, target: null, clicks: 12, contacts: 0, visitors: 10 }],
  recentLeads: [],
  hotVisitors: [],
  hotThreshold: 50,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crmApi.getCrmSettings).mockResolvedValue({ trackingEnabled: false } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("genel bakış", () => {
  it("KPI'lar, takip kapalı uyarısı, kaçışlanmış öğe metni", async () => {
    vi.mocked(crmApi.getCrmOverview).mockResolvedValue(overview);
    const { container } = wrap(<CrmOverviewPage />);
    expect(await screen.findByText("480")).toBeInTheDocument();
    expect(screen.getByText("Şu an sitede")).toBeInTheDocument();
    expect(screen.getByText("%5")).toBeInTheDocument();
    expect(await screen.findByText(/Ziyaretçi takibi kapalı/)).toBeInTheDocument();
    expect(screen.getByText(XSS)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "30 gün" }));
    await waitFor(() => expect(crmApi.getCrmOverview).toHaveBeenLastCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String) })));
  });
});

describe("şu an sitede", () => {
  it("20 saniyede bir yenilenir", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(crmApi.getCrmLive).mockResolvedValue([
      {
        visitorId: "vvvvvvvvvvvvvvvvvvvvvv",
        currentPath: "/ar/doctors/x",
        landingPath: "/ar",
        country: "SA",
        city: "Riyadh",
        deviceType: "MOBILE",
        browser: "Safari",
        os: "iOS",
        source: "google",
        medium: "cpc",
        campaign: "obezite",
        pageCount: 3,
        durationSeconds: 120,
        startedAt: "2026-10-23T08:00:00.000Z",
        lastSeenAt: "2026-10-23T08:02:00.000Z",
        score: 40,
        returning: true,
        refCode: null,
      },
    ]);
    wrap(<CrmLivePage />);
    expect(await screen.findByText("/ar/doctors/x")).toBeInTheDocument();
    expect(screen.getByText("Şu an sitede: 1")).toBeInTheDocument();
    expect(crmApi.getCrmLive).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_500);
    });
    await waitFor(() => expect(crmApi.getCrmLive).toHaveBeenCalledTimes(2));
  });
});

describe("ziyaretçiler", () => {
  it("Ref koduyla arar; sıcak filtresi", async () => {
    vi.mocked(crmApi.listCrmVisitors).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hotThreshold: 50 } });
    wrap(<CrmVisitorsPage />);
    fireEvent.change(await screen.findByLabelText("Ref kodu ya da ziyaretçi kimliği"), { target: { value: "Ref: AB12CD" } });
    fireEvent.click(screen.getByRole("button", { name: "Ara" }));
    await waitFor(() => expect(crmApi.listCrmVisitors).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Ref: AB12CD", page: 1 })));
    fireEvent.click(screen.getByRole("checkbox", { name: /Yalnızca sıcak/ }));
    await waitFor(() => expect(crmApi.listCrmVisitors).toHaveBeenLastCalledWith(expect.objectContaining({ hot: "true" })));
  });

  it("detay: zaman çizelgesi (kaçışlanmış) ve 'Talebe dönüştür' ziyaretçiyi elle bağlar", async () => {
    const detail: CrmVisitorDetail = {
      id: "vvvvvvvvvvvvvvvvvvvvvv",
      firstSeenAt: "2026-10-20T08:00:00.000Z",
      lastSeenAt: "2026-10-23T08:00:00.000Z",
      country: "DE",
      language: "de",
      deviceType: "DESKTOP",
      sessionCount: 2,
      pageviewCount: 6,
      engagedSeconds: 600,
      contactClicks: 1,
      reachedBooking: true,
      score: 77,
      refCode: "AB12CD",
      firstSource: "google",
      firstMedium: "organic",
      firstCampaign: null,
      timezone: "Europe/Berlin",
      firstReferrerHost: "www.google.de",
      firstLandingPath: "/de",
      sessions: [],
      events: [{ id: "1", sessionId: "s", type: "CLICK", occurredAt: "2026-10-23T08:00:00.000Z", path: "/de", title: null, text: XSS, target: null, name: null, scrollPct: null, step: null, isRage: true, isDead: false }],
      leads: [],
    };
    vi.mocked(crmApi.getCrmVisitor).mockResolvedValue(detail);
    vi.mocked(crmApi.createCrmLead).mockResolvedValue({ id: "lead-1" } as never);
    let view!: ReturnType<typeof wrap>;
    await act(async () => {
      view = wrap(<CrmVisitorDetailPage params={Promise.resolve({ id: detail.id })} />);
    });
    expect(await screen.findByText((content) => content.includes(`“${XSS}”`))).toBeInTheDocument();
    expect(view.container.querySelector("img")).toBeNull();
    expect(screen.getByText(/öfkeli tıklama/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Talebe dönüştür/ }));
    fireEvent.change(await screen.findByLabelText("Ad soyad"), { target: { value: "Klaus" } });
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(crmApi.createCrmLead).toHaveBeenCalledWith(expect.objectContaining({ name: "Klaus", visitorId: detail.id })));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/crm/leads/lead-1"));
  });
});

describe("sayfa ağacı", () => {
  it("yolları segment ağacına toplar", () => {
    const row = (path: string, pageviews: number) => ({ path, pageviews, visitors: pageviews, entries: 1, contacts: 0, clicks: 0, avgEngagedSeconds: 30, avgScrollPct: 50 });
    const tree = buildPageTree([row("/en", 10), row("/en/doctors/a", 5), row("/en/doctors/b", 7), row("/tr", 3)]);
    expect(tree.total.pageviews).toBe(25);
    expect(tree.children.map((c) => c.segment)).toEqual(["en", "tr"]);
    const en = tree.children[0]!;
    expect(en.total.pageviews).toBe(22);
    expect(en.own?.pageviews).toBe(10);
    const doctors = en.children[0]!;
    expect(doctors.own).toBeNull();
    expect(doctors.children.map((c) => c.segment)).toEqual(["b", "a"]);
  });

  it("öneksiz ana sayfa (/) ilk satırda; kapalı düğümün çocukları görünmez", () => {
    const row = (path: string, pageviews: number) => ({ path, pageviews, visitors: pageviews, entries: 1, contacts: 0, clicks: 0, avgEngagedSeconds: 30, avgScrollPct: 50 });
    const tree = buildPageTree([row("/", 40), row("/doctors/a", 5), row("/en", 10)]);
    const rows = flattenPageTree(tree, (_path, depth) => depth < 1);
    expect(rows.map((r) => r.node.path)).toEqual(["/", "/en", "/doctors", "/doctors/a"]);
    expect(rows[0]!.node.total.pageviews).toBe(40);
    expect(flattenPageTree(tree, () => false).map((r) => r.node.path)).toEqual(["/", "/en", "/doctors"]);
  });

  it("ısı haritası önizleme yolu yalnızca site-içi pathname", () => {
    expect(isSafePreviewPath("/de/doctors/a")).toBe(true);
    for (const p of ["//evil.com", "/\\evil.com", "javascript:alert(1)", "https://evil.com", "/a b"]) expect(isSafePreviewPath(p), p).toBe(false);
  });
});

describe("ısı haritası", () => {
  it("sayfa script'siz sandbox iframe'de açılır; istatistikler ve tıklanabilir sanılan yerler", async () => {
    vi.mocked(crmApi.getCrmHeatmapPages).mockResolvedValue([{ path: "/de/doctors/a", pageviews: 20, clicks: 9 }]);
    vi.mocked(crmApi.getCrmHeatmap).mockResolvedValue({
      pageviews: 20,
      clickCount: 9,
      rageClicks: 2,
      deadClicks: 4,
      medianDocHeight: 3000,
      points: [{ x: 10, y: 10, ex: null, ey: null, sel: null, rage: false, dead: true }],
      scrollReach: Array.from({ length: 10 }, (_, i) => ({ depth: (i + 1) * 10, pct: 100 - i * 10 })),
      scrollSamples: 20,
      likelyClickable: [{ selector: "main>img", count: 3, text: null }],
      rageTargets: [{ selector: "button.x", count: 2, text: XSS }],
    });
    const { container } = wrap(<CrmHeatmapPage />);
    const iframe = (await screen.findByTitle("Isı haritası önizlemesi: /de/doctors/a")) as HTMLIFrameElement;
    expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(iframe.getAttribute("src")).toBe("/de/doctors/a");
    expect(screen.getByText("main>img")).toBeInTheDocument();
    expect(screen.getByText(XSS)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mobil" }));
    await waitFor(() => expect(crmApi.getCrmHeatmap).toHaveBeenLastCalledWith(expect.objectContaining({ device: "mobile", path: "/de/doctors/a" })));
  });
});
