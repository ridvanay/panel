import { CalendarClock, CircleCheck, UserX, Video, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AppointmentStatus } from "@/lib/api/types";

/**
 * `.claude/design-notes-telehealth.md` §13.1 — seans durumu rozeti, `payment-status-badge.tsx`
 * (§12.4) İLE BİREBİR AYNI konvansiyon: `Record<AppointmentStatus, {...}>` + `Badge` primitifi +
 * ikon-metin ikilisi (renk-körü güvenliği, WCAG 1.4.1 — tek başına renge güvenilmez).
 * `Record<AppointmentStatus, ...>` TypeScript'te EXHAUSTIVE olduğundan `NO_SHOW` da BURADA
 * tanımlanır (görev tanımı yalnızca ilk dördünü istese de bu bir derleme zorunluluğudur).
 */
const CONFIG: Record<AppointmentStatus, { label: string; tone: "neutral" | "primary" | "success" | "danger"; solid: boolean; Icon: typeof CircleCheck }> = {
  SCHEDULED: { label: "Planlandı", tone: "neutral", solid: false, Icon: CalendarClock },
  IN_PROGRESS: { label: "Devam Ediyor", tone: "primary", solid: true, Icon: Video },
  COMPLETED: { label: "Tamamlandı", tone: "success", solid: true, Icon: CircleCheck },
  CANCELLED: { label: "İptal Edildi", tone: "danger", solid: true, Icon: XCircle },
  NO_SHOW: { label: "Hasta Gelmedi", tone: "danger", solid: false, Icon: UserX },
};

export function AppointmentStatusBadge({ status, size = "sm" }: { status: AppointmentStatus; size?: "sm" | "lg" }) {
  const { label, tone, solid, Icon } = CONFIG[status];
  return (
    <Badge tone={tone} solid={solid} size={size} className="gap-1">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}
