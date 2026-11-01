import { createElement } from "react";
import { SafeImage } from "@/components/site/safe-image";
import { specialtyIconFor, specialtyToneFor } from "@/lib/blog/specialty-icon";
import { cn } from "@/lib/utils";

/**
 * Paket Z1 — yazı kapağı. Görsel varsa SafeImage (WebP + `toPublicMediaUrl`); yoksa ŞABLON KAPAK: site renk
 * tokenlarıyla nötr bir zemin ve uzmanlığa özgü lucide ikonu (bilinmeyen uzmanlık: Stethoscope). Şablon kapak
 * dekoratiftir (`aria-hidden`); görsel yazının başlığı zaten metin olarak yanındadır.
 * Kapsayıcı `relative` ve en-boy oranı çağıranın `className`'idir.
 */
export function BlogCover({
  src,
  specialtySlug,
  label,
  sizes,
  priority = false,
  className,
  large = false,
}: {
  src: string | null;
  specialtySlug?: string | null;
  /** Şablon kapakta görünen küçük etiket (genelde uzmanlık adı ya da "Health guide"). */
  label?: string | null;
  sizes: string;
  priority?: boolean;
  className?: string;
  large?: boolean;
}) {
  if (src) {
    return (
      <span className={cn("relative block overflow-hidden bg-[var(--site-primary)]/10", className)}>
        <SafeImage src={src} alt="" fill sizes={sizes} priority={priority} className="object-cover" />
      </span>
    );
  }
  return (
    <span
      className={cn("relative flex flex-col items-center justify-center gap-2 overflow-hidden", specialtyToneFor(specialtySlug).soft, className)}
      data-testid="blog-cover-template"
      aria-hidden="true"
    >
      <span className="pointer-events-none absolute -end-6 -top-6 h-28 w-28 rounded-full bg-current opacity-10" />
      <span className="pointer-events-none absolute -bottom-8 -start-8 h-32 w-32 rounded-full bg-current opacity-5" />
      {createElement(specialtyIconFor(specialtySlug), { className: cn("relative", large ? "h-16 w-16" : "h-10 w-10"), strokeWidth: 1.5 })}
      {label ? <span className="relative max-w-[80%] truncate text-xs font-medium uppercase tracking-wide">{label}</span> : null}
    </span>
  );
}
