import { CalendarClock, CircleCheck, Info, Paperclip, Users } from "lucide-react";
import type { DoctorConsoleOverview } from "@/lib/api/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * `.claude/design-notes-doctor-portfolio-console.md` §3.2 — dört metrik kartı, [TDN] §13.5.1'in
 * kararını (admin `StatCard` KULLANILMAZ — glow/`--foreground` ihlali) BURADA DA uygular.
 * `GET /doctor/overview` TEK kaynaktır ([DPI] §3.1); istemci hiçbir sayıyı türetmez.
 */

interface CardDef {
  label: string;
  icon: typeof CalendarClock;
  value: number;
  tooltip?: string;
}

function OverviewCard({ label, icon: Icon, value, tooltip }: CardDef) {
  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-foreground/60">
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </div>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger render={<span className="text-foreground/30 hover:text-foreground/50" />}>
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function DoctorConsoleOverviewCards({ overview }: { overview: DoctorConsoleOverview }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <OverviewCard label="Bugünkü Seanslar" icon={CalendarClock} value={overview.today.total} />
      <OverviewCard label="Tamamlanan Konsültasyonlar" icon={CircleCheck} value={overview.completedConsultationTotal} />
      <OverviewCard label="Toplam Hasta" icon={Users} value={overview.distinctPatientTotal} />
      <OverviewCard
        label="Bekleyen Tıbbi Belgeler"
        icon={Paperclip}
        value={overview.pendingDocumentCount}
        tooltip="Bu sayı bir tıbbi inceleme onayı değildir; yalnızca belge yüklenmiş ama seansı henüz tamamlanmamış randevu sayısını gösterir."
      />
    </section>
  );
}
