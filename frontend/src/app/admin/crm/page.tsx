"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as crmApi from "@/lib/api/crm";
import { leadChannelLabel } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CrmDateRange,
  DataTable,
  KpiCard,
  LeadStatusBadge,
  defaultRange,
  formatDateTime,
  formatPercent,
  type DateRangeValue,
} from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dayFormatter = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Paket N3 — CRM Genel Bakış: bugün / 7 / 30 / 90 gün. KPI'lar (şu an sitede, ziyaretçi, sayfa görüntüleme,
 * WhatsApp/telefon tıklaması, talep, dönüşüm), günlük eğri ve tablolar (trafik kaynakları, temasın
 * gerçekleştiği sayfalar, giriş sayfaları, temastan önce okunan sayfalar, son talepler, sıcak ziyaretçiler,
 * en çok tıklanan öğeler).
 */
export default function CrmOverviewPage() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange("7"));
  const settings = useQuery({ queryKey: ["crm-settings"], queryFn: crmApi.getCrmSettings });
  const data = useQuery({ queryKey: ["crm-overview", range.from, range.to], queryFn: () => crmApi.getCrmOverview(range), refetchInterval: 60_000 });

  return (
    <div className="space-y-6">
      {settings.data && !settings.data.trackingEnabled && (
        <Alert variant="warning">
          Ziyaretçi takibi kapalı — yeni veri toplanmıyor.{" "}
          <Link href="/admin/crm/settings" className="font-medium underline">
            CRM Ayarları
          </Link>
          &apos;ndan açabilirsiniz.
        </Alert>
      )}
      <CrmDateRange value={range} onChange={setRange} />

      {data.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : data.isError ? (
        <Alert variant="error">{friendlyErrorMessage(data.error)}</Alert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Şu an sitede" value={data.data.kpis.liveNow} hint="Son 75 saniye" />
            <KpiCard label="Ziyaretçi" value={data.data.kpis.visitors.toLocaleString("tr-TR")} />
            <KpiCard label="Sayfa görüntüleme" value={data.data.kpis.pageviews.toLocaleString("tr-TR")} />
            <KpiCard label="Dönüşüm oranı" value={formatPercent(data.data.kpis.conversionRate)} hint="Talep / ziyaretçi" />
            <KpiCard label="WhatsApp tıklaması" value={data.data.kpis.whatsappClicks} />
            <KpiCard label="Telefon tıklaması" value={data.data.kpis.phoneClicks} />
            <KpiCard label="E-posta tıklaması" value={data.data.kpis.emailClicks} />
            <KpiCard label="Talep" value={data.data.kpis.leads} hint="Aday (tıklama) talepler hariç" />
          </div>

          <Card>
            <h2 className="text-sm font-medium">Günlük eğilim</h2>
            {data.data.series.length === 0 ? (
              <p className="py-10 text-center text-sm text-foreground/50">Bu aralıkta veri yok.</p>
            ) : (
              <div className="mt-3 h-64 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.data.series.map((d) => ({ ...d, label: dayFormatter.format(new Date(`${d.date}T00:00:00Z`)) }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="visitors" name="Ziyaretçi" stroke="var(--primary)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="pageviews" name="Görüntüleme" stroke="var(--chart-2, #8b5cf6)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="contacts" name="Temas" stroke="var(--chart-3, #16a34a)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="space-y-2">
              <h2 className="text-sm font-medium">Trafik kaynakları</h2>
              <DataTable
                caption="Trafik kaynakları"
                columns={[
                  { key: "source", label: "Kaynak / ortam" },
                  { key: "campaign", label: "Kampanya" },
                  { key: "sessions", label: "Oturum", numeric: true },
                  { key: "contacts", label: "Temas", numeric: true },
                ]}
                rows={data.data.sources.map((s, i) => ({
                  id: `${s.source}-${s.medium}-${s.campaign}-${i}`,
                  cells: { source: `${s.source} / ${s.medium}`, campaign: s.campaign ?? "—", sessions: s.sessions, contacts: s.contacts },
                }))}
              />
            </Card>
            <Card className="space-y-2">
              <h2 className="text-sm font-medium">Temasın gerçekleştiği sayfalar</h2>
              <DataTable
                caption="Temas sayfaları"
                columns={[
                  { key: "path", label: "Sayfa" },
                  { key: "contacts", label: "Temas", numeric: true },
                  { key: "pageviews", label: "Görüntüleme", numeric: true },
                ]}
                rows={data.data.contactPages.map((p) => ({ id: p.path, cells: { path: p.path, contacts: p.contacts, pageviews: p.pageviews } }))}
              />
            </Card>
            <Card className="space-y-2">
              <h2 className="text-sm font-medium">Giriş sayfaları</h2>
              <DataTable
                caption="Giriş sayfaları"
                columns={[
                  { key: "path", label: "Sayfa" },
                  { key: "entries", label: "Giriş", numeric: true },
                  { key: "contacts", label: "Temas", numeric: true },
                ]}
                rows={data.data.entryPages.map((p) => ({ id: p.path, cells: { path: p.path, entries: p.entries, contacts: p.contacts } }))}
              />
            </Card>
            <Card className="space-y-2">
              <h2 className="text-sm font-medium">Temastan önce okunan sayfalar</h2>
              <DataTable
                caption="Temastan önce okunan sayfalar"
                columns={[
                  { key: "path", label: "Sayfa" },
                  { key: "sessions", label: "Oturum", numeric: true },
                ]}
                rows={data.data.prePages.map((p) => ({ id: p.path, cells: { path: p.path, sessions: p.sessions } }))}
              />
            </Card>
            <Card className="space-y-2">
              <h2 className="text-sm font-medium">Son talepler</h2>
              <DataTable
                caption="Son talepler"
                columns={[
                  { key: "lead", label: "Talep" },
                  { key: "status", label: "Durum" },
                  { key: "date", label: "Tarih" },
                ]}
                rows={data.data.recentLeads.map((l) => ({
                  id: l.id,
                  cells: {
                    lead: (
                      <Link href={`/admin/crm/leads/${l.id}`} className="text-primary hover:underline">
                        {l.name || `#${l.seq}`} · {leadChannelLabel(l.channel)}
                      </Link>
                    ),
                    status: <LeadStatusBadge status={l.status} />,
                    date: formatDateTime(l.createdAt),
                  },
                }))}
                empty="Henüz talep yok."
              />
            </Card>
            <Card className="space-y-2">
              <h2 className="text-sm font-medium">Sıcak ziyaretçiler (puan ≥ {data.data.hotThreshold})</h2>
              <DataTable
                caption="Sıcak ziyaretçiler"
                columns={[
                  { key: "visitor", label: "Ziyaretçi" },
                  { key: "source", label: "İlk kaynak" },
                  { key: "score", label: "Puan", numeric: true },
                ]}
                rows={data.data.hotVisitors.map((v) => ({
                  id: v.id,
                  cells: {
                    visitor: (
                      <Link href={`/admin/crm/visitors/${v.id}`} className="text-primary hover:underline">
                        {v.country ?? "?"} · {formatDateTime(v.lastSeenAt)}
                        {v.refCode ? ` · Ref ${v.refCode}` : ""}
                      </Link>
                    ),
                    source: [v.firstSource, v.firstMedium].filter(Boolean).join(" / ") || "—",
                    score: v.score,
                  },
                }))}
              />
            </Card>
          </div>

          <Card className="space-y-2">
            <h2 className="text-sm font-medium">En çok tıklanan öğeler</h2>
            <DataTable
              caption="En çok tıklanan öğeler"
              columns={[
                { key: "text", label: "Öğe" },
                { key: "path", label: "Sayfa" },
                { key: "target", label: "Hedef" },
                { key: "clicks", label: "Tıklama", numeric: true },
              ]}
              rows={data.data.topClicks.map((c, i) => ({
                id: `${c.path}-${c.selector}-${i}`,
                cells: { text: c.text ?? c.selector ?? "—", path: c.path, target: c.target ?? "—", clicks: c.clicks },
              }))}
            />
          </Card>
        </>
      )}
    </div>
  );
}
