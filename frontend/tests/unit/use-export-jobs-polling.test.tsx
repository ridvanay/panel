import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useExportJob, useExportJobsList } from "@/hooks/use-export-jobs";
import type { ExportJob } from "@/lib/api/types";

/**
 * `useExportJobsList`/`useExportJob` — `refetchInterval` polling'inin devam eden (`PENDING`/
 * `PROCESSING`) işler varken ÇALIŞTIĞINI, iş(ler) sonlanınca (`COMPLETED`/`FAILED`) KENDİLİĞİNDEN
 * DURDUĞUNU doğrular (bkz. `use-export-jobs.ts` üstündeki yorum — "bu geçişin asıl kazanımı").
 * GERÇEK zamanlayıcılarla çalışır — `vi.useFakeTimers()` + `advanceTimersByTimeAsync` bu
 * projedeki TanStack Query sürümüyle GÜVENİLİR biçimde etkileşMEDİĞİ (deneysel olarak
 * doğrulandı — `data`, sahte zaman ilerletildikten SONRA bile eski kalıyor) için BİLEREK
 * kullanılmadı; testler `refetchInterval` sabitlerine (3sn/2sn) göre kısa ama GERÇEK bekleme
 * kullanır. Her test
 * sonunda hook `unmount()` edilir — aksi halde arka planda çalışan `setInterval` bir SONRAKİ
 * testin (yeniden yapılandırılmış) mock'unu beklenmedik sayıda çağırıp testi kirletir.
 */
vi.mock("@/lib/api/reports", () => ({
  listExportJobs: vi.fn(),
  getExportJob: vi.fn(),
}));

const reportsApi = await import("@/lib/api/reports");

let activeUnmount: (() => void) | null = null;

afterEach(() => {
  activeUnmount?.();
  activeUnmount = null;
  vi.clearAllMocks();
});

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
    createdBy: null,
    expiresAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderWithClient<T>(callback: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = renderHook(callback, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  activeUnmount = () => {
    utils.unmount();
    queryClient.clear();
  };
  return utils;
}

describe("useExportJobsList — polling", () => {
  it(
    "PENDING bir iş varken tekrar tekrar poll eder; iş COMPLETED olunca poll DURUR",
    async () => {
      let call = 0;
      vi.mocked(reportsApi.listExportJobs).mockImplementation(async () => {
        call += 1;
        const job = call === 1 ? makeJob({ status: "PENDING" }) : makeJob({ status: "COMPLETED" });
        return { items: [job], meta: { nextCursor: null } };
      });

      const { result } = renderWithClient(() => useExportJobsList());

      await waitFor(() => expect(result.current.data?.pages[0]?.items[0]?.status).toBe("PENDING"));
      // `refetchInterval` 3sn — devam eden bir iş varken bir sonraki poll'un GERÇEKTEN
      // gerçekleştiğini (ve COMPLETED'a geçtiğini) bekleriz.
      await waitFor(() => expect(result.current.data?.pages[0]?.items[0]?.status).toBe("COMPLETED"), { timeout: 6000 });

      const callsAfterCompletion = vi.mocked(reportsApi.listExportJobs).mock.calls.length;
      expect(callsAfterCompletion).toBeGreaterThanOrEqual(2);

      // İş artık COMPLETED — poll DURMUŞ olmalı, bir sonraki 3sn'lik pencerede TEKRAR
      // çağrılmamalı.
      await new Promise((resolve) => setTimeout(resolve, 3500));
      expect(vi.mocked(reportsApi.listExportJobs).mock.calls.length).toBe(callsAfterCompletion);
    },
    12000
  );

  it(
    "başlangıçta hiç PENDING/PROCESSING iş yoksa hiç poll etmez (tek seferlik fetch)",
    async () => {
      const completed = makeJob({ status: "COMPLETED" });
      vi.mocked(reportsApi.listExportJobs).mockResolvedValue({ items: [completed], meta: { nextCursor: null } });

      renderWithClient(() => useExportJobsList());

      await waitFor(() => expect(reportsApi.listExportJobs).toHaveBeenCalledTimes(1));

      await new Promise((resolve) => setTimeout(resolve, 3500));
      expect(reportsApi.listExportJobs).toHaveBeenCalledTimes(1);
    },
    8000
  );
});

describe("useExportJob — polling", () => {
  it(
    "PROCESSING durumundaki bir işi tekrar tekrar poll eder; FAILED olunca poll DURUR",
    async () => {
      let call = 0;
      vi.mocked(reportsApi.getExportJob).mockImplementation(async () => {
        call += 1;
        return call === 1
          ? makeJob({ status: "PROCESSING" })
          : makeJob({ status: "FAILED", errorSummary: "hata" });
      });

      const { result } = renderWithClient(() => useExportJob("job-1"));

      await waitFor(() => expect(result.current.data?.status).toBe("PROCESSING"));
      // `refetchInterval` 2sn.
      await waitFor(() => expect(result.current.data?.status).toBe("FAILED"), { timeout: 5000 });

      const callsAfterFailure = vi.mocked(reportsApi.getExportJob).mock.calls.length;
      expect(callsAfterFailure).toBeGreaterThanOrEqual(2);

      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect(vi.mocked(reportsApi.getExportJob).mock.calls.length).toBe(callsAfterFailure);
    },
    10000
  );
});
