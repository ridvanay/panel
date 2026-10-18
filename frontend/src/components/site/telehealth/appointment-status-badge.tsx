"use client";

import { CalendarClock, CircleCheck, Clock, UserX, Video, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AppointmentStatus } from "@/lib/api/types";
import { usePortalStrings } from "@/lib/i18n/use-portal-strings";

/**
 * `.claude/design-notes-telehealth.md` §13.1 — seans durumu rozeti, `payment-status-badge.tsx`
 * (§12.4) İLE BİREBİR AYNI konvansiyon: `Record<AppointmentStatus, {...}>` + `Badge` primitifi +
 * ikon-metin ikilisi (renk-körü güvenliği, WCAG 1.4.1 — tek başına renge güvenilmez).
 * `Record<AppointmentStatus, ...>` TypeScript'te EXHAUSTIVE olduğundan `NO_SHOW`/`PENDING_PAYMENT`
 * da BURADA tanımlanır (görev tanımı yalnızca ilk dördünü istese de bu bir derleme zorunluluğudur —
 * `PENDING_PAYMENT` daha önce buradan EKSİKTİ, `CONFIG[status]` `undefined` dönüp `/doctor`
 * randevu listesini çökertiyordu, qa-agent'ın Adım 4 e2e doğrulamasında bulundu).
 */
const CONFIG: Record<AppointmentStatus | "ENDED", { tone: "neutral" | "primary" | "success" | "danger"; solid: boolean; Icon: typeof CircleCheck }> = {
  PENDING_PAYMENT: { tone: "neutral", solid: false, Icon: Clock },
  SCHEDULED: { tone: "neutral", solid: false, Icon: CalendarClock },
  IN_PROGRESS: { tone: "primary", solid: true, Icon: Video },
  COMPLETED: { tone: "success", solid: true, Icon: CircleCheck },
  CANCELLED: { tone: "danger", solid: true, Icon: XCircle },
  NO_SHOW: { tone: "danger", solid: false, Icon: UserX },
  ENDED: { tone: "neutral", solid: false, Icon: CircleCheck },
};

/**
 * Paket A2 (2026-10-18) — güvenlik ağı: otomatik kapatma görevi (`appointment-auto-close.ts`)
 * henüz çalışmamışsa durum DB'de `IN_PROGRESS` kalabilir. Çağıran `getJoinState(...) === "ended"`
 * bilgisini `ended` ile verirse rozet "Devam Ediyor" yerine "Sona erdi" gösterir. Hasta paneli,
 * doktor konsolu ve admin listesi aynı kuralı bu bileşen üzerinden kullanır.
 */
export function resolveDisplayedAppointmentStatus(status: AppointmentStatus, ended: boolean): AppointmentStatus | "ENDED" {
  return status === "IN_PROGRESS" && ended ? "ENDED" : status;
}

export function AppointmentStatusBadge({ status, size = "sm", ended = false }: { status: AppointmentStatus; size?: "sm" | "lg"; ended?: boolean }) {
  const { t } = usePortalStrings();
  const displayed = resolveDisplayedAppointmentStatus(status, ended);
  const { tone, solid, Icon } = CONFIG[displayed];
  return (
    <Badge tone={tone} solid={solid} size={size} className="gap-1">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t.appointmentStatus[displayed]}
    </Badge>
  );
}
