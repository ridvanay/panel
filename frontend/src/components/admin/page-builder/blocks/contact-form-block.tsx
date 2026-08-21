import Link from "next/link";
import { Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ContactFormBlock } from "@/lib/page-builder/types";

export function ContactFormBlockEditor({ block, onChange }: { block: ContactFormBlock; onChange: (block: ContactFormBlock) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1.5 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-foreground/70">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Bu blok, site genelindeki TEK iletişim formunu buraya gömer. Alanları, KVKK onay metnini
          ve bildirim e-postasını değiştirmek için{" "}
          <Link href="/admin/contact" className="font-medium underline underline-offset-2">
            İletişim
          </Link>{" "}
          ekranına gidin.
        </span>
      </div>
      <div className="flex items-center justify-between">
        <label htmlFor={`${block.id}-show-title`} className="text-sm font-medium text-foreground">
          Form başlığını/açıklamasını göster
        </label>
        <Switch
          id={`${block.id}-show-title`}
          checked={block.data.showTitle}
          onCheckedChange={(showTitle) => onChange({ ...block, data: { ...block.data, showTitle } })}
        />
      </div>
    </div>
  );
}
