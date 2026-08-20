import type { BlockChrome, PageNode } from "@/lib/page-builder/types";
import { HeroBlockView } from "./hero-block";
import { TextBlockView } from "./text-block";
import { ImageBlockView } from "./image-block";
import { GalleryBlockView } from "./gallery-block";
import { CtaBlockView } from "./cta-block";
import { FeaturedProductsBlockView } from "./featured-products-block";
import { FeaturedPortfolioBlockView } from "./featured-portfolio-block";
import { ContainerBlockView } from "./container-block";
import { HeadingBlockView } from "./heading-block";
import { ButtonBlockView } from "./button-block";
import { IconBoxBlockView } from "./icon-box-block";
import { DividerBlockView } from "./divider-block";

/**
 * §6.3 mimar dokümanı — "chrome" sözleşmesi. Kök dizideki yaprak bloklar `chrome: "page"`
 * (bugünkü davranış BİREBİR korunur — kendi `mx-auto max-w-*`/`px-*`/`py-*` gutter'larını
 * taşırlar). Bir `container`'ın İÇİNDEKİ yaprak bloklar `chrome: "bare"` — kendi dış
 * gutter'larını BIRAKIRLAR, boşluk konteynerin `padding`/`gap`'inden gelir.
 *
 * `container` düğümleri kendi `chrome` sözleşmesine tabi DEĞİLDİR (yalnızca içerik bloklarının
 * dış boşluğu bu prop'a bakar) — `ContainerBlockView` kendi çocuklarını her zaman
 * `chrome="bare"` ile render eder (bkz. `container-block.tsx`).
 *
 * Bilinmeyen/tanınmayan `type` → sessizce `null` (ileri uyumluluk — `normalizePageNodes` bu
 * düğümleri OLDUĞU GİBİ geçirir, burada güvenle atlanır).
 */
export function BlockRenderer({ nodes, chrome }: { nodes: PageNode[]; chrome: BlockChrome }) {
  return (
    <>
      {nodes.map((node) => {
        switch (node.type) {
          case "hero":
            return <HeroBlockView key={node.id} block={node} chrome={chrome} />;
          case "text":
            return <TextBlockView key={node.id} block={node} chrome={chrome} />;
          case "image":
            return <ImageBlockView key={node.id} block={node} chrome={chrome} />;
          case "gallery":
            return <GalleryBlockView key={node.id} block={node} chrome={chrome} />;
          case "cta":
            return <CtaBlockView key={node.id} block={node} chrome={chrome} />;
          case "featured-products":
            return <FeaturedProductsBlockView key={node.id} block={node} chrome={chrome} />;
          case "featured-portfolio":
            return <FeaturedPortfolioBlockView key={node.id} block={node} chrome={chrome} />;
          case "heading":
            return <HeadingBlockView key={node.id} block={node} chrome={chrome} />;
          case "button":
            return <ButtonBlockView key={node.id} block={node} chrome={chrome} />;
          case "icon-box":
            return <IconBoxBlockView key={node.id} block={node} chrome={chrome} />;
          case "divider":
            return <DividerBlockView key={node.id} block={node} chrome={chrome} />;
          case "container":
            return <ContainerBlockView key={node.id} block={node} />;
          default:
            return null;
        }
      })}
    </>
  );
}
