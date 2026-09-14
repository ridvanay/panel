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
 */

const SEVERITY_BADGE_TONE: Record<DoctorPortalAnnouncementSeverity, "primary" | "warning" | "danger"> = {
  INFO: "primary",
  IMPORTANT: "warning",
  SYSTEM: "danger",
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
      className="rounded-[var(--site-radius)] border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{announcement.title}</p>
        <Badge tone={SEVERITY_BADGE_TONE[announcement.severity]}>{SEVERITY_LABEL[announcement.severity]}</Badge>
      </div>
      <p className="mt-1 text-sm text-foreground/70">{announcement.body}</p>
      <p className="mt-2 text-xs text-foreground/40">
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
      className="flex items-start gap-2.5 rounded-[var(--site-radius)] border border-border bg-surface p-3"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm text-foreground">{notification.message}</p>
        <p className="mt-0.5 text-xs text-foreground/40">
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
    <section data-testid="doctor-portal-feed-card" className="space-y-5 rounded-[var(--site-radius)] border border-border bg-surface p-5">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-foreground/50" aria-hidden="true" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/70">Portal Akışı &amp; Duyurular</h2>
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/50">Yönetim Duyuruları</h3>
            {feed.announcements.length === 0 ? (
              <p data-testid="doctor-portal-feed-announcements-empty" className="text-sm text-foreground/50">
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

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/50">Hızlı Bildirimler</h3>
            {feed.notifications.length === 0 ? (
              <p data-testid="doctor-portal-feed-notifications-empty" className="text-sm text-foreground/50">
                Şu an yeni bir bildirim yok.
              </p>
            ) : (
              <div className="space-y-2">
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
