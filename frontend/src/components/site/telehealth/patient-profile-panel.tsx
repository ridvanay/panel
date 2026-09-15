"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, IdCard, Mail } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking, BookingIdentitySummary } from "@/lib/api/types";
import { useAuth } from "@/context/auth-context";
import { formatFullDayLabel } from "@/lib/telehealth-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.5 KARAR P — `/patient/profile`. Yeni veri
 * TOPLANMAZ/uç AÇILMAZ: künye, `GET /patient/bookings` yanıtındaki EN GÜNCEL (`identity.capturedAt`
 * en son) `identity !== null` booking'in MASKELİ özetinden türetilir. `GET .../identity` (açık
 * numara döner, her çağrı denetim kaydı üretir) ASLA çağrılmaz.
 *
 * `.claude/design-notes-telehealth.md` §14.6 (ENGELLEYİCİ dil kuralı, §9.8.5 madde 4) — künye
 * `tone="neutral"`dır, "doğrulandı/verified"/yeşil/`CircleCheck` KESİNLİKLE KULLANILMAZ. E-posta
 * rozeti AYRI bir `<section>`da, `success` tonu SERBESTTİR (`emailVerifiedAt` GERÇEK bir doğrulama
 * kaydıdır, madde 5).
 */
function latestIdentity(bookings: AppointmentBooking[]): BookingIdentitySummary | null {
  let latest: BookingIdentitySummary | null = null;
  for (const booking of bookings) {
    if (!booking.identity) continue;
    if (!latest || new Date(booking.identity.capturedAt).getTime() > new Date(latest.capturedAt).getTime()) {
      latest = booking.identity;
    }
  }
  return latest;
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-20 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function PatientProfilePanel() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setBookings(null);
    try {
      const page = await telehealthApi.listPatientBookings({ scope: "all", limit: 20 });
      setBookings(page.items);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profilim</h1>
        <p className="mt-1 text-sm text-foreground/60">Hesap bilgilerinizi ve son paylaştığınız kimlik özetini buradan görüntüleyin.</p>
      </div>

      {loadError && (
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
      )}

      {bookings === null && !loadError ? (
        <ProfileSkeleton />
      ) : (
        <>
          <section className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <IdCard className="h-4 w-4 text-foreground/50" aria-hidden="true" />
              Kimlik Bilgileri
            </h2>
            {(() => {
              const identity = bookings ? latestIdentity(bookings) : null;
              if (!identity) {
                return <p className="text-sm text-foreground/50">Kimlik bilgisi bulunmuyor</p>;
              }
              return (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral" size="sm" className="gap-1 font-mono tabular-nums">
                      {identity.maskedNumber}
                    </Badge>
                    <span className="text-sm text-foreground/60">{identity.citizenshipType === "TR" ? "T.C. Vatandaşı" : identity.countryCode}</span>
                  </div>
                  <p className="text-xs text-foreground/50">Kimlik bilgisi alındı — {formatFullDayLabel(identity.capturedAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}</p>
                </div>
              );
            })()}
          </section>

          <section className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Mail className="h-4 w-4 text-foreground/50" aria-hidden="true" />
              Hesap Bilgileri
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground">{user?.email}</span>
              {user?.emailVerifiedAt ? (
                <Badge tone="success" solid size="sm" className="gap-1">
                  <CircleCheck className="h-3 w-3" aria-hidden="true" />
                  E-posta Doğrulandı
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm" className="gap-1">
                  <Mail className="h-3 w-3" aria-hidden="true" />
                  E-posta Doğrulanmadı
                </Badge>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
