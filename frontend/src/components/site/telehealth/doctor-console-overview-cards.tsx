import { CalendarClock, CircleCheck, Info, Paperclip, Users } from "lucide-react";
import type { DoctorConsoleOverview } from "@/lib/api/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/**
 * `.claude/design-notes-doctor-portfolio-console.md` §3.2 — dört metrik kartı, [TDN] §13.5.1'in
 * kararını (admin `StatCard` KULLANILMAZ — glow/`--foreground` ihlali) BURADA DA uygular.
 * `GET /doctor/overview` TEK kaynaktır ([DPI] §3.1); istemci hiçbir sayıyı türetmez.
 *
 * ui-designer inceltme turu (2026-09-14) — her kart, `Badge`'in "soft" ton sınıflarıyla AYNI
 * (`bg-{tone}/10 text-{tone}`) bir ikon rozeti kullanır; yeni bir renk İCAT EDİLMEDİ, sadece
 * `Badge` bileşeninin zaten ürettiği ton paleti ikon konteynerine taşındı. Ton ataması semantik:
 * "Bugünkü Seanslar" (primary — günün odağı), "Tamamlanan Konsültasyonlar" (success — olumlu
 * sonuç), "Bekleyen Tıbbi Belgeler" (warning — dikkat gerektiren aksiyon), "Toplam Hasta" (nötr —
 * bilgi amaçlı, aksiyon gerektirmez).
 */

type IconTone = "primary" | "success" | "warning" | "neutral";

const ICON_TONE_CLASSES: Record<IconTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  neutral: "bg-surface-muted text-foreground/60",
};

interface CardDef {
  label: string;
  icon: typeof CalendarClock;
  value: number;
  tone: IconTone;
  tooltip?: string;
}

function OverviewCard({ label, icon: Icon, value, tone, tooltip }: CardDef) {
  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm">
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-[var(--site-radius)]", ICON_TONE_CLASSES[tone])}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <p className="text-sm text-foreground/60">{label}</p>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger render={<span className="text-foreground/30 hover:text-foreground/50" />}>
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}

export function DoctorConsoleOverviewCards({ overview }: { overview: DoctorConsoleOverview }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <OverviewCard label="Bugünkü Seanslar" icon={CalendarClock} value={overview.today.total} tone="primary" />
      <OverviewCard
        label="Tamamlanan Konsültasyonlar"
        icon={CircleCheck}
        value={overview.completedConsultationTotal}
        tone="success"
      />
      <OverviewCard
        label="Bekleyen Tıbbi Belgeler"
        icon={Paperclip}
        value={overview.pendingDocumentCount}
        tone="warning"
        tooltip="Bu sayı bir tıbbi inceleme onayı değildir; yalnızca belge yüklenmiş ama seansı henüz tamamlanmamış randevu sayısını gösterir."
      />
      <OverviewCard label="Toplam Hasta" icon={Users} value={overview.distinctPatientTotal} tone="neutral" />
    </section>
  );
}
