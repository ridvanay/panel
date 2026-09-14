"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarPlus, CheckCircle2, Megaphone, ShieldCheck } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type {
  DoctorPortalAnnouncement,
  DoctorPortalAnnouncementSeverity,
  DoctorPortalFeed,
  DoctorPortalNotification,
  DoctorPortalNotificationKind,
} from "@/lib/api/types";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-shell";
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

const SEVERITY_LABEL: Record<DoctorPortalAnnouncementSeverity, string> = {
  INFO: "Bilgi",
  IMPORTANT: "Önemli",
  SYSTEM: "Sistem",
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
  return (
    <div
      data-testid="doctor-portal-feed-announcement"
      data-severity={announcement.severity}
      className={`rounded-[var(--site-radius)] border border-border border-l-2 bg-surface p-2.5 ${SEVERITY_ACCENT_BORDER[announcement.severity]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <p className="text-sm font-medium text-foreground">{announcement.title}</p>
        <Badge tone={SEVERITY_BADGE_TONE[announcement.severity]} size="sm">
          {SEVERITY_LABEL[announcement.severity]}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-foreground/70">{announcement.body}</p>
      <p className="mt-1.5 text-[11px] text-foreground/40">
        {formatDayLabel(announcement.publishedAt, timeZone)} · {formatTime(announcement.publishedAt, timeZone)}
      </p>
    </div>
  );
}

function NotificationRow({ notification, timeZone }: { notification: DoctorPortalNotification; timeZone: string }) {
  const Icon = NOTIFICATION_ICON[notification.kind];
  return (
    <div
      data-testid="doctor-portal-feed-notification"
      data-kind={notification.kind}
      className="flex items-start gap-2 py-2 first:pt-0 last:pb-0"
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-foreground">{notification.message}</p>
        <p className="mt-0.5 text-[11px] text-foreground/40">
          {formatDayLabel(notification.occurredAt, timeZone)} · {formatTime(notification.occurredAt, timeZone)}
        </p>
      </div>
    </div>
  );
}

export function DoctorPortalFeedCard() {
  const profile = useDoctorPortalProfile();
  const timeZone = profile.doctorProfile.timeZone;

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
  }, []);

  useEffect(() => {
    (async () => {
      await loadFeed();
    })();
  }, [loadFeed]);

  return (
    <section data-testid="doctor-portal-feed-card" className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5 text-foreground/50" aria-hidden="true" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Portal Akışı &amp; Duyurular</h2>
      </div>

      {error ? (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadFeed()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      ) : feed ? (
        // Sidebar dar sütununda YATAY 2-kolon (duyuru/bildirim yan yana) EZİLİR — TEK dikey sütun.
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">Yönetim Duyuruları</h3>
            {feed.announcements.length === 0 ? (
              <p data-testid="doctor-portal-feed-announcements-empty" className="text-xs text-foreground/50">
                Şu an yeni bir duyuru yok.
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
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">Hızlı Bildirimler</h3>
            {feed.notifications.length === 0 ? (
              <p data-testid="doctor-portal-feed-notifications-empty" className="text-xs text-foreground/50">
                Şu an yeni bir bildirim yok.
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
