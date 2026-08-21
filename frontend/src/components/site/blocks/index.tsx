import { Fragment } from "react";
import type { BlockChrome, PageNode } from "@/lib/page-builder/types";
import { ScrollReveal } from "./scroll-reveal";
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
import { VideoBlockView } from "./video-block";
import { AccordionBlockView } from "./accordion-block";
import { TabsBlockView } from "./tabs-block";
import { CounterBlockView } from "./counter-block";
import { TestimonialBlockView } from "./testimonial-block";
import { PricingTableBlockView } from "./pricing-table-block";
import { LatestPostsBlockView } from "./latest-posts-block";
import { ContactFormBlockView } from "./contact-form-block";
import { CustomHtmlBlockView } from "./custom-html-block";
import { BeforeAfterSliderBlockView } from "./before-after-slider-block";
import { LogoMarqueeBlockView } from "./logo-marquee-block";
import { SkillBarBlockView } from "./skill-bar-block";
import { TeamBlockView } from "./team-block";

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
function renderNodeBody(node: PageNode, chrome: BlockChrome) {
  switch (node.type) {
    case "hero":
      return <HeroBlockView block={node} chrome={chrome} />;
    case "text":
      return <TextBlockView block={node} chrome={chrome} />;
    case "image":
      return <ImageBlockView block={node} chrome={chrome} />;
    case "gallery":
      return <GalleryBlockView block={node} chrome={chrome} />;
    case "cta":
      return <CtaBlockView block={node} chrome={chrome} />;
    case "featured-products":
      return <FeaturedProductsBlockView block={node} chrome={chrome} />;
    case "featured-portfolio":
      return <FeaturedPortfolioBlockView block={node} chrome={chrome} />;
    case "heading":
      return <HeadingBlockView block={node} chrome={chrome} />;
    case "button":
      return <ButtonBlockView block={node} chrome={chrome} />;
    case "icon-box":
      return <IconBoxBlockView block={node} chrome={chrome} />;
    case "divider":
      return <DividerBlockView block={node} chrome={chrome} />;
    case "video":
      return <VideoBlockView block={node} chrome={chrome} />;
    case "accordion":
      return <AccordionBlockView block={node} chrome={chrome} />;
    case "tabs":
      return <TabsBlockView block={node} chrome={chrome} />;
    case "counter":
      return <CounterBlockView block={node} chrome={chrome} />;
    case "testimonial":
      return <TestimonialBlockView block={node} chrome={chrome} />;
    case "pricing-table":
      return <PricingTableBlockView block={node} chrome={chrome} />;
    case "latest-posts":
      return <LatestPostsBlockView block={node} chrome={chrome} />;
    case "contact-form":
      return <ContactFormBlockView block={node} chrome={chrome} />;
    case "custom-html":
      return <CustomHtmlBlockView block={node} chrome={chrome} />;
    case "before-after-slider":
      return <BeforeAfterSliderBlockView block={node} chrome={chrome} />;
    case "logo-marquee":
      return <LogoMarqueeBlockView block={node} chrome={chrome} />;
    case "skill-bar":
      return <SkillBarBlockView block={node} chrome={chrome} />;
    case "team":
      return <TeamBlockView block={node} chrome={chrome} />;
    case "container":
      return <ContainerBlockView block={node} />;
    default:
      return null;
  }
}

export function BlockRenderer({ nodes, chrome }: { nodes: PageNode[]; chrome: BlockChrome }) {
  return (
    <>
      {nodes.map((node) => {
        const body = renderNodeBody(node, chrome);
        if (body === null) return null;

        // Giriş Animasyonu (Scroll Reveal) — `node.reveal` VARSA ve `effect !== "none"` ise,
        // render edilen elemanı `ScrollReveal` ile sarar (§Yapılacaklar/5 orkestratör talimatı).
        // `container` çocuğuysa (`row` yönlü bir ebeveynde) kendi `widthFr` flex-grow oranı
        // sarmalayıcıya AYNEN devredilir — aksi halde asıl flex item bu sarmalayıcı olur ve
        // `ContainerBlockView`nin kendi `flex` stili artık bir flex bağlamı taşımayan bir kutunun
        // İÇİNDE anlamsızlaşır, satır içi genişlik oranı bozulur (bkz. `scroll-reveal.tsx`).
        if (node.reveal && node.reveal.effect !== "none") {
          const flexStyle = node.type === "container" && node.settings.widthFr ? { flex: `${node.settings.widthFr} 1 0%` } : undefined;
          return (
            <ScrollReveal key={node.id} effect={node.reveal.effect} delayMs={node.reveal.delayMs} style={flexStyle}>
              {body}
            </ScrollReveal>
          );
        }

        // Reveal YOKSA sıfır DOM/layout etkisi — `Fragment` gerçek bir kutu ÜRETMEZ (`span` +
        // `display: contents`ten daha güvenli, hiçbir seçici/erişilebilirlik ağacı düğümü eklemez).
        return <Fragment key={node.id}>{body}</Fragment>;
      })}
    </>
  );
}
