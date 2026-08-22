import type { ContentBlock } from "@/lib/page-builder/types";
import { HeroBlockEditor } from "./blocks/hero-block";
import { TextBlockEditor } from "./blocks/text-block";
import { ImageBlockEditor } from "./blocks/image-block";
import { GalleryBlockEditor } from "./blocks/gallery-block";
import { CtaBlockEditor } from "./blocks/cta-block";
import { FeaturedProductsBlockEditor } from "./blocks/featured-products-block";
import { FeaturedPortfolioBlockEditor } from "./blocks/featured-portfolio-block";
import { HeadingBlockEditor } from "./blocks/heading-block";
import { ButtonBlockEditor } from "./blocks/button-block";
import { IconBoxBlockEditor } from "./blocks/icon-box-block";
import { VideoBlockEditor } from "./blocks/video-block";
import { AccordionBlockEditor } from "./blocks/accordion-block";
import { TabsBlockEditor } from "./blocks/tabs-block";
import { CounterBlockEditor } from "./blocks/counter-block";
import { TestimonialBlockEditor } from "./blocks/testimonial-block";
import { PricingTableBlockEditor } from "./blocks/pricing-table-block";
import { LatestPostsBlockEditor } from "./blocks/latest-posts-block";
import { ContactFormBlockEditor } from "./blocks/contact-form-block";
import { BeforeAfterSliderBlockEditor } from "./blocks/before-after-slider-block";
import { LogoMarqueeBlockEditor } from "./blocks/logo-marquee-block";
import { SkillBarBlockEditor } from "./blocks/skill-bar-block";
import { TeamBlockEditor } from "./blocks/team-block";

/**
 * design-notes-page-builder-standard-mode.md §2.6 — `ContentBlockBody`'nin (builder-canvas.tsx)
 * sade-mod ikizi. AYNI switch iskeleti, ama yalnızca §2.5 tablosundaki tipleri kapsar (`divider`/
 * `custom-html` bu bileşene hiç ULAŞMAZ — `TemplateEditorView` §2.4 algoritmasında zaten elenir,
 * `container` da bir "blok" değildir). Reuse edilen editörlere `simple` iletilir (§2.5 tablo B).
 *
 * `ContentBlockBody`'nin KENDİSİ `simple` prop'u ALMAZ — bkz. gerekçe: (a) `ContentBlockBody`
 * gelişmiş moddaki TÜM tipleri kapsar, bu bileşen yalnızca §2.5 alt kümesini; (b) iki farklı
 * tüketici (`ContentBlockCard` vs `TemplateEditorView`) farklı `default` davranışı taşır.
 */
export function TemplateBlockFields({
  block,
  onChange,
}: {
  block: ContentBlock;
  onChange: (block: ContentBlock) => void;
}) {
  switch (block.type) {
    // §2.5 tablo A — zaten %100 izinli, DEĞİŞMEDEN reuse edilir.
    case "hero":
      return <HeroBlockEditor block={block} onChange={onChange} />;
    case "text":
      return <TextBlockEditor block={block} onChange={onChange} />;
    case "team":
      return <TeamBlockEditor block={block} onChange={onChange} />;
    case "pricing-table":
      return <PricingTableBlockEditor block={block} onChange={onChange} />;
    case "contact-form":
      return <ContactFormBlockEditor block={block} onChange={onChange} />;
    case "counter":
      return <CounterBlockEditor block={block} onChange={onChange} />;
    case "testimonial":
      return <TestimonialBlockEditor block={block} onChange={onChange} />;
    case "skill-bar":
      return <SkillBarBlockEditor block={block} onChange={onChange} />;

    // §2.5 tablo B — kısmen izinli, `simple` prop'uyla yasak alanlar gizlenir.
    case "image":
      return <ImageBlockEditor block={block} onChange={onChange} simple />;
    case "heading":
      return <HeadingBlockEditor block={block} onChange={onChange} simple />;
    case "button":
      return <ButtonBlockEditor block={block} onChange={onChange} simple />;
    case "cta":
      return <CtaBlockEditor block={block} onChange={onChange} simple />;
    case "icon-box":
      return <IconBoxBlockEditor block={block} onChange={onChange} simple />;
    case "gallery":
      return <GalleryBlockEditor block={block} onChange={onChange} simple />;
    case "accordion":
      return <AccordionBlockEditor block={block} onChange={onChange} simple />;
    case "tabs":
      return <TabsBlockEditor block={block} onChange={onChange} simple />;
    case "video":
      return <VideoBlockEditor block={block} onChange={onChange} simple />;
    case "before-after-slider":
      return <BeforeAfterSliderBlockEditor block={block} onChange={onChange} simple />;
    case "logo-marquee":
      return <LogoMarqueeBlockEditor block={block} onChange={onChange} simple />;
    case "latest-posts":
      return <LatestPostsBlockEditor block={block} onChange={onChange} simple />;
    case "featured-products":
      return <FeaturedProductsBlockEditor block={block} onChange={onChange} simple />;
    case "featured-portfolio":
      return <FeaturedPortfolioBlockEditor block={block} onChange={onChange} simple />;

    // `divider`/`custom-html` buraya asla ULAŞMAZ (§2.4'te elenir) — savunma amaçlı.
    default:
      return null;
  }
}
