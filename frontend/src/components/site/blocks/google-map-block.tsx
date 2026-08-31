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
  const { height, mapStyle, markerTitle, address } = block.data;
  const embedUrl = getMapEmbedUrl(block.data);
  const resolvedHeight = height ?? { value: GOOGLE_MAP_DEFAULT_HEIGHT_PX, unit: "px" as const };
  const title = markerTitle?.trim() || address?.trim() || "Harita";

  if (!embedUrl) return null;

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <div
        className="mx-auto max-w-3xl overflow-hidden rounded-lg"
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
    </section>
  );
}
