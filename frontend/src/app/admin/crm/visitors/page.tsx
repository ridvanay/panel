"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import * as crmApi from "@/lib/api/crm";
import { CRM_DEVICE_LABELS } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, formatDateTime, formatMinutes } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/** Paket N3 — Ziyaretçiler: sıcaklık puanı, WhatsApp Ref koduyla arama (ör. "Ref: AB12CD"), sıcak filtresi. */
export default function CrmVisitorsPage() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [hot, setHot] = useState(false);
  const [page, setPage] = useState(1);
  const visitors = useQuery({
    queryKey: ["crm-visitors", search, hot, page],
    queryFn: () => crmApi.listCrmVisitors({ q: search || undefined, hot: hot ? "true" : undefined, page, pageSize: 25 }),
  });
  const total = visitors.data?.meta.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <Card className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(q.trim());
        }}
      >
        <Input aria-label="Ref kodu ya da ziyaretçi kimliği" placeholder="Ref kodu (ör. Ref: AB12CD) ya da kimlik" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" dir="ltr" />
        <Button type="submit" variant="outline">
          Ara
        </Button>
        <label className="ms-2 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hot} onChange={(e) => (setPage(1), setHot(e.target.checked))} />
          Yalnızca sıcak ziyaretçiler{visitors.data ? ` (puan ≥ ${visitors.data.meta.hotThreshold})` : ""}
        </label>
      </form>
      {visitors.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : visitors.isError ? (
        <Alert variant="error">{friendlyErrorMessage(visitors.error)}</Alert>
      ) : (
        <DataTable
          caption="Ziyaretçiler"
          empty="Ziyaretçi bulunamadı."
          columns={[
            { key: "visitor", label: "Ziyaretçi" },
            { key: "source", label: "İlk kaynak" },
            { key: "where", label: "Ülke / dil / cihaz" },
            { key: "visits", label: "Ziyaret", numeric: true },
            { key: "pages", label: "Sayfa", numeric: true },
            { key: "time", label: "Okuma", numeric: true },
            { key: "score", label: "Puan", numeric: true },
          ]}
          rows={visitors.data.items.map((v) => ({
            id: v.id,
            cells: {
              visitor: (
                <Link href={`/admin/crm/visitors/${v.id}`} className="text-primary hover:underline">
                  {formatDateTime(v.lastSeenAt)}
                  {v.refCode ? <span className="ms-1 font-mono text-xs">Ref {v.refCode}</span> : null}
                </Link>
              ),
              source: [v.firstSource, v.firstMedium].filter(Boolean).join(" / ") || "—",
              where: `${v.country ?? "?"} · ${v.language ?? "?"} · ${CRM_DEVICE_LABELS[v.deviceType] ?? v.deviceType}`,
              visits: v.sessionCount,
              pages: v.pageviewCount,
              time: formatMinutes(Math.round(v.engagedSeconds / 60)),
              score: (
                <span className={v.score >= (visitors.data?.meta.hotThreshold ?? 100) ? "font-semibold text-danger" : undefined}>{v.score}</span>
              ),
            },
          }))}
        />
      )}
      <div className="flex items-center justify-between text-sm text-foreground/70">
        <span>
          Toplam {total} · Sayfa {page}/{pageCount}
        </span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Önceki
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Sonraki
          </Button>
        </div>
      </div>
    </Card>
  );
}
