"use client";

import { useState } from "react";
import { AlertTriangle, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { getMatcherLeadCard, type MatcherLeadCard as MatcherLeadCardData } from "@/lib/api/matcher";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatDateTime } from "@/components/admin/crm/crm-ui";

const DURATION: Record<string, string> = { lt1w: "1 haftadan az", "1to4w": "1–4 hafta", "1to6m": "1–6 ay", gt6m: "6 aydan fazla" };
const PRIOR: Record<string, string> = { yes: "Evet", no: "Hayır", unknown: "Bilmiyor" };
const PREFERENCE: Record<string, string> = { online: "Online görüşme", in_person: "İstanbul'da tedavi", either: "Farketmez" };
const FOR_WHOM: Record<string, string> = { self: "Kendisi", relative: "Yakını" };

/**
 * Paket W — CRM lead detayında sihirbaz cevapları (sağlık verisi). Veri yalnızca "Cevapları göster"e
 * basılınca istenir; uç CRM yetkisi (ADMIN + 2FA) ister ve her görüntüleme audit'e düşer.
 */
export function MatcherLeadCard({ leadId }: { leadId: string }) {
  const [data, setData] = useState<MatcherLeadCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getMatcherLeadCard(leadId));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="inline text-foreground/60">{label}: </dt>
      <dd className="inline" dir="auto">
        {value || "—"}
      </dd>
    </div>
  );

  return (
    <Card className="space-y-3" data-testid="matcher-lead-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Eşleştirme sihirbazı cevapları</h3>
        {!data && (
          <Button type="button" size="sm" variant="outline" loading={loading} onClick={() => void load()}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            Cevapları göster
          </Button>
        )}
      </div>
      {!data && <p className="text-xs text-foreground/60">Sağlık verisi içerir; görüntüleme kayıt altına alınır.</p>}
      {error && <Alert variant="error">{error}</Alert>}
      {data && (
        <>
          {data.anonymizedAt && <Alert variant="info">Saklama süresi dolduğu için sağlık bilgileri silindi ({formatDateTime(data.anonymizedAt)}).</Alert>}
          {!data.consentHealthAt && !data.anonymizedAt && <Alert variant="info">Sağlık verisi açık rızası verilmedi; şikayet ve cevaplar kaydedilmedi.</Alert>}
          {data.redFlagAcknowledgedAt && (
            <Alert variant="warning">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Acil durum uyarısı gösterildi; kişi “Acil değil, devam et” dedi ({formatDateTime(data.redFlagAcknowledgedAt)}).
              </span>
            </Alert>
          )}
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {row("Talep no", `#${data.number}`)}
            {row("Tarih", formatDateTime(data.createdAt))}
            {row("Konular", data.topics.map((t) => (t.isRedFlag ? `⚠ ${t.label}` : t.label)).join(", "))}
            {row("Kimin için", FOR_WHOM[data.forWhom] ?? data.forWhom)}
            {row("Yaş aralığı", data.ageBand ?? (data.birthYear ? String(data.birthYear) : null))}
            {row("Veli/vasi", data.guardianName)}
            {row("Süre", data.duration ? DURATION[data.duration] : null)}
            {row("Önceki tanı", data.priorDiagnosis ? PRIOR[data.priorDiagnosis] : null)}
            {row("Tercih", PREFERENCE[data.preference] ?? data.preference)}
            {row("Görüşme dili", data.preferredLanguage)}
            {row("Ülke / saat dilimi", [data.country, data.timeZone].filter(Boolean).join(" · "))}
            {row("Önerilen uzmanlık", data.recommendedSpecialties.join(", "))}
            {row("Önerilen hekimler", data.recommendedDoctors.map((d) => d.name).join(", "))}
            {row("Sağlık rızası", data.consentHealthAt ? formatDateTime(data.consentHealthAt) : "Yok")}
            {row("İletişim izni", data.consentContactAt ? formatDateTime(data.consentContactAt) : "Yok — aranmamalı")}
            {row("Geri arama isteği", data.callbackRequestedAt ? formatDateTime(data.callbackRequestedAt) : "Yok")}
          </dl>
          {data.freeText && (
            <div>
              <p className="text-xs font-semibold text-foreground/60">Kendi cümleleriyle</p>
              <p className="mt-1 whitespace-pre-line rounded-md bg-surface-muted p-2 text-sm" dir="auto">
                {data.freeText}
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
