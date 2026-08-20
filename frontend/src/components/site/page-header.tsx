import type { PageHeaderStyle } from "@/lib/api/types";

interface PageHeaderProps {
  title: string;
  style: PageHeaderStyle;
  backgroundColor: string | null;
  backgroundUrl: string | null;
  overlayOpacity: number;
  /** Çağıran sayfanın kendi konteyner genişliğiyle eşleşsin diye override edilebilir (PLAIN modda kullanılır). */
  containerClassName?: string;
}

const DEFAULT_CONTAINER_CLASS_NAME = "mx-auto max-w-3xl px-4 sm:px-6";

/**
 * §10.12.4 render sözleşmesi — `BANNER` modu full-bleed'dir (dış konteynerin `max-w-*`
 * sınırlamasından bağımsız), bu yüzden çağıran sayfa bunu kendi `<article>`/`<div>`
 * konteynerinin DIŞINDA render etmelidir.
 */
export function PageHeader({
  title,
  style,
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
        <h1 className="relative text-3xl font-bold text-white drop-shadow-sm sm:text-4xl">{title}</h1>
      </div>
    </div>
  );
}
