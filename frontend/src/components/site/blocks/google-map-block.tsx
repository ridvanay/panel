import { cn } from "@/lib/utils";
import { getMapEmbedUrl, MAP_IFRAME_REFERRER_POLICY, MAP_IFRAME_SANDBOX, MAP_STYLE_FILTER } from "@/lib/page-builder/map-embed";
import { GOOGLE_MAP_DEFAULT_HEIGHT_PX, type BlockChrome, type GoogleMapBlock } from "@/lib/page-builder/types";

/**
 * Google Harita bloğu — public render. Sıfır CLS: sarmalayıcı `style={{ height }}` ile ÖNCEDEN
 * rezerve edilir (embed URL hesaplanamasa bile boşluk sabit kalır). Güvenlik nitelikleri
 * (`sandbox`/`referrerPolicy`/`allow` YOKLUĞU) `.claude/security-review-google-map-corporate-blocks.md`
 * §4 BAĞLAYICI kararlarıdır — burada DEĞİŞTİRİLMEZ.
 */
export function GoogleMapBlockView({ block, chrome }: { block: GoogleMapBlock; chrome: BlockChrome }) {
  const { height, mapStyle, markerTitle, address, widthMode } = block.data;
  const embedUrl = getMapEmbedUrl(block.data);
  const resolvedHeight = height ?? { value: GOOGLE_MAP_DEFAULT_HEIGHT_PX, unit: "px" as const };
  const title = markerTitle?.trim() || address?.trim() || "Harita";
  const resolvedWidthMode = widthMode ?? "boxed";
  const isFullWidth = resolvedWidthMode === "full-width";

  if (!embedUrl) return null;

  return (
    <section className={cn(chrome === "page" && (isFullWidth ? "py-8" : "px-4 py-8 sm:px-6"))}>
      <div
        className={cn(
          // `full-width`: viewport'a kenardan kenara dayanan klasik breakout deseni. `boxed`:
          // ortalanmış kuyu, `max-w-3xl` -> `max-w-7xl` görsel genişletmesi (bilinçli, kullanıcı
          // talebi). Mobilde `-mx-[50vw]` nadir yatay taşma riski taşır — kabul edilen trade-off.
          isFullWidth ? "relative left-1/2 right-1/2 -mx-[50vw] w-screen" : "mx-auto max-w-7xl px-4"
        )}
      >
        <div
          className={cn("overflow-hidden", !isFullWidth && "rounded-2xl shadow-lg")}
          style={{ height: `${resolvedHeight.value}${resolvedHeight.unit}` }}
        >
          <iframe
            src={embedUrl}
            title={title}
            loading="lazy"
            referrerPolicy={MAP_IFRAME_REFERRER_POLICY}
            sandbox={MAP_IFRAME_SANDBOX}
            allowFullScreen
            style={{ filter: MAP_STYLE_FILTER[mapStyle ?? "standard"] }}
            className="h-full w-full border-0"
          />
        </div>
      </div>
    </section>
  );
}
