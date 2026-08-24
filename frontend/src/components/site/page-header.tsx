import { Image as ImageIcon } from "lucide-react";
import type { PageHeaderLayout, PageHeaderStyle } from "@/lib/api/types";

interface PageHeaderProps {
  title: string;
  style: PageHeaderStyle;
  /** Sadece `style: "BANNER"` iken anlamlı — design-notes-appearance-studio.md §4. */
  layout?: PageHeaderLayout;
  backgroundColor: string | null;
  backgroundUrl: string | null;
  overlayOpacity: number;
  /** Çağıran sayfanın kendi konteyner genişliğiyle eşleşsin diye override edilebilir (PLAIN modda kullanılır). */
  containerClassName?: string;
}

const DEFAULT_CONTAINER_CLASS_NAME = "mx-auto max-w-3xl px-4 sm:px-6";

/**
 * design-notes-appearance-polish.md §1 — okunabilirlik pill'i, banner görseli üzerine binen `overlay`
 * katmanından (aşağıda, `opacity` ile ayarlanabilir) BAĞIMSIZ EK bir garanti: overlay %0 olsa bile
 * başlık metni okunur kalır. `CENTERED` ve `LEFT_OVERLAY` — ikisi de görsel üzerine beyaz metin koyan
 * şablonlar — bu pill'i kullanır; `MINIMAL_LINE`/`SPLIT` normal sayfa metin rengini kullandığı için
 * (görsel üzerine binmediği için) pill GEREKMEZ.
 */
function ReadabilityPill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`relative inline-block rounded-md bg-black/60 px-3 py-1 backdrop-blur-sm ${className}`}>
      {children}
    </span>
  );
}

/**
 * §10.12.4 render sözleşmesi — `BANNER` modu full-bleed'dir (dış konteynerin `max-w-*`
 * sınırlamasından bağımsız), bu yüzden çağıran sayfa bunu kendi `<article>`/`<div>`
 * konteynerinin DIŞINDA render etmelidir.
 *
 * design-notes-appearance-studio.md §4 — `layout` (`CENTERED`/`LEFT_OVERLAY`/`MINIMAL_LINE`/`SPLIT`)
 * SADECE `style: "BANNER"` iken etkilidir; `layout` verilmezse (eski çağrı yerleri/varsayılan) `CENTERED`
 * davranışına düşer — bu, alanın eklenmeden önceki tek davranışla birebir eşleşir (regresyon YOK).
 */
export function PageHeader({
  title,
  style,
  layout = "CENTERED",
  backgroundColor,
  backgroundUrl,
  overlayOpacity,
  containerClassName = DEFAULT_CONTAINER_CLASS_NAME,
}: PageHeaderProps) {
  if (style === "HIDDEN") return null;

  if (style === "PLAIN") {
    return (
      <div className={`${containerClassName} py-8`}>
        <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
      </div>
    );
  }

  // --- BANNER modu — 4 şablon ---

  if (layout === "LEFT_OVERLAY") {
    // §4.2 — sola yaslı, alttan yukarı gradyan overlay (düz opaklık DEĞİL): metin her zaman en
    // koyu bölgede (alt-sol) oturur, görselin üst kısmı daha görünür kalır.
    const ratio = overlayOpacity / 100;
    return (
      <div
        className="relative flex w-full items-end justify-start overflow-hidden py-20 pt-24 pb-10 sm:py-28 sm:pt-32 sm:pb-14"
        style={{
          backgroundColor: backgroundColor ?? undefined,
          backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, rgb(0 0 0 / ${0.8 * ratio}), rgb(0 0 0 / ${0.35 * ratio}) 55%, transparent)`,
          }}
          aria-hidden="true"
        />
        {/* §4.2 — metin bloğu bilinçli olarak `containerClassName`'in KENDİ `max-w-*`'ini KULLANMAZ
            (çağıran sayfaya göre max-w-3xl/4xl/5xl değişir) — LEFT_OVERLAY her zaman `max-w-xl`
            editoryal "hero" ölçeğinde sabit kalır. `mx-auto`/`w-full` BİLİNÇLİ olarak YOK — flex
            ebeveynin `justify-start`'ı ile sola yaslı kalması gerekir, ortalanırsa "sola yaslı" kırılır. */}
        <div className="relative max-w-xl px-4 text-left sm:px-6">
          <ReadabilityPill>
            <h1 className="text-3xl font-bold text-white drop-shadow-md sm:text-5xl">{title}</h1>
          </ReadabilityPill>
        </div>
      </div>
    );
  }

  if (layout === "MINIMAL_LINE") {
    // §4.3 — arka plan görseli/overlay YOK (bilinçli kısıt), normal sayfa zemin/metin rengini kullanır.
    return (
      <div className={`${containerClassName} bg-transparent py-10 sm:py-12`}>
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>
        <span
          className="mt-3 block h-0.5 w-12 rounded-full"
          style={{ backgroundColor: "var(--site-primary)" }}
          aria-hidden="true"
        />
      </div>
    );
  }

  if (layout === "SPLIT") {
    // §4.4 — sol kolon görsel (gerçek <img>, alt="" a11y için), sağ kolon metin. Overlay YOK.
    return (
      <div className="grid w-full grid-cols-1 md:grid-cols-2">
        {backgroundUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- görsel kolonu ARKA PLAN CSS'i DEĞİL, gerçek <img> (task gereksinimi + alt="" a11y).
          <img src={backgroundUrl} alt="" className="h-56 w-full object-cover md:h-full" />
        ) : (
          <div className="flex h-56 w-full items-center justify-center bg-muted md:h-full">
            <ImageIcon className="h-8 w-8 text-foreground/30" aria-hidden="true" />
          </div>
        )}
        <div className="flex flex-col justify-center bg-surface px-6 py-10 sm:px-12 sm:py-16">
          <h1 className="text-left text-3xl font-bold text-foreground sm:text-4xl">{title}</h1>
        </div>
      </div>
    );
  }

  // §4.1 — `CENTERED` (varsayılan, mevcut davranış).
  return (
    <div
      className="relative flex w-full items-center justify-center overflow-hidden py-16 sm:py-20"
      style={{
        backgroundColor: backgroundColor ?? undefined,
        backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black" style={{ opacity: overlayOpacity / 100 }} aria-hidden="true" />
      <div className={`${containerClassName} relative`}>
        <ReadabilityPill>
          <h1 className="relative text-3xl font-bold text-white drop-shadow-sm sm:text-4xl">{title}</h1>
        </ReadabilityPill>
      </div>
    </div>
  );
}
