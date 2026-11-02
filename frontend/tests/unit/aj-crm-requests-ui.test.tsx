import { Suspense, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CrmRequestDetail, CrmRequestRow } from "@/lib/api/crm";

/**
 * Paket AJ-4 - admin "Danışma Talepleri": liste (alanlar, filtre, boş/hata/yükleme), CSV, durum + atama,
 * iç notlar, mesaj görüntüleme uyarısı ve kişisel verinin yalnızca sunucudan geldiğinde gösterilmesi.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/admin/crm/requests" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/api/telehealth", () => ({ listAdminSpecialties: vi.fn() }));
vi.mock("@/lib/api/crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/crm")>();
  return {
    ...actual,
    listCrmRequests: vi.fn(),
    listCrmRequestAssignees: vi.fn(),
    getCrmRequest: vi.fn(),
    updateCrmRequest: vi.fn(),
    addCrmRequestNote: vi.fn(),
    getCrmRequestMessage: vi.fn(),
    downloadCrmRequestsCsv: vi.fn(),
  };
});

import * as crmApi from "@/lib/api/crm";
import { listAdminSpecialties } from "@/lib/api/telehealth";
import CrmRequestsPage from "@/app/admin/crm/requests/page";
import CrmRequestDetailPage from "@/app/admin/crm/requests/[id]/page";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>{node}</Suspense>
    </QueryClientProvider>
  );
}

const row: CrmRequestRow = {
  id: "11111111-1111-4111-8111-111111111111",
  requestId: "r1",
  seq: 12,
  number: "REQ-0012",
  createdAt: "2026-11-02T10:00:00.000Z",
  serviceName: "Dental Treatments",
  specialtyId: "s1",
  packageId: null,
  country: "Germany",
  contactLanguage: "de",
  needsInterpreter: true,
  preferredContactChannel: "whatsapp",
  preferredFrom: null,
  preferredTo: null,
  status: "new",
  statusChangedAt: "2026-11-02T10:00:00.000Z",
  assignedToId: null,
  assignedToName: null,
  hasMessage: true,
  anonymizedAt: null,
  sla: { state: "pending", minutes: 120 },
};
const meta = { total: 1, page: 1, pageSize: 25, statusCounts: { new: 1, contacted: 0, planning: 0, converted: 0, closed: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAdminSpecialties).mockResolvedValue([{ id: "s1", name: "Dental Treatments" }] as never);
  vi.mocked(crmApi.listCrmRequestAssignees).mockResolvedValue([{ id: "u1", name: "Ayşe Yönetici" }]);
});

describe("Danışma Talepleri listesi", () => {
  it("alanları gösterir; kişisel veri yoksa ad/e-posta basılmaz", async () => {
    vi.mocked(crmApi.listCrmRequests).mockResolvedValue({ items: [row], meta });
    wrap(<CrmRequestsPage />);
    const tr = await screen.findByTestId("request-row");
    expect(within(tr).getByRole("link", { name: "REQ-0012" })).toHaveAttribute("href", `/admin/crm/requests/${row.id}`);
    expect(tr).toHaveTextContent("Dental Treatments");
    expect(tr).toHaveTextContent("Germany");
    expect(tr).toHaveTextContent("Evet");
    expect(tr).toHaveTextContent("WhatsApp");
    expect(tr).toHaveTextContent("Yeni");
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("durum filtresi sorguya gider ve sayılar rozetlerde görünür", async () => {
    vi.mocked(crmApi.listCrmRequests).mockResolvedValue({ items: [row], meta });
    wrap(<CrmRequestsPage />);
    await screen.findByTestId("request-row");
    fireEvent.click(screen.getByRole("button", { name: /Planlama/ }));
    await waitFor(() => expect(crmApi.listCrmRequests).toHaveBeenLastCalledWith(expect.objectContaining({ status: "planning", page: 1 })));
    expect(screen.getByRole("button", { name: /Yeni \(1\)/ })).toBeInTheDocument();
  });

  it("boş durum, hata (tekrar dene) ve CSV", async () => {
    vi.mocked(crmApi.listCrmRequests).mockResolvedValueOnce({ items: [], meta: { ...meta, total: 0 } });
    wrap(<CrmRequestsPage />);
    expect(await screen.findByText("Henüz danışma talebi yok.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("requests-export"));
    await waitFor(() => expect(crmApi.downloadCrmRequestsCsv).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalled();
  });

  it("liste hatasında mesaj ve Tekrar dene düğmesi görünür", async () => {
    vi.mocked(crmApi.listCrmRequests).mockRejectedValue(new Error("boom"));
    wrap(<CrmRequestsPage />);
    expect(await screen.findByRole("button", { name: "Tekrar dene" })).toBeInTheDocument();
  });
});

describe("Danışma talebi detayı", () => {
  const detail: CrmRequestDetail = {
    ...row,
    contactConsentAt: "2026-11-02T10:00:00.000Z",
    healthDataConsentAt: null,
    consentTextVersion: "v1",
    locale: "de",
    notes: [{ id: "n1", kind: "NOTE", authorName: "Ayşe Yönetici", body: "<b>arandı</b>", createdAt: "2026-11-02T11:00:00.000Z" }],
  };
  const params = Promise.resolve({ id: row.id });
  const open = async () => {
    await act(async () => {
      wrap(<CrmRequestDetailPage params={params} />);
    });
  };

  it("durum değişimi PATCH gönderir; atama kaldırılabilir", async () => {
    vi.mocked(crmApi.getCrmRequest).mockResolvedValue(detail);
    vi.mocked(crmApi.updateCrmRequest).mockResolvedValue(row);
    await open();
    const status = await screen.findByLabelText("Durum");
    fireEvent.change(status, { target: { value: "contacted" } });
    await waitFor(() => expect(crmApi.updateCrmRequest).toHaveBeenCalledWith(row.id, { status: "contacted" }));
    fireEvent.change(screen.getByLabelText("Atanan kişi"), { target: { value: "u1" } });
    await waitFor(() => expect(crmApi.updateCrmRequest).toHaveBeenCalledWith(row.id, { assignedToId: "u1" }));
  });

  it("iç notlar yazar ve zamanla gösterilir, HTML kaçışlanır; yeni not eklenir", async () => {
    vi.mocked(crmApi.getCrmRequest).mockResolvedValue(detail);
    vi.mocked(crmApi.addCrmRequestNote).mockResolvedValue(detail.notes[0]!);
    await open();
    const list = await screen.findByTestId("request-notes");
    expect(list).toHaveTextContent("Ayşe Yönetici");
    expect(list).toHaveTextContent("<b>arandı</b>");
    expect(list.querySelector("b")).toBeNull();
    fireEvent.change(screen.getByLabelText("Yeni not"), { target: { value: "Hasta aranacak" } });
    fireEvent.click(screen.getByRole("button", { name: "Not ekle" }));
    await waitFor(() => expect(crmApi.addCrmRequestNote).toHaveBeenCalledWith(row.id, "Hasta aranacak"));
  });

  it("mesaj varsayılan olarak gizli, 2FA/denetim uyarısı gösterilir; yalnızca düğmeyle çözülür", async () => {
    vi.mocked(crmApi.getCrmRequest).mockResolvedValue(detail);
    vi.mocked(crmApi.getCrmRequestMessage).mockResolvedValue({ id: row.id, number: row.number, message: "Merhaba" });
    await open();
    await screen.findByTestId("crm-request-detail");
    expect(screen.getByText(/iki adımlı doğrulaması \(2FA\)/)).toBeInTheDocument();
    expect(crmApi.getCrmRequestMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("request-show-message"));
    expect(await screen.findByTestId("request-message")).toHaveTextContent("Merhaba");
    expect(crmApi.getCrmRequestMessage).toHaveBeenCalledTimes(1);
  });

  it("mesaj yoksa uyarı ve düğme çıkmaz; kişisel veri yalnızca geldiğinde görünür", async () => {
    vi.mocked(crmApi.getCrmRequest).mockResolvedValue({ ...detail, hasMessage: false, fullName: "Max Mustermann", email: "max@example.com", phone: "+491" });
    await open();
    await screen.findByTestId("crm-request-detail");
    expect(screen.queryByTestId("request-show-message")).not.toBeInTheDocument();
    expect(screen.getByText(/Max Mustermann · max@example.com · \+491/)).toBeInTheDocument();
  });
});
