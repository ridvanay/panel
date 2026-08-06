import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExportJobsTable } from "@/components/admin/reports/export-jobs-table";
import type { ExportJob } from "@/lib/api/types";

/**
 * `ExportJobsTable` — durum rozeti (PENDING/PROCESSING/COMPLETED/FAILED) gösterimini ve
 * "İndir" butonunun YALNIZCA `COMPLETED` + süresi dolmamış işlerde aktif olduğunu doğrular
 * (bkz. `export-jobs-table.tsx::canDownload`). `useExportJobsList`/`useDownloadExportJob`
 * hook'ları GERÇEK (mock'lanmamış) — yalnızca `lib/api/reports` mock'lanır, böylece bileşen +
 * hook entegrasyonu birlikte test edilir.
 */
function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock("@/lib/api/reports", () => ({
  listExportJobs: vi.fn(),
  downloadExportJob: vi.fn(),
}));

const reportsApi = await import("@/lib/api/reports");

function makeJob(overrides: Partial<ExportJob>): ExportJob {
  return {
    id: "job-1",
    type: "VIEWS",
    format: "CSV",
    status: "PENDING",
    filters: {},
    containsPii: false,
    errorSummary: null,
    createdById: "user-1",
    createdBy: { id: "user-1", name: "Test Kullanıcı", email: "user@example.com", avatarUrl: null },
    expiresAt: "2026-12-01T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ExportJobsTable", () => {
  it("boş liste — EmptyState gösterilir", async () => {
    vi.mocked(reportsApi.listExportJobs).mockResolvedValue({ items: [], meta: { nextCursor: null } });
    renderWithQueryClient(<ExportJobsTable />);
    expect(await screen.findByText("Henüz dışa aktarma işi yok")).toBeInTheDocument();
  });

  it("hata durumunda Alert + Tekrar Dene butonu gösterilir", async () => {
    vi.mocked(reportsApi.listExportJobs).mockRejectedValue(new Error("ağ hatası"));
    renderWithQueryClient(<ExportJobsTable />);
    expect(await screen.findByRole("button", { name: "Tekrar Dene" })).toBeInTheDocument();
  });

  it("PENDING/PROCESSING/FAILED işlerde İndir butonu DEVRE DIŞI, COMPLETED (süresi dolmamış) işte AKTİFTİR", async () => {
    const jobs = [
      makeJob({ id: "job-pending", type: "VIEWS", status: "PENDING" }),
      makeJob({ id: "job-processing", type: "BREAKDOWN", status: "PROCESSING" }),
      makeJob({ id: "job-failed", type: "SUMMARY", status: "FAILED", errorSummary: "Beklenmeyen bir hata oluştu." }),
      makeJob({ id: "job-completed", type: "TOP_CONTENT", status: "COMPLETED" }),
    ];
    vi.mocked(reportsApi.listExportJobs).mockResolvedValue({ items: jobs, meta: { nextCursor: null } });
    renderWithQueryClient(<ExportJobsTable />);

    await screen.findByText("Kuyrukta");
    expect(screen.getByText("İşleniyor")).toBeInTheDocument();
    expect(screen.getByText("Başarısız")).toBeInTheDocument();
    expect(screen.getByText("Tamamlandı")).toBeInTheDocument();
    expect(screen.getByText("Beklenmeyen bir hata oluştu.")).toBeInTheDocument();

    const downloadButtons = screen.getAllByRole("button", { name: /raporunu indir/ });
    expect(downloadButtons).toHaveLength(4);
    expect(downloadButtons[0]).toBeDisabled(); // PENDING
    expect(downloadButtons[1]).toBeDisabled(); // PROCESSING
    expect(downloadButtons[2]).toBeDisabled(); // FAILED
    expect(downloadButtons[3]).toBeEnabled(); // COMPLETED, süresi dolmamış
  });

  it("süresi dolmuş bir COMPLETED iş için İndir butonu DEVRE DIŞIDIR ve \"(süresi doldu)\" etiketi görünür", async () => {
    const jobs = [makeJob({ id: "job-expired", status: "COMPLETED", expiresAt: "2020-01-01T00:00:00.000Z" })];
    vi.mocked(reportsApi.listExportJobs).mockResolvedValue({ items: jobs, meta: { nextCursor: null } });
    renderWithQueryClient(<ExportJobsTable />);

    await screen.findByText("Tamamlandı");
    expect(screen.getByText(/\(süresi doldu\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /raporunu indir/ })).toBeDisabled();
  });

  it("COMPLETED + süresi dolmamış bir işte İndir'e tıklamak downloadExportJob'u DOĞRU job ile çağırır", async () => {
    const job = makeJob({ id: "job-download-me", type: "USERS", status: "COMPLETED" });
    vi.mocked(reportsApi.listExportJobs).mockResolvedValue({ items: [job], meta: { nextCursor: null } });
    vi.mocked(reportsApi.downloadExportJob).mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderWithQueryClient(<ExportJobsTable />);

    const downloadButton = await screen.findByRole("button", { name: /raporunu indir/ });
    await user.click(downloadButton);

    await waitFor(() => expect(reportsApi.downloadExportJob).toHaveBeenCalledWith(expect.objectContaining({ id: "job-download-me" })));
  });
});
