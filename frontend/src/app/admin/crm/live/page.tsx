"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import * as crmApi from "@/lib/api/crm";
import { CRM_DEVICE_LABELS } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, formatMinutes } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/** Paket N3 — Şu An Sitede: son 75 saniyede sinyal gönderen oturumlar; 20 saniyede bir yenilenir. */
export default function CrmLivePage() {
  const live = useQuery({ queryKey: ["crm-live"], queryFn: crmApi.getCrmLive, refetchInterval: 20_000 });

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="admin-h2">Şu an sitede: {live.data?.length ?? "…"}</h2>
        <span className="text-xs text-foreground/60">
          20 saniyede bir yenilenir{live.dataUpdatedAt ? ` · son: ${new Date(live.dataUpdatedAt).toLocaleTimeString("tr-TR")}` : ""}
        </span>
      </div>
      {live.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : live.isError ? (
        <Alert variant="error">{friendlyErrorMessage(live.error)}</Alert>
      ) : (
        <DataTable
          caption="Şu an sitede olan ziyaretçiler"
          empty="Şu an sitede ölçülen ziyaretçi yok."
          columns={[
            { key: "page", label: "Şu anki sayfa" },
            { key: "where", label: "Konum / cihaz" },
            { key: "source", label: "Kaynak" },
            { key: "pages", label: "Sayfa", numeric: true },
            { key: "time", label: "Süre", numeric: true },
            { key: "score", label: "Puan", numeric: true },
          ]}
          rows={live.data.map((s) => ({
            id: `${s.visitorId}-${s.startedAt}`,
            cells: {
              page: (
                <Link href={`/admin/crm/visitors/${s.visitorId}`} className="text-primary hover:underline" dir="ltr">
                  {s.currentPath}
                </Link>
              ),
              where: `${[s.city, s.country].filter(Boolean).join(", ") || "?"} · ${CRM_DEVICE_LABELS[s.deviceType] ?? s.deviceType}${s.returning ? " · tekrar" : ""}`,
              source: `${s.source} / ${s.medium}${s.campaign ? ` · ${s.campaign}` : ""}`,
              pages: s.pageCount,
              time: formatMinutes(Math.round(s.durationSeconds / 60)),
              score: s.score,
            },
          }))}
        />
      )}
    </Card>
  );
}
