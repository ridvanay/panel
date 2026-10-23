"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, UserPlus } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import { CRM_DEVICE_LABELS, CRM_EVENT_LABELS, leadChannelLabel } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard, LeadStatusBadge, formatDateTime, formatMinutes } from "@/components/admin/crm/crm-ui";
import { CreateLeadDialog } from "@/components/admin/crm/create-lead-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket N3 — ziyaretçi detayı: oturumlar ve olay zaman çizelgesi (açılışı denetim kaydına yazılır).
 * "Talebe dönüştür" bu anonim ziyaretçiyi bir talebe ELLE bağlar; hasta kaydıyla otomatik birleştirme yoktur.
 */
export default function CrmVisitorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const visitor = useQuery({ queryKey: ["crm-visitor", id], queryFn: () => crmApi.getCrmVisitor(id) });
  const [convertOpen, setConvertOpen] = useState(false);

  if (visitor.isPending) return <Skeleton className="h-96 w-full" />;
  if (visitor.isError) return <Alert variant="error">{friendlyErrorMessage(visitor.error)}</Alert>;
  const v = visitor.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/crm/visitors" className="inline-flex items-center gap-1 text-sm text-foreground/70 hover:text-foreground">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> Ziyaretçiler
        </Link>
        <Button type="button" onClick={() => setConvertOpen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" /> Talebe dönüştür
        </Button>
      </div>

      <Card className="space-y-1">
        <h2 className="admin-h2">
          Anonim ziyaretçi <span className="font-mono text-sm" dir="ltr">{v.id}</span>
        </h2>
        <p className="text-sm text-foreground/70">
          İlk: {formatDateTime(v.firstSeenAt)} · Son: {formatDateTime(v.lastSeenAt)} · {v.country ?? "?"} · {v.language ?? "?"} · {v.timezone ?? "?"} ·{" "}
          {CRM_DEVICE_LABELS[v.deviceType] ?? v.deviceType}
          {v.refCode ? (
            <>
              {" "}
              · Ref <span className="font-mono">{v.refCode}</span>
            </>
          ) : null}
        </p>
        <p className="text-sm text-foreground/70" dir="auto">
          İlk kaynak: {[v.firstSource, v.firstMedium, v.firstCampaign].filter(Boolean).join(" / ") || "—"}
          {v.firstLandingPath ? ` · açılış ${v.firstLandingPath}` : ""}
        </p>
        {v.leads.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-1 text-sm">
            {v.leads.map((l) => (
              <li key={l.id}>
                <Link href={`/admin/crm/leads/${l.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  #{l.seq} {l.name ?? leadChannelLabel(l.channel)} <LeadStatusBadge status={l.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Sıcaklık puanı" value={v.score} />
        <KpiCard label="Ziyaret" value={v.sessionCount} />
        <KpiCard label="Sayfa görüntüleme" value={v.pageviewCount} />
        <KpiCard label="Okuma süresi" value={formatMinutes(Math.round(v.engagedSeconds / 60))} />
        <KpiCard label="Temas tıklaması" value={v.contactClicks} hint={v.reachedBooking ? "Randevu sihirbazına geldi" : undefined} />
      </div>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">Oturumlar</h3>
        <ul className="space-y-2">
          {v.sessions.map((s) => (
            <li key={s.id} className="rounded-lg border border-border p-2 text-sm">
              <p>
                {formatDateTime(s.startedAt)} · {s.source} / {s.medium}
                {s.campaign ? ` · ${s.campaign}` : ""} · {s.pageCount} sayfa · {formatMinutes(Math.round(s.durationSeconds / 60))}
                {s.bookingStarted ? " · randevu sihirbazı" : ""}
                {s.hasAdClickId ? " · reklam tıklaması" : ""}
              </p>
              <p className="text-xs text-foreground/60" dir="ltr">
                {s.landingPath} → {s.exitPath ?? "—"} · {[s.city, s.country].filter(Boolean).join(", ")} · {s.browser ?? "?"} / {s.os ?? "?"} · IP {s.ip ?? "—"}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">Zaman çizelgesi</h3>
        <ol className="space-y-1.5 border-s border-border ps-4">
          {v.events.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="text-xs text-foreground/50">{formatDateTime(e.occurredAt)}</span> ·{" "}
              <span className="font-medium">{CRM_EVENT_LABELS[e.type] ?? e.type}</span>{" "}
              <span dir="ltr" className="text-foreground/70">
                {e.path}
              </span>
              {e.title && (
                <span className="text-foreground/70" dir="auto">
                  {" "}
                  · {e.title}
                </span>
              )}
              {e.text && (
                <span dir="auto">
                  {" "}
                  · “{e.text}”
                </span>
              )}
              {e.target && (
                <span className="text-foreground/60" dir="ltr">
                  {" "}
                  → {e.target}
                </span>
              )}
              {e.scrollPct !== null && <span className="text-foreground/60"> · %{e.scrollPct}</span>}
              {e.step !== null && <span className="text-foreground/60"> · adım {e.step}</span>}
              {e.name && <span className="text-foreground/60"> · {e.name}</span>}
              {e.isRage && <span className="text-danger"> · öfkeli tıklama</span>}
              {e.isDead && <span className="text-warning"> · ölü tıklama</span>}
            </li>
          ))}
        </ol>
      </Card>

      <CreateLeadDialog open={convertOpen} onOpenChange={setConvertOpen} visitorId={v.id} onCreated={(leadId) => router.push(`/admin/crm/leads/${leadId}`)} />
    </div>
  );
}
