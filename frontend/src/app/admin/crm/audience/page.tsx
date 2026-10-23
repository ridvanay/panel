"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as crmApi from "@/lib/api/crm";
import { CRM_DEVICE_LABELS, type CrmAudienceRow } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmDateRange, DataTable, MiniBar, defaultRange, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["tr"], { type: "region" }) : null;
const languageNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["tr"], { type: "language" }) : null;

function countryLabel(code: string): string {
  if (code === "UNKNOWN") return "Bilinmiyor";
  try {
    return `${regionNames?.of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

function languageLabel(code: string): string {
  if (code === "unknown") return "Bilinmiyor";
  try {
    return `${languageNames?.of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

/**
 * Paket N3 — uluslararası hasta odağı: ülke, dil, saat dilimi ve cihaz kırılımı; doktor ve uzmanlık ilgisi
 * (sayfa görüntüleme, kişi, temas, randevu sihirbazı başlatma).
 */
export default function CrmAudiencePage() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const audience = useQuery({ queryKey: ["crm-audience", range.from, range.to], queryFn: () => crmApi.getCrmAudience(range) });

  return (
    <div className="space-y-4">
      <CrmDateRange value={range} onChange={setRange} />
      {audience.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : audience.isError ? (
        <Alert variant="error">{friendlyErrorMessage(audience.error)}</Alert>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <BreakdownCard title="Ülkeler" rows={audience.data.countries} label={countryLabel} />
          <BreakdownCard title="Diller" rows={audience.data.languages} label={languageLabel} />
          <BreakdownCard title="Saat dilimleri" rows={audience.data.timezones} label={(k) => (k === "unknown" ? "Bilinmiyor" : k)} />
          <BreakdownCard title="Cihazlar" rows={audience.data.devices} label={(k) => CRM_DEVICE_LABELS[k] ?? k} />
          <InterestCard title="Doktor ilgisi" rows={audience.data.doctors} />
          <InterestCard title="Uzmanlık ilgisi" rows={audience.data.specialties} />
        </div>
      )}
    </div>
  );
}

function BreakdownCard({ title, rows, label }: { title: string; rows: CrmAudienceRow[]; label: (key: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <DataTable
        caption={title}
        columns={[
          { key: "label", label: title },
          { key: "bar", label: "" },
          { key: "visitors", label: "Kişi", numeric: true },
          { key: "contacts", label: "Temas", numeric: true },
        ]}
        rows={rows.slice(0, 20).map((r) => ({
          id: r.key,
          cells: { label: label(r.key), bar: <MiniBar ratio={r.visitors / max} />, visitors: r.visitors, contacts: r.contacts },
        }))}
      />
    </Card>
  );
}

function InterestCard({ title, rows }: { title: string; rows: CrmAudienceRow[] }) {
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <DataTable
        caption={title}
        columns={[
          { key: "label", label: "Ad" },
          { key: "pageviews", label: "Görüntüleme", numeric: true },
          { key: "visitors", label: "Kişi", numeric: true },
          { key: "contacts", label: "Temas", numeric: true },
          { key: "booking", label: "Sihirbaz", numeric: true },
        ]}
        rows={rows.map((r) => ({ id: r.key, cells: { label: r.label, pageviews: r.pageviews, visitors: r.visitors, contacts: r.contacts, booking: r.bookingsStarted } }))}
      />
    </Card>
  );
}
