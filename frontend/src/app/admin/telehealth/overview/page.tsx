"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Stethoscope } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { TelehealthOverview } from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { DateRangeFilter } from "@/components/admin/stats/date-range-filter";
import { TelehealthKpiCards } from "@/components/admin/telehealth/overview/telehealth-kpi-cards";
import { TelehealthRevenueChart } from "@/components/admin/telehealth/overview/telehealth-revenue-chart";
import { TelehealthAppointmentsChart } from "@/components/admin/telehealth/overview/telehealth-appointments-chart";
import { TelehealthDoctorBreakdownTable } from "@/components/admin/telehealth/overview/telehealth-doctor-breakdown-table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  RANGE_PRESET_LABELS,
  statsFilterStateFromSearchParams,
  statsFilterStateToSearchParams,
  toStatsRangeQuery,
  type StatsFilterState,
} from "@/lib/stats-range";

/**
 * [TCT] §9.7.7 KARAR K10a/K10b — `GET /admin/telehealth/analytics/overview` tek uçtan hem
 * KPI kartlarını hem de her iki grafiği/tabloyu besler (stats modülündeki ayrı-endpoint deseninin
 * AKSİNE) — bu yüzden TEK bir `useQuery` burada (`admin/stats/page.tsx`'teki
 * `useOverviewSummary` İLE AYNI yerel-hook deseni) çağrılır, alt bileşenler yalnızca `data`
 * dilimini prop olarak alır.
 */
function useTelehealthOverview(filter: StatsFilterState) {
  const range = toStatsRangeQuery(filter);
  return useQuery<TelehealthOverview>({
    queryKey: ["admin-telehealth-overview", range.from, range.to, filter.granularity],
    queryFn: () =>
      telehealthApi.getTelehealthOverview({ from: range.from, to: range.to, granularity: filter.granularity }),
  });
}

function TelehealthOverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-72" />
        <Card className="h-72" />
      </div>
    </div>
  );
}

function AdminTelehealthOverviewPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filter = useMemo(() => statsFilterStateFromSearchParams(searchParams), [searchParams]);

  function updateFilter(next: StatsFilterState) {
    const params = statsFilterStateToSearchParams(next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const rangeLabel = filter.preset === "custom" ? `${filter.from} – ${filter.to}` : `Son ${RANGE_PRESET_LABELS[filter.preset]}`;

  const overview = useTelehealthOverview(filter);

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Stethoscope}
        title="Tele-Sağlık Özeti"
        description="Randevu, ödeme ve komisyon geliri analitiği — doktor bazlı kırılım dahil."
        actions={<DateRangeFilter value={filter} onChange={updateFilter} />}
      />

      {overview.isError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {friendlyErrorMessage(overview.error)}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void overview.refetch()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {overview.isPending ? (
        <TelehealthOverviewSkeleton />
      ) : overview.data ? (
        <>
          <TelehealthKpiCards data={overview.data} />

          <div className="grid gap-4 lg:grid-cols-2">
            <TelehealthRevenueChart data={overview.data} rangeLabel={rangeLabel} />
            <TelehealthAppointmentsChart data={overview.data} rangeLabel={rangeLabel} />
          </div>

          <TelehealthDoctorBreakdownTable data={overview.data} />
        </>
      ) : null}
    </div>
  );
}

function AdminTelehealthOverviewPageFallback() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-6 w-6 text-primary" />
    </div>
  );
}

/**
 * NOT (Next.js 16 — bkz. frontend/AGENTS.md): `useSearchParams` kullanan Client Component
 * production build'de `<Suspense>` ile sarılmalı, aksi halde build hata verir (bkz.
 * `admin/stats/page.tsx` İLE AYNI desen). Filtre state'i URL'e yazıldığı için link paylaşılabilir.
 */
export default function AdminTelehealthOverviewPage() {
  return (
    <Suspense fallback={<AdminTelehealthOverviewPageFallback />}>
      <AdminTelehealthOverviewPageContent />
    </Suspense>
  );
}
