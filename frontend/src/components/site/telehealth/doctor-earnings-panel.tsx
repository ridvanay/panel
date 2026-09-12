"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Percent, PiggyBank, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { DoctorEarningsSession, DoctorEarningsSummary } from "@/lib/api/types";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-shell";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { formatPriceFromCents } from "@/lib/format-price";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §13.5 — `/doctor/earnings` (Kazançlarım). Üç stat kartı
 * (Brüt/Komisyon/Net) + tamamlanan seanslar tablosu/kart listesi. Admin `stat-card.tsx` BİLİNÇLİ
 * OLARAK KULLANILMAZ (§13.5.1 — genel shadcn tema tokenleri + dekoratif `blur-2xl` glow, §0'ın
 * "Minimal/Flat, ambient glow YOK" kararının ihlali); bu sayfa `.site-scope` token'larıyla, kendi
 * flat stat kartını kullanır.
 */

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  sublabel?: string;
  highlighted?: boolean;
}

function StatCard({ icon: Icon, label, value, sublabel, highlighted }: StatCardProps) {
  return (
    <div className={cn("rounded-[var(--site-radius)] border p-5", highlighted ? "border-primary/30 bg-primary/5" : "border-border bg-surface")}>
      <div className="flex items-center gap-2 text-sm text-foreground/60">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold", highlighted ? "text-primary" : "text-foreground")}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-foreground/50">{sublabel}</p>}
    </div>
  );
}

function EarningsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
        <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
        <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      </div>
      <Skeleton className="h-48 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function DoctorEarningsPanel() {
  const profile = useDoctorPortalProfile();
  const timeZone = profile.doctorProfile.timeZone;

  const [summary, setSummary] = useState<DoctorEarningsSummary | null>(null);
  const [sessions, setSessions] = useState<DoctorEarningsSession[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setSummary(null);
    setSessions(null);
    try {
      const page = await telehealthApi.getDoctorEarnings({ limit: 20 });
      setSummary(page.summary);
      setSessions(page.sessions.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await telehealthApi.getDoctorEarnings({ limit: 20, cursor: nextCursor });
      setSessions((prev) => [...(prev ?? []), ...page.sessions.items]);
      setSummary(page.summary);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Kazançlarım</h1>
        <p className="mt-1 text-sm text-foreground/60">Tamamlanan seanslarınızın brüt/net kazanç dökümünü buradan takip edin.</p>
      </div>

      {summary === null && !loadError ? (
        <EarningsSkeleton />
      ) : loadError ? (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              icon={Wallet}
              label="Toplam Brüt Kazanç"
              value={formatPriceFromCents(summary.grossCents, summary.currency)}
              sublabel={`Tamamlanan ${summary.completedSessionCount} seans`}
            />
            <StatCard
              icon={Percent}
              label={`Platform Komisyonu (%${summary.commissionRatePercent})`}
              value={formatPriceFromCents(summary.commissionCents, summary.currency)}
            />
            <StatCard
              icon={PiggyBank}
              label="Net Kazanç"
              value={formatPriceFromCents(summary.netCents, summary.currency)}
              sublabel="Komisyon sonrası, size ödenecek tutar"
              highlighted
            />
          </div>

          {!sessions || sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-[var(--site-radius)] border border-border bg-surface p-10 text-center">
              <Wallet className="h-8 w-8 text-foreground/30" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Henüz tamamlanmış bir seansınız yok.</p>
            </div>
          ) : (
            <div className="mt-8">
              {/* mobil kart listesi (<md) */}
              <div className="space-y-3 md:hidden">
                {sessions.map((session) => (
                  <div key={session.appointmentId} className="rounded-[var(--site-radius)] border border-border bg-surface p-4">
                    <p className="truncate text-sm font-semibold text-foreground">{session.patientName}</p>
                    <p className="text-xs text-foreground/60">
                      {formatDayLabel(session.startsAt, timeZone)} · {formatTime(session.startsAt, timeZone)}
                    </p>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-foreground/50">Brüt</span>
                        <span className="tabular-nums text-foreground">{formatPriceFromCents(session.grossCents, session.currency)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground/50">Komisyon</span>
                        <span className="tabular-nums text-foreground">{formatPriceFromCents(session.commissionCents, session.currency)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground/50">Net</span>
                        <span className="tabular-nums font-medium text-foreground">{formatPriceFromCents(session.netCents, session.currency)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* masaüstü tablo (md: ve üzeri) */}
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-foreground/50">
                    <th className="py-2 pr-4">Hasta</th>
                    <th className="py-2 pr-4">Tarih</th>
                    <th className="py-2 pr-4 text-right">Brüt Tutar</th>
                    <th className="py-2 pr-4 text-right">Komisyon</th>
                    <th className="py-2 text-right">Net Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sessions.map((session) => (
                    <tr key={session.appointmentId}>
                      <td className="py-3 pr-4 font-medium text-foreground">{session.patientName}</td>
                      <td className="py-3 pr-4 text-foreground/70">
                        {formatDayLabel(session.startsAt, timeZone)} · {formatTime(session.startsAt, timeZone)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-foreground">{formatPriceFromCents(session.grossCents, session.currency)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-foreground">
                        {formatPriceFromCents(session.commissionCents, session.currency)}
                      </td>
                      <td className="py-3 text-right tabular-nums font-medium text-foreground">
                        {formatPriceFromCents(session.netCents, session.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {nextCursor && (
                <div className="mt-4 flex justify-center">
                  <Button type="button" variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
                    Daha Fazla Yükle
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
