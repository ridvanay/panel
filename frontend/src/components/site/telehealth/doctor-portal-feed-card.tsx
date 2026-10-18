"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, CheckCircle2, Megaphone, ShieldCheck } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { fmt, useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import type { PortalStrings } from "@/lib/i18n/site-dictionaries/en/portal";
import type {
  DoctorPortalAnnouncement,
  DoctorPortalAnnouncementSeverity,
  DoctorPortalFeed,
  DoctorPortalNotification,
  DoctorPortalNotificationKind,
} from "@/lib/api/types";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-context";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `GET /doctor/portal-feed` — "Portal Akışı & Duyurular" kartı. `doctor-bookings-panel.tsx`'in
 * `loadOverview` deseniyle AYNI şekilde (`useCallback` + `useEffect`, `friendlyErrorMessage`,
 * `Skeleton`) veri çeker; ayrı bir dosyada tutulur (panel zaten büyük).
 *
 * Grid görevi (2026-09-14): bu kart artık `doctor-bookings-panel.tsx`'in dar (~%25-30) sağ
 * sidebar sütununda render edilir — eski `grid-cols-1 lg:grid-cols-2` yatay 2-kolon düzeni (duyuru +
 * bildirim yan yana) dar sütunda EZİLİR, bu yüzden TEK dikey sütuna çevrildi (duyurular üstte,
 * bildirimler altta) ve satır içi boşluklar kompakt bir liste hissi için sıkılaştırıldı. TÜM
 * `data-testid` isimleri KORUNDU — qa-agent'ın `telehealth-doctor-session-guard.spec.ts` testi buna
 * bağımlı.
 *
 * ui-designer inceltme turu (2026-09-14) — sidebar'ın ana alanın (`shadow-sm`'li KPI/randevu
 * kartları) ÖNÜNE GEÇMEMESİ için BİLİNÇLİ olarak gölgesiz/düz bırakıldı (görsel ağırlık hiyerarşisi).
 * Duyuru satırları artık önem seviyesine göre renkli sol-kenar vurgusu (`border-l-2`) taşıyor —
 * kutu-içinde-kutu gürültüsünü azaltırken önem rozetiyle AYNI ton eşlemesini (INFO→primary,
 * IMPORTANT→warning, SYSTEM→danger) tekrarlıyor. Bildirim satırları tam kutu yerine ince bir
 * `divide-y` liste desenine çevrildi — duyurulardan daha düşük görsel öncelik.
 */

const SEVERITY_BADGE_TONE: Record<DoctorPortalAnnouncementSeverity, "primary" | "warning" | "danger"> = {
  INFO: "primary",
  IMPORTANT: "warning",
  SYSTEM: "danger",
};

const SEVERITY_ACCENT_BORDER: Record<DoctorPortalAnnouncementSeverity, string> = {
  INFO: "border-l-primary",
  IMPORTANT: "border-l-warning",
  SYSTEM: "border-l-danger",
};

type DoctorFeedStrings = PortalStrings["doctorFeed"];

const SEVERITY_LABEL_KEY: Record<DoctorPortalAnnouncementSeverity, keyof DoctorFeedStrings> = {
  INFO: "severityInfo",
  IMPORTANT: "severityImportant",
  SYSTEM: "severitySystem",
};

const NOTIFICATION_TEMPLATE_KEY: Record<DoctorPortalNotificationKind, keyof DoctorFeedStrings> = {
  BOOKING_CREATED: "notificationBookingCreated",
  CONSENT_GIVEN: "notificationConsentGiven",
  APPOINTMENT_COMPLETED: "notificationAppointmentCompleted",
};

const NOTIFICATION_ICON: Record<DoctorPortalNotificationKind, typeof CalendarPlus> = {
  BOOKING_CREATED: CalendarPlus,
  CONSENT_GIVEN: ShieldCheck,
  APPOINTMENT_COMPLETED: CheckCircle2,
};

function FeedSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-16 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

function AnnouncementRow({ announcement, timeZone }: { announcement: DoctorPortalAnnouncement; timeZone: string }) {
  const { t, intlLocale } = usePortalStrings();
  return (
    <div
      data-testid="doctor-portal-feed-announcement"
      data-severity={announcement.severity}
      className={`rounded-[var(--site-radius)] border border-border border-l-2 bg-surface p-2.5 ${SEVERITY_ACCENT_BORDER[announcement.severity]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <p className="text-sm font-medium text-foreground">{announcement.title}</p>
        <Badge tone={SEVERITY_BADGE_TONE[announcement.severity]} size="sm">
          {t.doctorFeed[SEVERITY_LABEL_KEY[announcement.severity]]}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-foreground/70">{announcement.body}</p>
      <p className="mt-1.5 text-[11px] text-foreground/40">
        {formatDayLabel(announcement.publishedAt, timeZone, intlLocale)} · {formatTime(announcement.publishedAt, timeZone, intlLocale)}
      </p>
    </div>
  );
}

function NotificationRow({ notification, timeZone }: { notification: DoctorPortalNotification; timeZone: string }) {
  const Icon = NOTIFICATION_ICON[notification.kind];
  const { t, intlLocale } = usePortalStrings();
  // Eski backend `subject` döndürmüyorsa sunucunun hazır (Türkçe) metnine düşülür.
  const message =
    notification.subject !== undefined ? fmt(t.doctorFeed[NOTIFICATION_TEMPLATE_KEY[notification.kind]], { subject: notification.subject }) : notification.message;
  return (
    <div
      data-testid="doctor-portal-feed-notification"
      data-kind={notification.kind}
      className="flex items-start gap-2 py-2 first:pt-0 last:pb-0"
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-foreground">{message}</p>
        <p className="mt-0.5 text-[11px] text-foreground/40">
          {formatDayLabel(notification.occurredAt, timeZone, intlLocale)} · {formatTime(notification.occurredAt, timeZone, intlLocale)}
        </p>
      </div>
    </div>
  );
}

export function DoctorPortalFeedCard() {
  const profile = useDoctorPortalProfile();
  const timeZone = profile.doctorProfile.timeZone;
  const { t } = usePortalStrings();
  const friendlyErrorMessage = useFriendlyError();

  const [feed, setFeed] = useState<DoctorPortalFeed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    setError(null);
    try {
      const result = await telehealthApi.getDoctorPortalFeed();
      setFeed(result);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [friendlyErrorMessage]);

  // frontend-agent bug fix (§5.4 invariant 4) — `DoctorPortalFeedCard` `DoctorPortalShell`'in
  // `status === "ready"` olana KADAR HİÇ mount edilmez (bkz. shell'in koşullu render'ı); yani bu
  // bileşenin fiber'ı SAYFANIN İLK renderında DEĞİL, DAHA SONRA (bir state geçişinin SONUCUNDA)
  // oluşturulur — bu React'in geliştirme-modu StrictMode "mount → effect → cleanup → effect"
  // simülasyonunu (`reactStrictMode: true`, App Router'da Next 13.5.1'den beri VARSAYILAN, bkz.
  // `node_modules/next/dist/docs/.../reactStrictMode.md`) TAM OLARAK bu mount anında tetikler —
  // efekt gövdesi iki kez çalışıp GERÇEK bir ikinci `GET /doctor/portal-feed` isteği atıyordu.
  // (`DoctorPortalProvider`'ın `/doctor/me` efekti bu simülasyondan ETKİLENMEZ çünkü o bileşen
  // SIFIRINCI render'da zaten mount'tur; asıl fetch'i tetikleyen `authStatus` geçişi bir REMOUNT
  // DEĞİL sıradan bir yeniden render'dır — StrictMode YALNIZCA mount'ları ikiye katlar.)
  // `hasLoadedRef` ikinci (StrictMode) çağrıyı SESSİZCE atlar; state güncellemesini engelleyen bir
  // `ignore` bayrağı YETMEZ — `fetch()` her iki çağrıda da SENKRON olarak tetiklenir (ağ isteği
  // `await`'ten ÖNCE gönderilir), bu yüzden asıl istek KENDİSİ ikinci çağrıda hiç BAŞLATILMAMALI.
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadFeed();
  }, [loadFeed]);

  return (
    // `id`: `doctor-top-bar.tsx`'teki bildirim bağlantısının (`#doctor-portal-feed-card`) çapası —
    // invariant 4'ün "izin verilen geri çekilme"si (§5.4), ikinci bir `GET /doctor/portal-feed` AÇMAZ.
    <section id="doctor-portal-feed-card" data-testid="doctor-portal-feed-card" className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5 text-foreground/50" aria-hidden="true" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">{t.doctorFeed.title}</h2>
      </div>

      {error ? (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadFeed()}>
              {t.common.retry}
            </Button>
          </span>
        </Alert>
      ) : feed ? (
        // Sidebar dar sütununda YATAY 2-kolon (duyuru/bildirim yan yana) EZİLİR — TEK dikey sütun.
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">{t.doctorFeed.announcementsTitle}</h3>
            {feed.announcements.length === 0 ? (
              <p data-testid="doctor-portal-feed-announcements-empty" className="text-xs text-foreground/50">
                {t.doctorFeed.noAnnouncements}
              </p>
            ) : (
              <div className="space-y-2">
                {feed.announcements.map((announcement) => (
                  <AnnouncementRow key={announcement.id} announcement={announcement} timeZone={timeZone} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">{t.doctorFeed.notificationsTitle}</h3>
            {feed.notifications.length === 0 ? (
              <p data-testid="doctor-portal-feed-notifications-empty" className="text-xs text-foreground/50">
                {t.doctorFeed.noNotifications}
              </p>
            ) : (
              <div className="divide-y divide-border/50">
                {feed.notifications.map((notification) => (
                  <NotificationRow key={notification.id} notification={notification} timeZone={timeZone} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <FeedSkeleton />
      )}
    </section>
  );
}
