import { localeFlagSrc } from "@/lib/i18n/locale-flags";
import { cn } from "@/lib/utils";

/**
 * Paket M — dil satırındaki küçük dikdörtgen bayrak (4:3). Dekoratiftir (`alt=""`); ekran okuyucu
 * yanındaki dil adını okur. Emoji KULLANILMAZ (Windows'ta harf olarak görünür). Eşlemede olmayan
 * dil için aynı boyutta nötr bir kod rozeti (ör. "PT") çizilir.
 */
export function LocaleFlag({ code, className }: { code: string; className?: string }) {
  const src = localeFlagSrc(code);
  const box = cn("inline-block h-[15px] w-5 shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10", className);
  if (!src) {
    return (
      <span aria-hidden="true" data-testid="locale-flag-code" className={cn(box, "bg-surface-muted text-center text-[9px] font-semibold uppercase leading-[15px] text-foreground/70")}>
        {code.split("-")[0]?.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  // Statik SVG — `next/image` optimizasyonu SVG'ye uygulanmaz; düz `<img>` yeterli ve daha hafif.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden="true" width={20} height={15} decoding="async" className={cn(box, "object-cover")} />;
}
