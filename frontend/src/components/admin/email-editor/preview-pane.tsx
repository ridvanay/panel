import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** design-notes §A.5 — 640px (masaüstü) / 375px (mobil), tablet YOK. */
const EMAIL_PREVIEW_WIDTH = { desktop: "640px", mobile: "375px" } as const;

type PreviewDevice = keyof typeof EMAIL_PREVIEW_WIDTH;

export function EmailPreviewPane({
  subject,
  html,
  loading,
}: {
  subject: string;
  html: string | null;
  loading: boolean;
}) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-foreground/50 uppercase">Önizleme</span>
        <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
          <Button
            type="button"
            size="icon-xs"
            variant={device === "desktop" ? "secondary" : "ghost"}
            aria-pressed={device === "desktop"}
            aria-label="Masaüstü önizleme"
            onClick={() => setDevice("desktop")}
          >
            <Monitor className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant={device === "mobile" ? "secondary" : "ghost"}
            aria-pressed={device === "mobile"}
            aria-label="Mobil önizleme"
            onClick={() => setDevice("mobile")}
          >
            <Smartphone className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div
        className="mx-auto overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-300 ease-in-out"
        style={{ maxWidth: EMAIL_PREVIEW_WIDTH[device] }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-surface-muted px-4 py-2">
          <p className={cn("truncate text-sm font-medium text-foreground", !subject && "text-foreground/40")}>
            {subject ? `Konu: ${subject}` : "Konu satırı girilmedi"}
          </p>
          {loading && <Spinner className="h-3.5 w-3.5 shrink-0 text-foreground/40" />}
        </div>
        <iframe
          sandbox=""
          srcDoc={html ?? ""}
          title="E-posta önizlemesi"
          className="h-[70vh] min-h-[420px] w-full border-0 bg-white"
        />
      </div>
    </div>
  );
}
