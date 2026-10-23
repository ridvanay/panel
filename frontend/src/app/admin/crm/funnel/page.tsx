"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as crmApi from "@/lib/api/crm";
import type { CrmFunnelGroupBy, CrmFunnelRow } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmDateRange, DataTable, KpiCard, SimpleSelect, defaultRange, formatPercent, formatRevenue, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const STAGES: { key: keyof Pick<CrmFunnelRow, "visits" | "doctorPage" | "bookingStarted" | "bookings" | "paid" | "consulted">; label: string }[] = [
  { key: "visits", label: "Ziyaret" },
  { key: "doctorPage", label: "Doktor / uzmanlık sayfası" },
  { key: "bookingStarted", label: "Randevu sihirbazı başladı" },
  { key: "bookings", label: "Randevu oluştu" },
  { key: "paid", label: "Ödendi" },
  { key: "consulted", label: "Görüşme yapıldı" },
];

const GROUP_OPTIONS: { value: CrmFunnelGroupBy; label: string }[] = [
  { value: "source", label: "Kaynak / ortam" },
  { value: "campaign", label: "Kampanya" },
  { value: "country", label: "Ülke" },
  { value: "language", label: "Dil" },
  { value: "device", label: "Cihaz" },
  { value: "doctor", label: "Doktor" },
];

/**
 * Paket N2 — Hasta yolculuğu: ziyaret → doktor sayfası → sihirbaz → randevu → ödeme → görüşme. Hangi
 * kaynak/kampanyanın GERÇEKTEN ödeme yapan hasta ve ciro getirdiğini gösterir. İlk/son temas seçilebilir.
 */
export default function CrmFunnelPage() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const [model, setModel] = useState<"first" | "last">("last");
  const [groupBy, setGroupBy] = useState<CrmFunnelGroupBy>("source");
  const funnel = useQuery({
    queryKey: ["crm-funnel", range.from, range.to, model, groupBy],
    queryFn: () => crmApi.getCrmFunnel({ from: range.from, to: range.to, model, groupBy }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <CrmDateRange value={range} onChange={setRange} />
        <SimpleSelect
          label="Atıf modeli"
          value={model}
          onChange={setModel}
          options={[
            { value: "last", label: "Son temas" },
            { value: "first", label: "İlk temas" },
          ]}
        />
        <SimpleSelect label="Kırılım" value={groupBy} onChange={setGroupBy} options={GROUP_OPTIONS} />
      </div>

      {funnel.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : funnel.isError ? (
        <Alert variant="error">{friendlyErrorMessage(funnel.error)}</Alert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Ziyaret (oturum)" value={funnel.data.total.visits.toLocaleString("tr-TR")} />
            <KpiCard label="Ödenen randevu" value={funnel.data.total.paid.toLocaleString("tr-TR")} />
            <KpiCard label="Ciro (ödenen)" value={formatRevenue(funnel.data.total.revenue)} />
            <KpiCard label="Ziyaretten ödemeye" value={formatPercent(funnel.data.total.conversionRate)} />
          </div>

          <Card className="space-y-3">
            <h2 className="admin-h2">Huni</h2>
            <ol className="space-y-2">
              {STAGES.map((stage, index) => {
                const value = funnel.data.total[stage.key];
                const top = Math.max(funnel.data.total.visits, 1);
                const prev = index > 0 ? funnel.data.total[STAGES[index - 1]!.key] : null;
                const step = prev ? (value / Math.max(prev, 1)) * 100 : null;
                return (
                  <li key={stage.key} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm">
                    <span>{stage.label}</span>
                    <div className="h-6 overflow-hidden rounded-md bg-muted">
                      <div className="flex h-full items-center rounded-md bg-primary/80 px-2 text-xs text-primary-foreground" style={{ width: `${Math.max(2, (value / top) * 100)}%` }}>
                        {value.toLocaleString("tr-TR")}
                      </div>
                    </div>
                    <span className="w-20 text-end text-xs text-foreground/60 tabular-nums">{step === null ? "" : formatPercent(Math.round(step * 10) / 10)}</span>
                  </li>
                );
              })}
            </ol>
            <p className="text-xs text-foreground/50">
              Sağdaki yüzde bir önceki aşamaya göre geçiştir. Randevu aşamaları yalnızca onaylı takipten gelen randevuları içerir; test olarak arşivlenen randevular hariçtir.
            </p>
          </Card>

          <Card className="space-y-3">
            <h2 className="admin-h2">{GROUP_OPTIONS.find((o) => o.value === groupBy)?.label} kırılımı</h2>
            <DataTable
              caption="Huni kırılımı"
              columns={[
                { key: "label", label: GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? "" },
                { key: "visits", label: "Ziyaret", numeric: true },
                { key: "doctorPage", label: "Doktor sf.", numeric: true },
                { key: "bookingStarted", label: "Sihirbaz", numeric: true },
                { key: "bookings", label: "Randevu", numeric: true },
                { key: "paid", label: "Ödendi", numeric: true },
                { key: "consulted", label: "Görüşme", numeric: true },
                { key: "revenue", label: "Ciro", numeric: true },
                { key: "rate", label: "Dönüşüm", numeric: true },
              ]}
              rows={funnel.data.rows.map((row) => ({
                id: row.key,
                cells: {
                  label: row.label,
                  visits: row.visits,
                  doctorPage: row.doctorPage,
                  bookingStarted: row.bookingStarted,
                  bookings: row.bookings,
                  paid: row.paid,
                  consulted: row.consulted,
                  revenue: formatRevenue(row.revenue),
                  rate: formatPercent(row.conversionRate),
                },
              }))}
            />
          </Card>
        </>
      )}
    </div>
  );
}
