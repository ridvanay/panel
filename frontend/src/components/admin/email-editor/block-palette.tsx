import { EMAIL_BLOCK_TYPES, emailBlockRegistry } from "@/lib/email-blocks/registry";
import type { EmailBlockType } from "@/lib/api/types";

/**
 * design-notes §A.1 — dikey ikon+etiket liste, tıkla-ekle (palette'ten sürükleme YOK, sıralama
 * tuvalde yapılır). Tıklanınca blok tuvalin SONUNA eklenir ve otomatik seçili hale gelir.
 */
export function EmailBlockPalette({ onAdd }: { onAdd: (type: EmailBlockType) => void }) {
  return (
    <div className="space-y-2">
      <h3 className="admin-h3">Bloklar</h3>
      <div className="flex flex-col gap-1.5">
        {EMAIL_BLOCK_TYPES.map((type) => {
          const meta = emailBlockRegistry[type];
          const Icon = meta.icon;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onAdd(type)}
              className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-surface px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              <Icon className="h-4 w-4 shrink-0 text-foreground/50" />
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
