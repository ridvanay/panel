import { CornerUpLeft } from "lucide-react";

/**
 * Üç kanallı fallback göstergesi (design-notes-i18n.md §3) — bir alan varsayılan dilden
 * geliyorsa (override yok) editör bunu gözle ayırt edebilmeli. Renk TEK BAŞINA sinyal DEĞİLDİR:
 * Kanal 1 (border stili, çağıran tarafından `FALLBACK_FIELD_CLASSES` ile uygulanır),
 * Kanal 2 (bu rozet: ikon + etiket), Kanal 3 (zemin tonu, `FALLBACK_FIELD_CLASSES`).
 */
export function LocaleFallbackBadge({ defaultLabel }: { defaultLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-foreground/25 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-foreground/60">
      <CornerUpLeft className="h-3 w-3" aria-hidden="true" />
      Varsayılan dilden ({defaultLabel})
    </span>
  );
}

/**
 * Input/textarea'nın kendisine koşullu eklenecek sınıflar — "boş" (standart) ile "fallback"
 * (kesikli + tonlu) durumları görsel olarak birbirinden AYRIK tutulur (design-notes-i18n.md §3).
 * Nötr `border-foreground/25` kullanılır — `--danger`/`--warning` DEĞİL, bu bir "eksik/hata"
 * değil "bilgi" durumudur.
 */
export const FALLBACK_FIELD_CLASSES = "border-dashed border-foreground/25 bg-muted/30";
