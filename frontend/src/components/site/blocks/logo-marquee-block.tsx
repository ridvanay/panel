import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { BlockChrome, LogoMarqueeBlock, LogoMarqueeItem } from "@/lib/page-builder/types";

/**
 * `grayscale` açık/kapalı görsel davranışı — ui-designer §3.2 (BAĞLAYICI). `grayscale ?? true`
 * bugünkü hard-code davranışla BİREBİR aynı (mimar §1.2/R1 — `?? false` YASAK).
 */
const GRAYSCALE_CLASS: Record<"true" | "false", string> = {
  true: "grayscale hover:grayscale-0 transition-all",
  false: "opacity-90 hover:opacity-100 transition-opacity",
};

function LogoItem({ item, grayscale }: { item: LogoMarqueeItem; grayscale: boolean }) {
  const grayscaleClass = GRAYSCALE_CLASS[grayscale ? "true" : "false"];
  // eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe
  const img = <img src={item.url} alt={item.alt} className={cn("h-10 w-auto object-contain", grayscaleClass)} />;
  return item.href ? (
    <a href={item.href} target="_blank" rel="noreferrer noopener" className="shrink-0">
      {img}
    </a>
  ) : (
    <span className="shrink-0">{img}</span>
  );
}

/**
 * Kesintisiz akış — içerik İKİ KEZ art arda render edilir, `pb-marquee-track` (bkz.
 * `globals.css`) tam olarak İLK kopyanın genişliği kadar (`-50%`) kayarak döngü noktasında
 * görünmez bir "dikiş" bırakır. İkinci kopya `aria-hidden` — ekran okuyucu logoları İKİ KEZ
 * duyurmaz. Saf CSS animasyon — JS/kütüphane YOK ("hafif tut").
 */
function MarqueeLayout({ items, speedSeconds, pauseOnHover, grayscale }: { items: LogoMarqueeItem[]; speedSeconds: number; pauseOnHover: boolean; grayscale: boolean }) {
  const trackStyle = { "--pb-marquee-duration": `${speedSeconds}s` } as CSSProperties;

  return (
    <div className="group mx-auto max-w-5xl overflow-hidden">
      <div
        className={cn("pb-marquee-track flex w-max items-center gap-12", pauseOnHover && "group-hover:[animation-play-state:paused]")}
        style={trackStyle}
      >
        <div className="flex shrink-0 items-center gap-12" aria-hidden={false}>
          {items.map((item) => (
            <LogoItem key={item.id} item={item} grayscale={grayscale} />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-12" aria-hidden="true">
          {items.map((item) => (
            <LogoItem key={`${item.id}-dup`} item={item} grayscale={grayscale} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** `displayMode: "grid"` — ui-designer §3.1 sabit responsive kırılım tablosu (logo sayısından
 *  BAĞIMSIZ, ekran genişliğine göre kırılır). */
function GridLayout({ items, grayscale }: { items: LogoMarqueeItem[]; grayscale: boolean }) {
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-2 items-center justify-items-center gap-8 sm:grid-cols-3 sm:gap-10 md:grid-cols-4 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.id} className="flex h-14 w-full items-center justify-center">
          <LogoItem item={item} grayscale={grayscale} />
        </div>
      ))}
    </div>
  );
}

export function LogoMarqueeBlockView({ block, chrome }: { block: LogoMarqueeBlock; chrome: BlockChrome }) {
  const { items, speedSeconds, pauseOnHover } = block.data;
  if (items.length === 0) return null;

  const displayMode = block.data.displayMode ?? "marquee";
  const grayscale = block.data.grayscale ?? true;

  return (
    <section className={cn(chrome === "page" && "px-4 py-10 sm:px-6")}>
      {displayMode === "grid" ? (
        <GridLayout items={items} grayscale={grayscale} />
      ) : (
        <MarqueeLayout items={items} speedSeconds={speedSeconds} pauseOnHover={pauseOnHover} grayscale={grayscale} />
      )}
    </section>
  );
}
