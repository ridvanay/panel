import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma, type Locale } from "@prisma/client";
import { z } from "zod";
import { DEMO_TEMPLATE_REGISTRY, getDemoTemplate } from "./registry";
import { countNavItemsTotal, type DemoTemplateDefinition } from "./types";
import { resolvePageBlockTokens } from "./lib/asset-tokens";
import { deriveOptionValueSlugs, deriveVariantKey, assertOptionValuesMatchAxes } from "../products/lib/variants";
import { derivePriceColumns } from "../../lib/product-pricing";
import { assertTemplateAssetFilesReadable, materializeTemplateAssets, removeSavedTemplateAssets, type SavedTemplateAsset } from "./lib/assets";
import { PageBlockListSchema } from "../pages/pages.schemas";
import { sanitizePageBlocks } from "../pages/lib/sanitize-blocks";
import { sanitizeRichHtml } from "../../lib/html-sanitize";
import { SlideLayersSchema } from "../sliders/lib/layers";
import {
  TRANSITION_EFFECT_TO_PRISMA,
  HEIGHT_MODE_TO_PRISMA,
  BACKGROUND_TYPE_TO_PRISMA,
  NAVIGATION_THEME_TO_PRISMA,
  WIDTH_MODE_TO_PRISMA,
} from "../sliders/lib/enum-maps";
import { SETTINGS_ID, DEFAULTS as SETTINGS_DEFAULTS } from "../settings/settings.routes";
import { APPEARANCE_ID, DEFAULTS as APPEARANCE_DEFAULTS } from "../appearance/appearance.routes";
import { isModuleEnabled } from "../../lib/module-state";
import { getLocaleSet, syncContentSlugs } from "../../lib/localization";
import { slugify } from "../../lib/slug";
import { logAudit } from "../../lib/audit";
import { triggerPublicPageRevalidation } from "../../lib/revalidate";
import { NotFoundError, ValidationError, DemoTemplateAlreadyImportedError } from "../../lib/errors";
import { absolutizeMediaUrl } from "../../mappers";
import type { ImportDemoTemplateRequest } from "./demo-templates.schemas";
import type { DemoTemplateImportResultDto } from "../../schemas/entities";

/**
 * §5 — iki fazlı, telafili demo şablon "uygula" servisi (bağlayıcı akış). Bu dosya
 * `demo-templates.routes.ts`'in TEK iş mantığı katmanıdır; route handler yalnızca kimlik/hız
 * sınırı/şema doğrulamasını yapar ve bu fonksiyonu çağırır.
 */

const EMPTY_ASSET_MAP = new Map<string, string>();
/** Faz 0 "kuru koşu" — gerçek değerler henüz yok, yalnızca ŞEKLİN Zod'dan geçeceğini kanıtlamak için. */
const PLACEHOLDER_ASSET_URL = "/__demo-template-placeholder__";
const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";
const MAX_TRANSACTION_RETRIES = 2; // §5.2 — Faz 2'de P2002 yakalanırsa yeniden dene (§6.5).

export interface ImportDemoTemplateParams {
  templateKey: string;
  body: ImportDemoTemplateRequest;
  actorId: string;
  actorEmail: string;
  ip?: string | null;
}

function flattenZodIssues(issues: z.ZodIssue[]): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_";
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

async function findAvailableSlug(existsCheck: (candidate: string) => Promise<boolean>, base: string): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let suffix = 2;
  while (await existsCheck(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

interface SlugPlan {
  pageSlug: string;
  sliderSlug: string | null;
  categorySlugByTemplateSlug: Map<string, string>;
  itemSlugByTemplateSlug: Map<string, string>;
  // `.claude/architect-scope-ecommerce-pro-template.md` §4.4 — YENİ (ecommerce-pro genişlemesi).
  // `commerce`/`extraPages` boşsa (`modern-architecture`) bu haritalar boş kalır, DAVRANIŞ DEĞİŞMEZ.
  productCategorySlugByTemplateSlug: Map<string, string>;
  productSlugByTemplateSlug: Map<string, string>;
  extraPageSlugByTemplateSlug: Map<string, string>;
}

/**
 * §6.5 — slug çakışması OTOMATİK benzersizleştirilir (409 DEĞİL). Salt-okunur (yazma YOK) — her
 * çağrı DB'yi TAZE okur, bu yüzden `$transaction` P2002 ile başarısız olursa (gerçek eşzamanlı
 * yarış) TEKRAR çağrılması güncel durumu yansıtır.
 */
async function resolveSlugPlan(app: FastifyInstance, template: DemoTemplateDefinition): Promise<{ plan: SlugPlan; slugWarnings: string[] }> {
  const slugWarnings: string[] = [];

  const pageSlug = await findAvailableSlug(
    async (candidate) => Boolean(await app.prisma.page.findFirst({ where: { slug: candidate }, select: { id: true } })),
    template.page.slug
  );
  if (pageSlug !== slugify(template.page.slug)) {
    slugWarnings.push(`"${slugify(template.page.slug)}" zaten kullanılıyordu, sayfa "${pageSlug}" olarak oluşturuldu.`);
  }

  let sliderSlug: string | null = null;
  if (template.slider) {
    const sliderDef = template.slider;
    sliderSlug = await findAvailableSlug(
      async (candidate) => Boolean(await app.prisma.slider.findFirst({ where: { slug: candidate }, select: { id: true } })),
      sliderDef.slug
    );
    if (sliderSlug !== slugify(sliderDef.slug)) {
      slugWarnings.push(`"${slugify(sliderDef.slug)}" zaten kullanılıyordu, slider "${sliderSlug}" olarak oluşturuldu.`);
    }
  }

  const categorySlugByTemplateSlug = new Map<string, string>();
  for (const cat of template.portfolio.categories) {
    const resolved = await findAvailableSlug(
      async (candidate) => Boolean(await app.prisma.portfolioCategory.findFirst({ where: { slug: candidate }, select: { id: true } })),
      cat.slug
    );
    if (resolved !== slugify(cat.slug)) {
      slugWarnings.push(`"${slugify(cat.slug)}" zaten kullanılıyordu, portföy kategorisi "${resolved}" olarak oluşturuldu.`);
    }
    categorySlugByTemplateSlug.set(cat.slug, resolved);
  }

  const itemSlugByTemplateSlug = new Map<string, string>();
  for (const item of template.portfolio.items) {
    const resolved = await findAvailableSlug(
      async (candidate) => Boolean(await app.prisma.portfolioItem.findFirst({ where: { slug: candidate }, select: { id: true } })),
      item.slug
    );
    if (resolved !== slugify(item.slug)) {
      slugWarnings.push(`"${slugify(item.slug)}" zaten kullanılıyordu, portföy öğesi "${resolved}" olarak oluşturuldu.`);
    }
    itemSlugByTemplateSlug.set(item.slug, resolved);
  }

  // §4.4 — ürün kategorileri/ürünler EKLENİR (mevcut kullanıcı içeriği asla silinmez, §6.5
  // benzersizleştirmesi AYNI desen). `template.commerce === null` ise döngüler hiç çalışmaz.
  const productCategorySlugByTemplateSlug = new Map<string, string>();
  for (const category of template.commerce?.categories ?? []) {
    const resolved = await findAvailableSlug(
      async (candidate) => Boolean(await app.prisma.productCategory.findFirst({ where: { slug: candidate }, select: { id: true } })),
      category.slug
    );
    if (resolved !== slugify(category.slug)) {
      slugWarnings.push(`"${slugify(category.slug)}" zaten kullanılıyordu, ürün kategorisi "${resolved}" olarak oluşturuldu.`);
    }
    productCategorySlugByTemplateSlug.set(category.slug, resolved);
  }

  const productSlugByTemplateSlug = new Map<string, string>();
  for (const product of template.commerce?.products ?? []) {
    const resolved = await findAvailableSlug(
      async (candidate) => Boolean(await app.prisma.product.findFirst({ where: { slug: candidate }, select: { id: true } })),
      product.slug
    );
    if (resolved !== slugify(product.slug)) {
      slugWarnings.push(`"${slugify(product.slug)}" zaten kullanılıyordu, ürün "${resolved}" olarak oluşturuldu.`);
    }
    productSlugByTemplateSlug.set(product.slug, resolved);
  }

  // §4.3 — ek (yasal/kurumsal) sayfalar da `Page` tablosunu paylaşır, ana sayfayla AYNI
  // slug alanı/kuralı (§6.5).
  const extraPageSlugByTemplateSlug = new Map<string, string>();
  for (const extraPage of template.extraPages ?? []) {
    const resolved = await findAvailableSlug(
      async (candidate) => Boolean(await app.prisma.page.findFirst({ where: { slug: candidate }, select: { id: true } })),
      extraPage.slug
    );
    if (resolved !== slugify(extraPage.slug)) {
      slugWarnings.push(`"${slugify(extraPage.slug)}" zaten kullanılıyordu, sayfa "${resolved}" olarak oluşturuldu.`);
    }
    extraPageSlugByTemplateSlug.set(extraPage.slug, resolved);
  }

  return {
    plan: {
      pageSlug,
      sliderSlug,
      categorySlugByTemplateSlug,
      itemSlugByTemplateSlug,
      productCategorySlugByTemplateSlug,
      productSlugByTemplateSlug,
      extraPageSlugByTemplateSlug,
    },
    slugWarnings,
  };
}

interface TransactionOutcome {
  pageId: string;
  pageSlug: string;
  sliderId: string | null;
  previousHomePageId: string | null;
  setAsHomePage: boolean;
  counts: {
    media: number;
    portfolioCategories: number;
    portfolioItems: number;
    navigationItems: number;
    footerColumns: number;
    footerLinks: number;
    socialLinks: number;
    slides: number;
  };
  // §4.4 — ecommerce-pro genişlemesi. `DemoTemplateImportResultSchema`'nın (openapi/§6) parçası
  // DEĞİLDİR — yalnızca audit metadata'sında kullanılır (bkz. `importDemoTemplate` sonu).
  commerceCounts: {
    productCategories: number;
    products: number;
    productVariants: number;
    productDocuments: number;
    extraPages: number;
  };
  // §4.4 — `commerce != null` ise `SiteSettings` kargo alanları ÜZERİNE YAZILIR; eski değerler
  // burada taşınır (audit `metadata.previousShipping`). `commerce === null` ise `null`.
  previousShipping: { shippingFlatFeeCents: number | null; freeShippingThresholdCents: number | null } | null;
}

/** §5.2 Faz 2 — TEK transaction, sıra BAĞLAYICI (2.1 → 2.11). */
async function writeTemplateInTransaction(
  tx: Prisma.TransactionClient,
  template: DemoTemplateDefinition,
  savedAssets: SavedTemplateAsset[],
  assetKeyToMediaId: ReadonlyMap<string, string>,
  assetResolvedBlocks: unknown[],
  plan: SlugPlan,
  enabledLocales: Locale[],
  body: ImportDemoTemplateRequest,
  actorId: string
): Promise<TransactionOutcome> {
  // 2.1 — Faz 1'de kaydedilen dosyalardan gerçek `Media` satırları. id'ler ÖNCEDEN üretildi
  // (crypto.randomUUID()) çünkü `createMany` oluşturulan satırları GERİ DÖNMEZ (Prisma
  // kısıtı) ve bu id'lere aşağıdaki FK alanlarında (coverMediaId/bgMediaId/ref:slider'ın
  // KARDEŞİ olan asset token'ları ZATEN Faz 1'de URL'e çözüldü) ihtiyaç var.
  if (savedAssets.length > 0) {
    await tx.media.createMany({
      data: savedAssets.map((asset) => ({
        id: assetKeyToMediaId.get(asset.key)!,
        path: asset.path,
        url: asset.url,
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        altText: asset.altText,
      })),
    });
  }

  // 2.2 — §7, `SiteAppearance` ÜZERİNE YAZILIR (yalnızca şablonun doldurduğu alt küme).
  await tx.siteAppearance.upsert({
    where: { id: APPEARANCE_ID },
    create: { id: APPEARANCE_ID, ...APPEARANCE_DEFAULTS, ...template.appearance },
    update: { ...template.appearance },
  });

  // 2.3 — §6.2, YALNIZCA bu 5 alan (+ §4.4: `commerce != null` ise 2 kargo alanı, 7'ye çıkar).
  // "Önce" anlık görüntüsü YAZMADAN ÖNCE alınır — `homePageId` bu upsert'te DOKUNULMAZ (2.10'da,
  // koşullu) ve kargo alanları YALNIZCA `template.commerce` doluysa `settingsFields`'e girer;
  // bu yüzden upsert'ten önce/sonra okumak `homePageId` için EŞDEĞERDİR, kargo için ise ÖNCEKİ
  // değeri (audit `metadata.previousShipping`, §4.4) kaybetmemek için ÖNCE okunması ZORUNLUDUR.
  const settingsBeforeHome = await tx.siteSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { homePageId: true, shippingFlatFeeCents: true, freeShippingThresholdCents: true },
  });
  const settingsFields = {
    siteName: template.settings.siteName,
    tagline: template.settings.tagline,
    headerCtaLabel: template.settings.headerCtaLabel,
    headerCtaHref: template.settings.headerCtaHref,
    footerCopyrightText: template.settings.footerCopyrightText,
    ...(template.commerce
      ? {
          shippingFlatFeeCents: template.commerce.shippingFlatFeeCents,
          freeShippingThresholdCents: template.commerce.freeShippingThresholdCents,
        }
      : {}),
  };
  await tx.siteSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...SETTINGS_DEFAULTS, ...settingsFields },
    update: settingsFields,
  });

  // 2.4 — NavigationItem TAMAMEN DEĞİŞTİRİLİR (kök → çocuk sırası ZORUNLU, FK ihlalini önler).
  await tx.navigationItem.deleteMany({});
  let navigationItemCount = 0;
  if (template.navigation.length > 0) {
    const rootIds = template.navigation.map(() => crypto.randomUUID());
    const roots = template.navigation.map((item, index) => ({
      id: rootIds[index]!,
      label: item.label,
      href: item.href,
      order: index,
      parentId: null as string | null,
    }));
    const children: { id: string; label: string; href: string; order: number; parentId: string }[] = [];
    template.navigation.forEach((item, index) => {
      (item.children ?? []).forEach((child, childIndex) => {
        children.push({ id: crypto.randomUUID(), label: child.label, href: child.href, order: childIndex, parentId: rootIds[index]! });
      });
    });
    await tx.navigationItem.createMany({ data: [...roots, ...children] });
    navigationItemCount = roots.length + children.length;
  }

  // 2.5 — FooterColumn + FooterLink TAMAMEN DEĞİŞTİRİLİR. Kolon silmek Cascade ile linkleri de siler.
  await tx.footerColumn.deleteMany({});
  let footerLinkCount = 0;
  for (let i = 0; i < template.footer.columns.length; i++) {
    const column = template.footer.columns[i]!;
    await tx.footerColumn.create({
      data: {
        title: column.title,
        order: i,
        links: { create: column.links.map((link, linkIndex) => ({ label: link.label, href: link.href, order: linkIndex })) },
      },
    });
    footerLinkCount += column.links.length;
  }

  // 2.6 — SocialLink TAMAMEN DEĞİŞTİRİLİR (§9 madde 5 gereği bu şablonda hep boş dizi).
  await tx.socialLink.deleteMany({});
  if (template.socialLinks.length > 0) {
    await tx.socialLink.createMany({
      data: template.socialLinks.map((link, index) => ({ platform: link.platform, url: link.url, order: index })),
    });
  }

  // 2.7 — Portfolio: EKLENİR (mevcut kullanıcı içeriği asla silinmez).
  const categoryIdByTemplateSlug = new Map<string, string>();
  for (const category of template.portfolio.categories) {
    const created = await tx.portfolioCategory.create({
      data: { name: category.name, slug: plan.categorySlugByTemplateSlug.get(category.slug)! },
    });
    categoryIdByTemplateSlug.set(category.slug, created.id);
  }

  for (const item of template.portfolio.items) {
    const coverMediaId = item.coverAssetKey ? (assetKeyToMediaId.get(item.coverAssetKey) ?? null) : null;
    const categoryId = item.categorySlug ? (categoryIdByTemplateSlug.get(item.categorySlug) ?? null) : null;

    const createdItem = await tx.portfolioItem.create({
      data: {
        title: item.title,
        slug: plan.itemSlugByTemplateSlug.get(item.slug)!,
        summary: item.summary,
        contentHtml: sanitizeRichHtml(item.contentHtml),
        clientName: item.clientName,
        categoryId,
        coverMediaId,
        order: item.order,
        status: "PUBLISHED",
        publishedAt: new Date(),
        authorId: actorId,
      },
      select: { id: true, slug: true, translations: true },
    });

    await syncContentSlugs(tx, enabledLocales, "PORTFOLIO_ITEM", createdItem.id, createdItem.slug, createdItem.translations);

    const galleryMediaIds = item.galleryAssetKeys.map((key) => assetKeyToMediaId.get(key)).filter((id): id is string => Boolean(id));
    if (galleryMediaIds.length > 0) {
      await tx.portfolioImage.createMany({
        data: galleryMediaIds.map((mediaId, order) => ({ portfolioItemId: createdItem.id, mediaId, order })),
      });
    }
  }

  // 2.7a — Ürün kategorileri. EKLENİR (§4.4). `template.commerce === null` ise (modern-architecture)
  // bu blok TAMAMEN atlanır — DAVRANIŞ DEĞİŞMEZ.
  const productCategoryIdByTemplateSlug = new Map<string, string>();
  let productCount = 0;
  let productVariantCount = 0;
  let productDocumentCount = 0;
  if (template.commerce) {
    for (const category of template.commerce.categories) {
      const created = await tx.productCategory.create({
        data: { name: category.name, slug: plan.productCategorySlugByTemplateSlug.get(category.slug)! },
      });
      productCategoryIdByTemplateSlug.set(category.slug, created.id);
    }

    // 2.7b — Ürünler + galeri + varyasyon + döküman. EKLENİR — `Order`/`OrderItem`/`User`/
    // `siteUser` hiçbir satırı YAZILMAZ (§4.5, bilinçli KAPSAM DIŞI).
    for (const product of template.commerce.products) {
      const coverMediaId = product.coverAssetKey ? (assetKeyToMediaId.get(product.coverAssetKey) ?? null) : null;
      const categoryId = product.categorySlug ? (productCategoryIdByTemplateSlug.get(product.categorySlug) ?? null) : null;

      // §2.3/§2.4 (.claude/architect-scope-products-catalog.md, bağlayıcı) — katalog sıralama/
      // filtreleme kolonlarının TEK üretim noktası.
      const { effectivePriceCents, discountPercent } = derivePriceColumns({
        priceCents: product.priceCents,
        discountPriceCents: product.discountPriceCents,
      });

      const createdProduct = await tx.product.create({
        data: {
          title: product.title,
          slug: plan.productSlugByTemplateSlug.get(product.slug)!,
          excerpt: product.excerpt,
          descriptionHtml: sanitizeRichHtml(product.descriptionHtml),
          priceCents: product.priceCents,
          currency: product.currency,
          discountPriceCents: product.discountPriceCents,
          effectivePriceCents,
          discountPercent,
          sku: product.sku,
          stockQuantity: product.stockQuantity,
          variantOptions: product.variantOptions as unknown as Prisma.InputJsonValue,
          status: "PUBLISHED",
          publishedAt: new Date(),
          categoryId,
          coverMediaId,
          seoTitle: product.seoTitle,
          seoDescription: product.seoDescription,
          authorId: actorId,
        },
        select: { id: true, slug: true, translations: true },
      });
      productCount += 1;

      await syncContentSlugs(tx, enabledLocales, "PRODUCT", createdProduct.id, createdProduct.slug, createdProduct.translations);

      const galleryMediaIds = product.galleryAssetKeys.map((key) => assetKeyToMediaId.get(key)).filter((id): id is string => Boolean(id));
      if (galleryMediaIds.length > 0) {
        await tx.productImage.createMany({
          data: galleryMediaIds.map((mediaId, order) => ({ productId: createdProduct.id, mediaId, order })),
        });
      }

      for (let i = 0; i < product.variants.length; i++) {
        const variant = product.variants[i]!;
        const variantMediaId = variant.imageAssetKey ? (assetKeyToMediaId.get(variant.imageAssetKey) ?? null) : null;
        await tx.productVariant.create({
          data: {
            productId: createdProduct.id,
            variantKey: deriveVariantKey(variant.optionValues),
            // §2.2 — katalog `?option=` filtresinin okuduğu dizi kolon (bkz. yukarıdaki not).
            optionValueSlugs: deriveOptionValueSlugs(variant.optionValues),
            optionValues: variant.optionValues as unknown as Prisma.InputJsonValue,
            sku: variant.sku,
            priceCents: variant.priceCents,
            discountPriceCents: variant.discountPriceCents,
            stockQuantity: variant.stockQuantity,
            mediaId: variantMediaId,
            order: i,
            isActive: variant.isActive,
          },
        });
        productVariantCount += 1;
      }

      for (let i = 0; i < product.documents.length; i++) {
        const doc = product.documents[i]!;
        const mediaId = assetKeyToMediaId.get(doc.assetKey);
        if (!mediaId) continue; // Faz 0'da zaten doğrulanmış olmalı — savunma derinliği.
        await tx.productDocument.create({ data: { productId: createdProduct.id, mediaId, title: doc.title, order: i } });
        productDocumentCount += 1;
      }
    }
  }

  // 2.7c — Ek (yasal/kurumsal) sayfalar. EKLENİR (§4.3/§4.4). Bu sayfaların `blocks`'u
  // `asset:`/`ref:` token'ı TAŞIMAZ (şablon yazım kararı) — bu yüzden `resolvePageBlockTokens`
  // ÇAĞRILMAZ, doğrudan §2 madde 3'ün iki katmanlı disiplini (Zod doğrula → sanitize → yaz)
  // uygulanır.
  let extraPageCount = 0;
  for (const extraPage of template.extraPages ?? []) {
    const validatedExtraBlocks = PageBlockListSchema.parse(extraPage.blocks);
    const sanitizedExtraBlocks = sanitizePageBlocks(validatedExtraBlocks as unknown[]);
    const createdExtraPage = await tx.page.create({
      data: {
        title: extraPage.title,
        slug: plan.extraPageSlugByTemplateSlug.get(extraPage.slug)!,
        status: "PUBLISHED",
        blocks: sanitizedExtraBlocks as Prisma.InputJsonValue,
        seoTitle: extraPage.seoTitle,
        seoDescription: extraPage.seoDescription,
        isLegalDocument: extraPage.isLegalDocument,
        publishedAt: new Date(),
        authorId: actorId,
      },
      select: { id: true, slug: true, translations: true },
    });
    await syncContentSlugs(tx, enabledLocales, "PAGE", createdExtraPage.id, createdExtraPage.slug, createdExtraPage.translations);
    extraPageCount += 1;
  }

  // 2.8 — Slider + Slide (order 0..n-1). EKLENİR.
  let sliderId: string | null = null;
  let slideCount = 0;
  if (template.slider) {
    const sliderDef = template.slider;
    const createdSlider = await tx.slider.create({
      data: {
        name: sliderDef.name,
        slug: plan.sliderSlug!,
        autoplay: sliderDef.autoplay,
        intervalMs: sliderDef.intervalMs,
        loop: sliderDef.loop,
        pauseOnHover: sliderDef.pauseOnHover,
        transitionEffect: TRANSITION_EFFECT_TO_PRISMA[sliderDef.transitionEffect],
        transitionDurationMs: sliderDef.transitionDurationMs,
        heightMode: HEIGHT_MODE_TO_PRISMA[sliderDef.heightMode],
        heightPx: sliderDef.heightPx,
        aspectRatioWidth: sliderDef.aspectRatioWidth,
        aspectRatioHeight: sliderDef.aspectRatioHeight,
        widthMode: WIDTH_MODE_TO_PRISMA[sliderDef.widthMode],
        showArrows: sliderDef.showArrows,
        showBullets: sliderDef.showBullets,
        showProgressBar: sliderDef.showProgressBar,
        navigationTheme: NAVIGATION_THEME_TO_PRISMA[sliderDef.navigationTheme],
      },
    });
    sliderId = createdSlider.id;

    for (let i = 0; i < sliderDef.slides.length; i++) {
      const slide = sliderDef.slides[i]!;
      const bgMediaId = slide.bgAssetKey ? (assetKeyToMediaId.get(slide.bgAssetKey) ?? null) : null;
      await tx.slide.create({
        data: {
          sliderId,
          order: i,
          isActive: slide.isActive,
          label: slide.label,
          bgType: BACKGROUND_TYPE_TO_PRISMA[slide.bgType],
          bgMediaId,
          bgPositionX: slide.bgPositionX,
          bgPositionY: slide.bgPositionY,
          bgOverlayColor: slide.bgOverlayColor,
          bgOverlayOpacity: slide.bgOverlayOpacity,
          bgGradientFrom: slide.bgGradientFrom,
          bgGradientTo: slide.bgGradientTo,
          bgGradientAngle: slide.bgGradientAngle,
          bgKenBurns: slide.bgKenBurns,
          durationMs: slide.durationMs,
          linkHref: slide.linkHref,
          linkNewTab: slide.linkNewTab,
          layers: slide.layers as unknown as Prisma.InputJsonValue,
        },
      });
      slideCount += 1;
    }
  }

  // 2.9 — `ref:slider`/`ref:product-category:<slug>` çözümlemesi (gerçek `Slider.id` VE
  // `ProductCategory.id`'ler artık BİLİNİYOR) → Zod ile SON kez doğrula (§3.4 madde 2: (a) çöz
  // → (b) doğrula → (c) yaz, TAM olarak bu noktada) → page.create.
  const finalResolve = resolvePageBlockTokens(assetResolvedBlocks, EMPTY_ASSET_MAP, sliderId, productCategoryIdByTemplateSlug);
  if (finalResolve.unresolvedTokens.length > 0) {
    // Teorik olarak Faz 0'da yakalanmış olmalıydı — savunma derinliği.
    throw new ValidationError("Şablon içeriğinde çözülemeyen token bulundu.", { unresolvedTokens: finalResolve.unresolvedTokens });
  }
  const finalBlocks = PageBlockListSchema.parse(finalResolve.blocks);
  const sanitizedBlocks = sanitizePageBlocks(finalBlocks as unknown[]);

  const createdPage = await tx.page.create({
    data: {
      title: template.page.title,
      slug: plan.pageSlug,
      status: "PUBLISHED",
      blocks: sanitizedBlocks as Prisma.InputJsonValue,
      seoTitle: template.page.seoTitle,
      seoDescription: template.page.seoDescription,
      publishedAt: new Date(),
      authorId: actorId,
    },
    select: { id: true, slug: true, translations: true },
  });
  await syncContentSlugs(tx, enabledLocales, "PAGE", createdPage.id, createdPage.slug, createdPage.translations);

  // 2.10 — `setAsHomePage`: İSTEK düzeyindeki bayrak (varsayılan true) VE şablonun kendi
  // önerisi (`page.setAsHomePage`) İKİSİ DE true olmalı (bkz. `types.ts::DemoTemplateDefinition
  // .page.setAsHomePage` yorumu — bu ayrım, gelecekte "ana sayfa adayı olmayan" bir şablon
  // türüne izin verir; bu şablon için ikisi de her zaman true'dur).
  const wantsHomePage = body.setAsHomePage && template.page.setAsHomePage;
  const previousHomePageId = settingsBeforeHome?.homePageId ?? null;
  if (wantsHomePage) {
    await tx.siteSettings.update({ where: { id: SETTINGS_ID }, data: { homePageId: createdPage.id } });
  }

  // 2.11 — idempotency işareti (son uygulama kazanır). `importedAt` `@updatedAt` DEĞİLDİR —
  // yeniden uygulamada (force) "son uygulama zamanı" anlamını korusun diye BURADA elle tazelenir.
  await tx.demoTemplateImport.upsert({
    where: { templateKey: template.key },
    create: { templateKey: template.key, version: template.version, importedById: actorId, pageId: createdPage.id },
    update: { version: template.version, importedById: actorId, pageId: createdPage.id, importedAt: new Date() },
  });

  return {
    pageId: createdPage.id,
    pageSlug: createdPage.slug,
    sliderId,
    previousHomePageId,
    setAsHomePage: wantsHomePage,
    counts: {
      media: savedAssets.length,
      portfolioCategories: template.portfolio.categories.length,
      portfolioItems: template.portfolio.items.length,
      navigationItems: navigationItemCount,
      footerColumns: template.footer.columns.length,
      footerLinks: footerLinkCount,
      socialLinks: template.socialLinks.length,
      slides: slideCount,
    },
    commerceCounts: {
      productCategories: productCategoryIdByTemplateSlug.size,
      products: productCount,
      productVariants: productVariantCount,
      productDocuments: productDocumentCount,
      extraPages: extraPageCount,
    },
    previousShipping: template.commerce
      ? {
          shippingFlatFeeCents: settingsBeforeHome?.shippingFlatFeeCents ?? null,
          freeShippingThresholdCents: settingsBeforeHome?.freeShippingThresholdCents ?? null,
        }
      : null,
  };
}

/**
 * `POST /admin/demo-templates/{templateKey}/import` iş mantığı — route handler'ın TEK çağırdığı
 * fonksiyon. Fırlatılan hatalar (`NotFoundError`/`ValidationError`/`DemoTemplateAlreadyImportedError`)
 * route katmanında YAKALANMAZ — merkezi `plugins/error-handler.ts` tarafından işlenir.
 */
export async function importDemoTemplate(app: FastifyInstance, params: ImportDemoTemplateParams): Promise<DemoTemplateImportResultDto> {
  // ---- Faz 0.1/0.2 — registry + idempotency -------------------------------------------------
  const template = getDemoTemplate(params.templateKey);
  if (!template) throw new NotFoundError(`Bilinmeyen demo şablonu: "${params.templateKey}".`);

  const existingImport = await app.prisma.demoTemplateImport.findUnique({
    where: { templateKey: template.key },
    include: { importedBy: true },
  });
  if (existingImport && !params.body.force) {
    throw new DemoTemplateAlreadyImportedError({
      templateKey: existingImport.templateKey,
      importedAt: existingImport.importedAt.toISOString(),
      importedBy: existingImport.importedBy?.email ?? null,
      version: existingImport.version,
      pageId: existingImport.pageId,
    });
  }

  // ---- Faz 0.3/0.4 — token "kuru koşu" (yalnızca ŞEKİL doğrulaması, gerçek değer YOK) --------
  const placeholderAssetMap = new Map(template.assets.map((asset) => [asset.key, PLACEHOLDER_ASSET_URL]));
  // §4.2 — `ref:product-category:<slug>` FATAL/unresolved doğrulaması, `ref:slider` ile AYNI
  // "kuru koşu" mantığı: yalnızca TEMPLATE'İN KENDİ `commerce.categories`'inde TANIMLI slug'lar
  // placeholder UUID'ye çözülür; tanımsız bir slug (yazım hatası) burada YAKALANIR (422).
  const placeholderCategoryMap = template.commerce
    ? new Map(template.commerce.categories.map((category) => [category.slug, PLACEHOLDER_UUID]))
    : null;
  const dryRun = resolvePageBlockTokens(
    template.page.blocks as unknown[],
    placeholderAssetMap,
    template.slider ? PLACEHOLDER_UUID : null,
    placeholderCategoryMap
  );
  if (dryRun.unresolvedTokens.length > 0) {
    throw new ValidationError("Şablon içeriğinde çözülemeyen token bulundu.", { unresolvedTokens: dryRun.unresolvedTokens });
  }

  const shapeCheck = PageBlockListSchema.safeParse(dryRun.blocks);
  if (!shapeCheck.success) {
    throw new ValidationError("Şablon sayfa içeriği doğrulamadan geçemedi.", flattenZodIssues(shapeCheck.error.issues));
  }

  if (template.slider) {
    for (const slide of template.slider.slides) {
      const layersCheck = SlideLayersSchema.safeParse(slide.layers);
      if (!layersCheck.success) {
        throw new ValidationError("Şablon slider katmanları doğrulamadan geçemedi.", flattenZodIssues(layersCheck.error.issues));
      }
    }
  }

  // §4.3 — ek (yasal/kurumsal) sayfaların `blocks`'u da AYNI iki katmanlı disiplinden (§2 madde
  // 3) geçirilir; bu sayfalar `asset:`/`ref:` token'ı TAŞIMADIĞI için token çözümlemesi GEREKMEZ.
  for (const extraPage of template.extraPages ?? []) {
    const extraShapeCheck = PageBlockListSchema.safeParse(extraPage.blocks);
    if (!extraShapeCheck.success) {
      throw new ValidationError(`Şablon ek sayfa ("${extraPage.slug}") içeriği doğrulamadan geçemedi.`, flattenZodIssues(extraShapeCheck.error.issues));
    }
  }

  // §1.1/§1.4 — her varyasyonun `optionValues`'ı ürünün `variantOptions` eksen tanımıyla
  // BİREBİR eşleşmeli (yazım hatası/eksik eksen değeri burada FATAL — 422, hiçbir yazma YOK).
  for (const product of template.commerce?.products ?? []) {
    for (const variant of product.variants) {
      assertOptionValuesMatchAxes(variant.optionValues, product.variantOptions);
    }
  }

  // ---- Faz 0 (ek) — paket varlık dosyalarının varlığı/boyutu (yazma YOK) ----------------------
  await assertTemplateAssetFilesReadable(template.key, template.assets);

  const warnings: string[] = [];
  if (template.portfolio.items.length > 0 && !(await isModuleEnabled(app, "portfolio"))) {
    warnings.push("Portföy modülü kapalı olduğu için içe aktarılan projeler sitede görünmeyecek. /admin/modules üzerinden açabilirsiniz.");
  }
  // §4.4 son paragraf, [DTI] §6.6 deseni.
  if ((template.commerce?.products.length ?? 0) > 0 && !(await isModuleEnabled(app, "products"))) {
    warnings.push("Ürünler modülü kapalı olduğu için içe aktarılan ürünler sitede görünmeyecek. /admin/modules üzerinden açabilirsiniz.");
  }
  if (existingImport && params.body.force) {
    warnings.push("Şablon daha önce uygulanmıştı; `force` ile ikinci bir kopya oluşturuldu. Önceki içerik SİLİNMEDİ.");
  }
  // §4.3 — compliance-agent'a bağlayıcı: yasal yer tutucu sayfa üreten şablonlarda kullanıcı
  // AÇIKÇA uyarılmalı, "sessizce yayınlanan sahte hukuki metin" riskini önler.
  const legalPageCount = (template.extraPages ?? []).filter((page) => page.isLegalDocument).length;
  if (legalPageCount > 0) {
    warnings.push(`${legalPageCount} yasal sayfa YER TUTUCU olarak oluşturuldu; yayına almadan önce içeriklerini doldurun.`);
  }

  // ---- Faz 1 — varlık materyalizasyonu (transaction DIŞINDA, DB yazma YOK) --------------------
  const savedAssets = await materializeTemplateAssets(template.key, template.assets);
  const assetKeyToMediaId = new Map(savedAssets.map((asset) => [asset.key, crypto.randomUUID()]));
  // `page.blocks` JSON'una token-replacement ile GÖMÜLEN URL'ler (ör. `container.background.value`)
  // gerçek `Media` FK ilişkilerinin AKSİNE okuma anında `absolutizeMediaUrl` ile geçmez — DB'ye
  // olduğu gibi yazılır ve frontend'e servis edilir. Bu yüzden burada, yazma anında absolutize
  // edilmesi ZORUNLU (bkz. `mappers/index.ts::absolutizeMediaUrl`, aynı `env.PUBLIC_URL` mantığı).
  const assetUrlByKey = new Map(savedAssets.map((asset) => [asset.key, absolutizeMediaUrl(asset.url)]));

  // `ref:product-category:` ERTELENİR (`null`) — gerçek `ProductCategory.id`'ler yalnızca Faz
  // 2'de (transaction içinde, kategoriler oluşturulduktan SONRA) bilinir; `ref:slider` ile AYNI
  // erteleme deseni (bkz. `lib/asset-tokens.ts::resolvePageBlockTokens` başlığı).
  const assetResolved = resolvePageBlockTokens(template.page.blocks as unknown[], assetUrlByKey, null, null);
  if (assetResolved.unresolvedTokens.length > 0) {
    await removeSavedTemplateAssets(savedAssets, (paths) => app.log.warn({ paths }, "Demo şablon telafi: dosya silinemedi (Faz 1)"));
    throw new ValidationError("Şablon içeriğinde çözülemeyen token bulundu.", { unresolvedTokens: assetResolved.unresolvedTokens });
  }

  const { enabled: enabledLocales } = await getLocaleSet(app);

  // ---- Faz 2 — TEK transaction (P2002 → sınırlı yeniden deneme, §5.2/§6.5) --------------------
  let outcome: TransactionOutcome | undefined;
  let slugWarnings: string[] = [];
  let attempt = 0;
  for (;;) {
    const resolved = await resolveSlugPlan(app, template);
    slugWarnings = resolved.slugWarnings;
    try {
      outcome = await app.prisma.$transaction(
        (tx) =>
          writeTemplateInTransaction(
            tx,
            template,
            savedAssets,
            assetKeyToMediaId,
            assetResolved.blocks,
            resolved.plan,
            enabledLocales,
            params.body,
            params.actorId
          ),
        { timeout: 30_000, maxWait: 10_000 }
      );
      break;
    } catch (err) {
      attempt += 1;
      const isSlugRace = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (isSlugRace && attempt <= MAX_TRANSACTION_RETRIES) continue;

      // TELAFİ — Faz 1'de kaydedilen HER dosya best-effort silinir (§5.2).
      await removeSavedTemplateAssets(savedAssets, (paths) => app.log.warn({ paths }, "Demo şablon telafi: dosya silinemedi (Faz 2)"));

      await logAudit(app, {
        actorId: params.actorId,
        actorEmail: params.actorEmail,
        action: "demo_template.import",
        status: "FAILURE",
        targetType: "DemoTemplateImport",
        targetId: template.key,
        metadata: {
          templateKey: template.key,
          version: template.version,
          force: params.body.force,
          confirm: params.body.confirm,
          error: err instanceof Error ? err.message : String(err),
        },
        ipAddress: params.ip ?? null,
      });

      throw err; // OLDUĞU GİBİ — yutulmaz.
    }
  }

  warnings.push(...slugWarnings);
  const finalOutcome = outcome!;

  // ---- Transaction sonrası — best-effort (hata yutulur) ---------------------------------------
  await logAudit(app, {
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: "demo_template.import",
    status: "SUCCESS",
    targetType: "Page",
    targetId: finalOutcome.pageId,
    metadata: {
      templateKey: template.key,
      templateVersion: template.version,
      force: params.body.force,
      confirm: params.body.confirm,
      createdPageId: finalOutcome.pageId,
      createdSliderId: finalOutcome.sliderId,
      previousHomePageId: finalOutcome.previousHomePageId,
      counts: finalOutcome.counts,
      // §4.4 — ecommerce-pro genişlemesi (audit-only, DemoTemplateImportResultSchema'nın DIŞINDA).
      commerceCounts: finalOutcome.commerceCounts,
      previousShipping: finalOutcome.previousShipping,
      warnings,
    },
    ipAddress: params.ip ?? null,
  });

  await triggerPublicPageRevalidation(
    app,
    { id: finalOutcome.pageId, slug: finalOutcome.pageSlug, translations: {} },
    { isHomePage: finalOutcome.setAsHomePage }
  );

  return {
    templateKey: template.key,
    version: template.version,
    importedAt: new Date().toISOString(),
    pageId: finalOutcome.pageId,
    pageSlug: finalOutcome.pageSlug,
    setAsHomePage: finalOutcome.setAsHomePage,
    sliderId: finalOutcome.sliderId,
    counts: finalOutcome.counts,
    warnings,
  };
}

/** `GET /admin/demo-templates` özet listesi için `DEMO_TEMPLATE_REGISTRY` + `DemoTemplateImport` durumunu birleştirir. */
export async function listDemoTemplateSummaries(app: FastifyInstance) {
  const importRows = await app.prisma.demoTemplateImport.findMany({ include: { importedBy: true } });
  const importByKey = new Map(importRows.map((row) => [row.templateKey, row]));

  return DEMO_TEMPLATE_REGISTRY.map((definition) => {
    const applied = importByKey.get(definition.key) ?? null;
    return {
      key: definition.key,
      version: definition.version,
      name: definition.name,
      description: definition.description,
      previewImageUrl: definition.previewImageUrl,
      tags: definition.tags,
      palette: [
        definition.appearance.primaryColor,
        definition.appearance.secondaryColor,
        definition.appearance.accentColor,
        definition.appearance.backgroundColor,
      ].filter((value): value is string => Boolean(value)),
      contents: {
        pages: 1,
        sliders: definition.slider ? 1 : 0,
        slides: definition.slider?.slides.length ?? 0,
        portfolioCategories: definition.portfolio.categories.length,
        portfolioItems: definition.portfolio.items.length,
        navigationItems: countNavItemsTotal(definition.navigation),
        footerColumns: definition.footer.columns.length,
        mediaAssets: definition.assets.length,
      },
      // §6.1 yıkıcılık matrisi — appearance/siteSettings/navigation/footer/socialLinks HER ZAMAN
      // (bu şablonun her uygulanışında) üzerine yazılır. `homePage` ise şablonun KENDİ önerisine
      // bağlıdır (`page.setAsHomePage`) — istek-anındaki `setAsHomePage` bayrağı (varsayılan
      // true) GET anında bilinmez, bu yüzden burada şablonun statik niyeti yansıtılır.
      replaces: [
        "appearance" as const,
        "siteSettings" as const,
        "navigation" as const,
        "footer" as const,
        "socialLinks" as const,
        ...(definition.page.setAsHomePage ? (["homePage" as const] as const) : []),
      ],
      appliedAt: applied ? applied.importedAt.toISOString() : null,
      appliedVersion: applied?.version ?? null,
      appliedById: applied?.importedById ?? null,
      appliedByName: applied?.importedBy?.name ?? null,
      appliedPageId: applied?.pageId ?? null,
    };
  });
}
