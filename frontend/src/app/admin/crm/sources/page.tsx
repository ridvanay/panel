"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import * as crmApi from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmDateRange, DataTable, defaultRange, formatPercent, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket N3 — Kaynaklar ve Kampanyalar: oturum, ziyaretçi, giriş, temas ve sihirbaz başlatma. Ödeme ve ciro
 * kırılımı için Hasta Yolculuğu ekranına bağlantı verilir (aynı kaynak anahtarlarıyla).
 */
export default function CrmSourcesPage() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const sources = useQuery({ queryKey: ["crm-sources", range.from, range.to], queryFn: () => crmApi.getCrmSources(range) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CrmDateRange value={range} onChange={setRange} />
        <Link href="/admin/crm/funnel" className="text-sm text-primary underline">
          Ödeme ve ciro kırılımı → Hasta Yolculuğu
        </Link>
      </div>
      <Card>
        {sources.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : sources.isError ? (
          <Alert variant="error">{friendlyErrorMessage(sources.error)}</Alert>
        ) : (
          <DataTable
            caption="Kaynaklar ve kampanyalar"
            columns={[
              { key: "source", label: "Kaynak" },
              { key: "medium", label: "Ortam" },
              { key: "campaign", label: "Kampanya" },
              { key: "sessions", label: "Oturum", numeric: true },
              { key: "visitors", label: "Kişi", numeric: true },
              { key: "contacts", label: "Temas", numeric: true },
              { key: "booking", label: "Sihirbaz", numeric: true },
              { key: "rate", label: "Temas oranı", numeric: true },
            ]}
            rows={sources.data.map((s, i) => ({
              id: `${s.source}|${s.medium}|${s.campaign}|${i}`,
              cells: {
                source: s.source,
                medium: s.medium,
                campaign: s.campaign ?? "—",
                sessions: s.sessions,
                visitors: s.visitors,
                contacts: s.contacts,
                booking: s.bookingsStarted,
                rate: formatPercent(s.sessions > 0 ? Math.round((s.contacts / s.sessions) * 1000) / 10 : 0),
              },
            }))}
          />
        )}
      </Card>
    </div>
  );
}
