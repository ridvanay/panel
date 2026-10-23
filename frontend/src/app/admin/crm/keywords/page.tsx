"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import type { KeywordGroup } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmDateRange, DataTable, defaultRange, formatDateTime, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { SearchConsoleSetupSteps } from "@/components/admin/crm/search-console-setup";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const GROUPS: { value: "all" | KeywordGroup; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "1-3", label: "1–3" },
  { value: "4-10", label: "4–10" },
  { value: "11-20", label: "11–20" },
  { value: "21+", label: "21+" },
];

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-foreground/40">yeni</span>;
  if (value === 0) return <span className="text-foreground/50">0</span>;
  return value > 0 ? (
    <span className="text-success">
      <span aria-hidden="true">▲ {value}</span>
      <span className="sr-only">{`${value} sıra yükseldi`}</span>
    </span>
  ) : (
    <span className="text-danger">
      <span aria-hidden="true">▼ {-value}</span>
      <span className="sr-only">{`${-value} sıra düştü`}</span>
    </span>
  );
}

/**
 * Paket N4 — Anahtar Kelimeler (Google Search Console): sıra, değişim (önceki eşit dönem), gösterim, tıklama,
 * TO, en iyi sayfa; 1–3 / 4–10 / 11–20 / 21+ grupları. Hesap bağlı değilken kurulum adımları gösterilir.
 */
export default function CrmKeywordsPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const [group, setGroup] = useState<"all" | KeywordGroup>("all");
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const report = useQuery({
    queryKey: ["crm-keywords", range.from, range.to, group, q],
    queryFn: () => crmApi.getCrmKeywords({ from: range.from, to: range.to, group, q: q || undefined }),
    // Filtre değişirken tablo ekrandan kaybolmasın (arama kutusu odağı korunur).
    placeholderData: (previous) => previous,
  });

  async function sync() {
    setSyncing(true);
    try {
      const result = await crmApi.syncSearchConsole();
      if (result.ok) toast.success(`Search Console güncellendi (${result.rows} satır).`);
      else toast.error(result.error ?? "Senkron başarısız.");
      void queryClient.invalidateQueries({ queryKey: ["crm-keywords"] });
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  if (report.isPending) return <Skeleton className="h-96 w-full" />;
  if (report.isError) return <Alert variant="error">{friendlyErrorMessage(report.error)}</Alert>;
  const { connection } = report.data;

  if (!connection.connected) {
    return (
      <Card className="max-w-3xl space-y-3">
        <h2 className="admin-h2">Google Search Console bağlı değil</h2>
        <p className="text-sm text-foreground/70">Anahtar kelime sıraları için Search Console hesabını bağlayın:</p>
        <SearchConsoleSetupSteps />
        <Link href="/admin/crm/settings#search-console" className="inline-block text-sm font-medium text-primary underline">
          CRM Ayarları → Google Search Console
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CrmDateRange value={range} onChange={setRange} />
        <Button type="button" variant="outline" onClick={() => void sync()} disabled={syncing}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> {syncing ? "Güncelleniyor…" : "Şimdi güncelle"}
        </Button>
        <span className="text-xs text-foreground/60" dir="auto">
          {connection.propertyUrl} · son senkron {formatDateTime(connection.lastSyncAt)}
        </span>
      </div>
      {connection.lastSyncError && <Alert variant="warning">Son senkron hatası: {connection.lastSyncError}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Sıra grubu" className="inline-flex flex-wrap gap-1.5">
          {GROUPS.map((g) => (
            <button
              key={g.value}
              type="button"
              aria-pressed={group === g.value}
              onClick={() => setGroup(g.value)}
              className={`rounded-full border px-3 py-1 text-xs ${group === g.value ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/70 hover:bg-muted"}`}
            >
              {g.label} ({g.value === "all" ? report.data.total : report.data.groups[g.value]})
            </button>
          ))}
        </div>
        <Input aria-label="Anahtar kelime ara" placeholder="Anahtar kelime ara" value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
      </div>

      <Card>
        <DataTable
          caption="Anahtar kelimeler"
          empty="Bu aralıkta veri yok (Google verisi 2–3 gün gecikmeli gelir)."
          columns={[
            { key: "query", label: "Anahtar kelime" },
            { key: "position", label: "Sıra", numeric: true },
            { key: "change", label: "Değişim", numeric: true },
            { key: "impressions", label: "Gösterim", numeric: true },
            { key: "clicks", label: "Tıklama", numeric: true },
            { key: "ctr", label: "TO", numeric: true },
            { key: "page", label: "En iyi sayfa" },
          ]}
          rows={report.data.rows.map((r) => ({
            id: r.query,
            cells: {
              query: r.query,
              position: r.position.toLocaleString("tr-TR"),
              change: <Change value={r.change} />,
              impressions: r.impressions.toLocaleString("tr-TR"),
              clicks: r.clicks.toLocaleString("tr-TR"),
              ctr: `%${r.ctr.toLocaleString("tr-TR")}`,
              page: (
                <span className="break-all text-xs" dir="ltr">
                  {r.bestPage ?? "—"}
                </span>
              ),
            },
          }))}
        />
        <p className="mt-2 text-xs text-foreground/50">
          Değişim, önceki eşit uzunluktaki döneme ({report.data.previousRange.from} – {report.data.previousRange.to}) göredir.
        </p>
      </Card>
    </div>
  );
}
