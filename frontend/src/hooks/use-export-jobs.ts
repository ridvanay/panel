import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as reportsApi from "@/lib/api/reports";
import type { ListExportJobsParams } from "@/lib/api/reports";
import type { CreateExportJobRequest, ExportJob } from "@/lib/api/types";

export const exportJobKeys = {
  all: ["admin-export-jobs"] as const,
  lists: () => [...exportJobKeys.all, "list"] as const,
  list: (params: Omit<ListExportJobsParams, "cursor">) => [...exportJobKeys.lists(), params] as const,
  detail: (jobId: string) => [...exportJobKeys.all, "detail", jobId] as const,
};

const EXPORT_JOBS_PAGE_SIZE = 20;
const FINISHED_STATUSES: ExportJob["status"][] = ["COMPLETED", "FAILED"];

/**
 * "Daha fazla yükle" listesi — `admin/import/page.tsx` ile AYNI cursor deseni, `useInfiniteQuery`'e
 * taşınmış hâli. `refetchInterval` — şu ana kadar YÜKLENMİŞ sayfalarda `PENDING`/`PROCESSING`
 * bir iş varsa 3 sn'de bir tüm sayfaları yeniden çeker (yeni oluşturulan işin durumu, sayfayı
 * yenilemeye gerek kalmadan listede kendiliğinden güncellenir); tüm işler sonlanınca durur.
 */
export function useExportJobsList(params: Omit<ListExportJobsParams, "cursor" | "limit"> = {}) {
  return useInfiniteQuery({
    queryKey: exportJobKeys.list(params),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      reportsApi.listExportJobs({ ...params, cursor: pageParam ?? undefined, limit: EXPORT_JOBS_PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor,
    refetchInterval: (query) => {
      const pages = query.state.data?.pages ?? [];
      const hasInFlight = pages.some((page) => page.items.some((job) => !FINISHED_STATUSES.includes(job.status)));
      return hasInFlight ? 3000 : false;
    },
  });
}

export function flattenExportJobs(pages: { items: ExportJob[] }[] | undefined): ExportJob[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

/**
 * `GET /admin/reports/exports/{jobId}` — TEK bir işin durumunu izler. `import.worker` sayfasındaki
 * manuel `setInterval` yerine TanStack Query'nin `refetchInterval`'ı kullanılır (bu geçişin asıl
 * kazanımı): iş sonlanınca (`COMPLETED`/`FAILED`) poll KENDİLİĞİNDEN durur.
 */
export function useExportJob(jobId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: exportJobKeys.detail(jobId ?? "unknown"),
    queryFn: () => reportsApi.getExportJob(jobId!),
    enabled: Boolean(jobId) && (options.enabled ?? true),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || FINISHED_STATUSES.includes(status) ? false : 2000;
    },
  });
}

/** Yeni bir dışa aktarma işi oluşturur — başarıda liste sorgularını geçersiz kılar (yeni satır görünsün diye). */
export function useCreateExportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExportJobRequest) => reportsApi.createExportJob(input),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: exportJobKeys.lists() });
      queryClient.setQueryData(exportJobKeys.detail(job.id), job);
    },
  });
}

/** Blob indirme bir mutation olarak modellenir — `isPending` ile buton üzerinde yükleme durumu gösterilebilir. */
export function useDownloadExportJob() {
  return useMutation({
    mutationFn: (job: Pick<ExportJob, "id" | "type" | "format">) => reportsApi.downloadExportJob(job),
  });
}
