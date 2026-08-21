import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { BlockChrome, LogoMarqueeBlock, LogoMarqueeItem } from "@/lib/page-builder/types";

function LogoItem({ item }: { item: LogoMarqueeItem }) {
  // eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe
  const img = <img src={item.url} alt={item.alt} className="h-10 w-auto object-contain grayscale transition-all hover:grayscale-0" />;
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
export function LogoMarqueeBlockView({ block, chrome }: { block: LogoMarqueeBlock; chrome: BlockChrome }) {
  const { items, speedSeconds, pauseOnHover } = block.data;
  if (items.length === 0) return null;

  const trackStyle = { "--pb-marquee-duration": `${speedSeconds}s` } as CSSProperties;

  return (
    <section className={cn(chrome === "page" && "px-4 py-10 sm:px-6")}>
      <div className="group mx-auto max-w-5xl overflow-hidden">
        <div
          className={cn("pb-marquee-track flex w-max items-center gap-12", pauseOnHover && "group-hover:[animation-play-state:paused]")}
          style={trackStyle}
        >
          <div className="flex shrink-0 items-center gap-12" aria-hidden={false}>
            {items.map((item) => (
              <LogoItem key={item.id} item={item} />
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-12" aria-hidden="true">
            {items.map((item) => (
              <LogoItem key={`${item.id}-dup`} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
