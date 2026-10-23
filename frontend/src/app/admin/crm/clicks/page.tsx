"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as crmApi from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmDateRange, DataTable, defaultRange, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket N3 — Tıklamalar: öğe (link/buton metni, ≤80 karakter), konum/kimlik (seçici) ve hedef. Metinler
 * ziyaretçi tarayıcısından gelir; burada YALNIZCA metin olarak gösterilir.
 */
export default function CrmClicksPage() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const [path, setPath] = useState("");
  const clicks = useQuery({ queryKey: ["crm-clicks", range.from, range.to, path], queryFn: () => crmApi.getCrmClicks({ ...range, path: path || undefined }), placeholderData: (previous) => previous });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CrmDateRange value={range} onChange={setRange} />
        <Input aria-label="Sayfa yolu filtresi" placeholder="Yalnızca bu sayfa: /tr/doctors/…" value={path} onChange={(e) => setPath(e.target.value.trim())} className="w-72" dir="ltr" />
      </div>
      <Card>
        {clicks.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : clicks.isError ? (
          <Alert variant="error">{friendlyErrorMessage(clicks.error)}</Alert>
        ) : (
          <DataTable
            caption="Tıklanan öğeler"
            columns={[
              { key: "text", label: "Öğe" },
              { key: "selector", label: "Konum / kimlik" },
              { key: "target", label: "Hedef" },
              { key: "path", label: "Sayfa" },
              { key: "clicks", label: "Tıklama", numeric: true },
              { key: "visitors", label: "Kişi", numeric: true },
            ]}
            rows={clicks.data.map((c, i) => ({
              id: `${c.path}|${c.selector}|${c.text}|${c.target}|${i}`,
              cells: {
                text: c.text ?? "—",
                selector: (
                  <code className="break-all text-xs" dir="ltr">
                    {c.selector ?? "—"}
                  </code>
                ),
                target: (
                  <span dir="ltr" className="break-all">
                    {c.target ?? "—"}
                  </span>
                ),
                path: (
                  <span dir="ltr" className="break-all">
                    {c.path}
                  </span>
                ),
                clicks: c.clicks,
                visitors: c.visitors,
              },
            }))}
          />
        )}
      </Card>
    </div>
  );
}
