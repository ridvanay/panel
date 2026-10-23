import { Suspense, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CrmLead, CrmLeadDetail } from "@/lib/api/crm";

/**
 * Paket N2 — talep listesi/detayı, huni ve UTM oluşturucu (admin). Ziyaretçiden gelen metin (isim, not,
 * kaynak) panelde KAÇIŞLANMIŞ metin olarak görünür; randevu bağlama yalnızca admin "Bağla" ile olur.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/admin/crm/leads" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/crm")>();
  return {
    ...actual,
    listCrmLeads: vi.fn(),
    listTodayCrmLeads: vi.fn(),
    listCrmAssignees: vi.fn(),
    getCrmLead: vi.fn(),
    getCrmLeadVisitorCandidates: vi.fn(),
    updateCrmLead: vi.fn(),
    addCrmLeadNote: vi.fn(),
    bulkUpdateCrmLeadStatus: vi.fn(),
    deleteCrmLead: vi.fn(),
    syncCrmLeads: vi.fn(),
    downloadCrmFile: vi.fn(),
    getCrmFunnel: vi.fn(),
  };
});

import * as crmApi from "@/lib/api/crm";
import CrmLeadsPage from "@/app/admin/crm/leads/page";
import CrmLeadDetailPage from "@/app/admin/crm/leads/[id]/page";
import CrmFunnelPage from "@/app/admin/crm/funnel/page";
import CrmUtmBuilderPage from "@/app/admin/crm/utm/page";
import { buildUtmUrl, normalizeUtm } from "@/lib/crm/utm";

const XSS = `<img src=x onerror="alert(1)">`;

function lead(overrides: Partial<CrmLead> = {}): CrmLead {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    seq: 7,
    channel: "WHATSAPP",
    status: "NEW",
    candidate: false,
    name: XSS,
    phone: "+905551112233",
    email: "a@example.com",
    country: "DE",
    language: "de",
    specialtyId: null,
    specialtyName: null,
    doctorId: null,
    doctorName: null,
    source: `google${XSS}`,
    medium: "cpc",
    campaign: "diz",
    landingPath: "/de/doctors/x",
    refCode: "ABC234",
    gclid: null,
    assignedToId: null,
    assignedToName: null,
    firstResponseAt: null,
    nextActionAt: null,
    statusChangedAt: "2026-10-23T08:00:00.000Z",
    bookingId: null,
    visitorId: null,
    anonymizedAt: null,
    createdAt: "2026-10-23T08:00:00.000Z",
    sla: { state: "breached", minutes: 90 },
    ...overrides,
  };
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>{node}</Suspense>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crmApi.listTodayCrmLeads).mockResolvedValue([]);
  vi.mocked(crmApi.listCrmAssignees).mockResolvedValue([{ id: "u1", name: "Admin Bir" }]);
});

describe("talep listesi", () => {
  it("durum sayıları, SLA, kaçışlanmış ad/kaynak; toplu durum", async () => {
    vi.mocked(crmApi.listCrmLeads).mockResolvedValue({
      items: [lead(), lead({ id: "22222222-2222-4222-8222-222222222222", seq: 8, name: "Ayşe", status: "CALLED", sla: { state: "met", minutes: 20 } })],
      meta: { total: 2, page: 1, pageSize: 25, statusCounts: { NEW: 1, CALLED: 1, UNREACHABLE: 0, APPOINTMENT_GIVEN: 0, CONSULTED: 0, TREATMENT_PLANNED: 0, TREATED: 0, NEGATIVE: 0, SPAM: 0 } },
    });
    vi.mocked(crmApi.bulkUpdateCrmLeadStatus).mockResolvedValue({ updated: 2 });
    const { container } = wrap(<CrmLeadsPage />);

    expect(await screen.findByText(XSS)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Yeni (1)" })).toBeInTheDocument();
    expect(screen.getByText("1 sa 30 dk gecikti")).toBeInTheDocument();
    expect(screen.getByText("Yanıtlandı · 20 dk")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Sayfadakilerin hepsini seç" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Toplu durum" }), { target: { value: "SPAM" } });
    fireEvent.click(screen.getByRole("button", { name: "Durumu uygula" }));
    await waitFor(() =>
      expect(crmApi.bulkUpdateCrmLeadStatus).toHaveBeenCalledWith(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"], "SPAM")
    );

    fireEvent.click(screen.getByRole("button", { name: "Arandı (1)" }));
    await waitFor(() => expect(crmApi.listCrmLeads).toHaveBeenLastCalledWith(expect.objectContaining({ status: "CALLED", page: 1 })));
  });

  it("CSV indirme filtrelerle çağrılır", async () => {
    vi.mocked(crmApi.listCrmLeads).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, statusCounts: {} as never } });
    wrap(<CrmLeadsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "CSV / Excel" }));
    await waitFor(() => expect(crmApi.downloadCrmFile).toHaveBeenCalledWith("/admin/crm/leads/export", expect.objectContaining({ candidate: "all" }), expect.stringMatching(/\.csv$/)));
  });
});

describe("talep detayı", () => {
  const detail = (): CrmLeadDetail => ({
    ...lead(),
    notes: [{ id: "n1", kind: "NOTE", authorName: "Admin Bir", body: `Not ${XSS}`, createdAt: "2026-10-23T09:00:00.000Z" }],
    bookingSuggestions: [
      { id: "33333333-3333-4333-8333-333333333333", bookingNumber: "WM-1001", createdAt: "2026-10-22T10:00:00.000Z", paymentStatus: "PAID", totalCents: 15000, currency: "EUR", doctorName: "Op. Dr. Test", reason: "Aynı e-posta adresi" },
    ],
    linkedBooking: null,
  });

  it("notlar kaçışlanır; randevu yalnızca 'Bağla' ile bağlanır; durum kaydı", async () => {
    vi.mocked(crmApi.getCrmLead).mockResolvedValue(detail());
    vi.mocked(crmApi.updateCrmLead).mockResolvedValue(lead());
    const params = Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" });
    let view!: ReturnType<typeof wrap>;
    await act(async () => {
      view = wrap(<CrmLeadDetailPage params={params} />);
    });
    expect(await screen.findByText(`Not ${XSS}`)).toBeInTheDocument();
    expect(view.container.querySelector("img")).toBeNull();
    expect(crmApi.updateCrmLead).not.toHaveBeenCalled();

    const suggestion = screen.getByText("WM-1001").closest("li")!;
    fireEvent.click(within(suggestion).getByRole("button", { name: /Bağla/ }));
    await waitFor(() => expect(crmApi.updateCrmLead).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", { bookingId: "33333333-3333-4333-8333-333333333333" }));

    fireEvent.change(screen.getByLabelText("Durum"), { target: { value: "APPOINTMENT_GIVEN" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(crmApi.updateCrmLead).toHaveBeenLastCalledWith("11111111-1111-4111-8111-111111111111", expect.objectContaining({ status: "APPOINTMENT_GIVEN" })));
  });
});

describe("hasta yolculuğu", () => {
  it("aşamalar, ciro ve kırılım tablosu", async () => {
    const row = { key: "google / cpc", label: "google / cpc", visits: 100, doctorPage: 40, bookingStarted: 10, bookings: 5, paid: 4, consulted: 3, revenue: { EUR: 60000 }, conversionRate: 4 };
    vi.mocked(crmApi.getCrmFunnel).mockResolvedValue({ rows: [row], total: { ...row, key: "total", label: "Toplam" } });
    wrap(<CrmFunnelPage />);
    expect(await screen.findByText("Görüşme yapıldı")).toBeInTheDocument();
    expect(screen.getAllByText(/600/).length).toBeGreaterThan(0);
    expect(screen.getByRole("cell", { name: "google / cpc" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Atıf modeli" }), { target: { value: "first" } });
    await waitFor(() => expect(crmApi.getCrmFunnel).toHaveBeenLastCalledWith(expect.objectContaining({ model: "first", groupBy: "source" })));
  });
});

describe("UTM oluşturucu", () => {
  it("değerleri normalize eder ve bağlantıyı üretir", () => {
    expect(normalizeUtm("  Obezite Ekim 2026 ")).toBe("obezite-ekim-2026");
    expect(buildUtmUrl("https://site.test/tr?x=1", { source: "Google", medium: "CPC", campaign: "Diz Protezi", term: "", content: "" })).toBe(
      "https://site.test/tr?x=1&utm_source=google&utm_medium=cpc&utm_campaign=diz-protezi"
    );
    expect(buildUtmUrl("bozuk", { source: "a", medium: "b", campaign: "c", term: "", content: "" })).toBeNull();
    render(<CrmUtmBuilderPage />);
    fireEvent.click(screen.getByRole("button", { name: "Google Ads" }));
    fireEvent.change(screen.getByLabelText("Kampanya (utm_campaign) *"), { target: { value: "Ekim" } });
    expect(screen.getByTestId("utm-output").textContent).toContain("utm_source=google&utm_medium=cpc&utm_campaign=ekim");
    expect(screen.getByRole("button", { name: /Kopyala/ })).toBeEnabled();
  });
});
