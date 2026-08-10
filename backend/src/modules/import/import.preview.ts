import type { FastifyInstance } from "fastify";
import { ValidationError } from "../../lib/errors";
import { slugify } from "../../lib/slug";
import type { ImportJobPreviewDto, ImportJobPreviewWarningDto, ImportJobType, ImportSourceFormat } from "../../schemas/entities";
import { IMPORT_RECORD_CAPS, IMPORT_TARGET_FIELDS } from "./import.constants";
import { suggestFieldMapping, applyFieldMapping } from "./lib/field-mapping";
import { sanitizeRichHtml as sanitizeImportedHtml } from "../../lib/html-sanitize";
import { parseTabular } from "./parsers/tabular.parser";
import { parseWxr } from "./parsers/wxr.parser";
import { parseMediaZip } from "./parsers/zip.parser";

export interface BuildPreviewResult {
  preview: ImportJobPreviewDto;
  totalCount: number;
}

function assertRecordCap(type: ImportJobType, count: number): void {
  const cap = IMPORT_RECORD_CAPS[type];
  if (count > cap) {
    throw new ValidationError(`Bu içe aktarma türü için en fazla ${cap} kayıt desteklenir.`, {
      file: [`Dosyada ${count} kayıt bulundu.`],
    });
  }
  if (count === 0) {
    throw new ValidationError("Dosyada içe aktarılabilecek kayıt bulunamadı.", { file: ["Dosya boş görünüyor."] });
  }
}

async function buildTabularPreview(
  app: FastifyInstance,
  type: "PAGES" | "BLOG" | "USERS",
  format: ImportSourceFormat,
  buffer: Buffer
): Promise<BuildPreviewResult> {
  const { sourceFields, records } = parseTabular(buffer, format);
  assertRecordCap(type, records.length);

  const { fields, suggestedMapping, canStart } = suggestFieldMapping(sourceFields, type);

  const samples = records.slice(0, 5).map((record) => {
    const mapped = applyFieldMapping(record, suggestedMapping);
    if (typeof mapped.contentHtml === "string") mapped.contentHtml = sanitizeImportedHtml(mapped.contentHtml);
    return mapped;
  });

  const warnings: ImportJobPreviewWarningDto[] = [];

  const unmatchedCount = fields.filter((f) => f.status === "unmatched").length;
  if (unmatchedCount > 0) {
    warnings.push({
      code: "UNMAPPED_COLUMNS",
      message: `${unmatchedCount} sütun bilinen bir alanla eşleştirilemedi, içe aktarılırken yok sayılacak.`,
      count: unmatchedCount,
    });
  }

  const mapsContentHtml = Object.values(suggestedMapping).includes("contentHtml");
  if (mapsContentHtml) {
    warnings.push({
      code: "HTML_WILL_BE_SANITIZED",
      message: "İçerik alanındaki HTML, güvenlik nedeniyle sunucu tarafında temizlenecek (script/iframe/on* öznitelikleri kaldırılır).",
    });
  }

  if (type === "PAGES" || type === "BLOG") {
    const candidateSlugs = records
      .map((record) => {
        const mapped = applyFieldMapping(record, suggestedMapping);
        const rawSlug = typeof mapped.slug === "string" && mapped.slug.trim() ? mapped.slug : mapped.title;
        return typeof rawSlug === "string" && rawSlug.trim() ? slugify(rawSlug) : null;
      })
      .filter((s): s is string => Boolean(s));

    if (candidateSlugs.length > 0) {
      const existing =
        type === "PAGES"
          ? await app.prisma.page.count({ where: { slug: { in: candidateSlugs } } })
          : await app.prisma.blogPost.count({ where: { slug: { in: candidateSlugs } } });
      if (existing > 0) {
        warnings.push({
          code: "SLUG_COLLISION",
          message: `${existing} kayıt mevcut bir slug ile çakışıyor — seçilen çakışma stratejisine göre işlenecek.`,
          count: existing,
        });
      }
    }
  }

  const preview: ImportJobPreviewDto = {
    totalCount: records.length,
    canStart: canStart && records.length > 0,
    fields,
    targetFields: IMPORT_TARGET_FIELDS[type],
    suggestedMapping,
    samples,
    warnings,
  };

  return { preview, totalCount: records.length };
}

async function buildWordpressPreview(app: FastifyInstance, buffer: Buffer): Promise<BuildPreviewResult> {
  const parsed = parseWxr(buffer, { allowedPostTypes: ["post", "page"], recordCap: IMPORT_RECORD_CAPS.WORDPRESS });
  assertRecordCap("WORDPRESS", parsed.items.length);

  const warnings: ImportJobPreviewWarningDto[] = [];

  if (parsed.breakdown.products > 0) {
    warnings.push({
      code: "WP_PRODUCTS_SKIPPED",
      message: `${parsed.breakdown.products} ürün (WooCommerce) bulundu; bu tipte içe aktarılmaz. Aynı dosyayı "Ürünler" tipiyle yeniden yükleyin.`,
      count: parsed.breakdown.products,
    });
  }
  if (parsed.breakdown.attachments > 0) {
    warnings.push({
      code: "WP_MEDIA_NOT_DOWNLOADED",
      message: `${parsed.breakdown.attachments} medya bağlantısı kaynak siteye işaret ediyor, görseller taşınmaz.`,
      count: parsed.breakdown.attachments,
    });
  }
  if (parsed.hasUnsupportedTags) {
    warnings.push({ code: "WP_TAGS_UNSUPPORTED", message: "Etiketler (post_tag) desteklenmiyor, yok sayılacak." });
  }

  const privateCount = parsed.items.filter((i) => i.status === "private").length;
  if (privateCount > 0) {
    warnings.push({
      code: "WP_PRIVATE_AS_DRAFT",
      message: `${privateCount} özel (private) yazı taslak olarak içe aktarılacak.`,
      count: privateCount,
    });
  }
  const futureCount = parsed.items.filter((i) => i.status === "future").length;
  if (futureCount > 0) {
    warnings.push({
      code: "WP_SCHEDULED_AS_DRAFT",
      message: `${futureCount} zamanlanmış yazı taslak olarak içe aktarılacak (zamanlanmış yayın desteklenmiyor).`,
      count: futureCount,
    });
  }

  const creatorLogins = Array.from(new Set(parsed.items.map((i) => i.creatorLogin).filter((l): l is string => Boolean(l))));
  const emailsByLogin = new Map<string, string>();
  for (const login of creatorLogins) {
    const author = parsed.authors.get(login);
    if (author?.email) emailsByLogin.set(login, author.email.toLowerCase());
  }
  const candidateEmails = Array.from(new Set(emailsByLogin.values()));
  const existingUsers =
    candidateEmails.length > 0
      ? await app.prisma.user.findMany({ where: { email: { in: candidateEmails } }, select: { email: true } })
      : [];
  const existingEmailSet = new Set(existingUsers.map((u) => u.email.toLowerCase()));
  const unmatchedAuthorCount = parsed.items.filter((i) => {
    if (!i.creatorLogin) return true;
    const email = emailsByLogin.get(i.creatorLogin);
    return !email || !existingEmailSet.has(email);
  }).length;
  if (unmatchedAuthorCount > 0) {
    warnings.push({
      code: "WP_AUTHOR_UNMATCHED",
      message: `${unmatchedAuthorCount} yazı için yazar eşleştirilemedi, varsayılan yazar atanacak (veya boş bırakılacak).`,
      count: unmatchedAuthorCount,
    });
  }

  warnings.push({
    code: "HTML_WILL_BE_SANITIZED",
    message: "İçerik alanlarındaki HTML, güvenlik nedeniyle sunucu tarafında temizlenecek.",
  });

  const pageSlugs = parsed.items.filter((i) => i.postType === "page").map((i) => i.slugRaw || slugify(i.title));
  const postSlugs = parsed.items.filter((i) => i.postType === "post").map((i) => i.slugRaw || slugify(i.title));
  const [existingPageSlugs, existingPostSlugs] = await Promise.all([
    pageSlugs.length > 0 ? app.prisma.page.count({ where: { slug: { in: pageSlugs } } }) : 0,
    postSlugs.length > 0 ? app.prisma.blogPost.count({ where: { slug: { in: postSlugs } } }) : 0,
  ]);
  const slugCollisions = existingPageSlugs + existingPostSlugs;
  if (slugCollisions > 0) {
    warnings.push({
      code: "SLUG_COLLISION",
      message: `${slugCollisions} kayıt mevcut bir slug ile çakışıyor — seçilen çakışma stratejisine göre işlenecek.`,
      count: slugCollisions,
    });
  }

  const samples = parsed.items.slice(0, 5).map((item) => ({
    title: item.title,
    slug: item.slugRaw || slugify(item.title),
    postType: item.postType,
    status: item.status,
    contentHtml: sanitizeImportedHtml(item.contentHtml).slice(0, 2000),
  }));

  const preview: ImportJobPreviewDto = {
    totalCount: parsed.items.length,
    canStart: parsed.items.length > 0,
    fields: [],
    targetFields: [],
    suggestedMapping: {},
    samples,
    breakdown: parsed.breakdown,
    warnings,
  };

  return { preview, totalCount: parsed.items.length };
}

/**
 * §10.8.9 WooCommerce (`PRODUCTS`) önizlemesi — `buildWordpressPreview` ile AYNI `parseWxr`
 * giriş noktasını kullanır (`allowedPostTypes: ["product"]`), XXE/derinlik koruması ve
 * `_thumbnail_id` iki geçişli çözümlemesi otomatik miras alınır (bkz. wxr.parser.ts modül üstü
 * notu — mimar kararı 2A).
 */
async function buildProductsPreview(app: FastifyInstance, buffer: Buffer): Promise<BuildPreviewResult> {
  const parsed = parseWxr(buffer, { allowedPostTypes: ["product"], recordCap: IMPORT_RECORD_CAPS.PRODUCTS });
  assertRecordCap("PRODUCTS", parsed.items.length);

  const warnings: ImportJobPreviewWarningDto[] = [];

  if (parsed.wcOrdersIgnoredCount > 0) {
    warnings.push({
      code: "WC_ORDERS_IGNORED",
      message: `${parsed.wcOrdersIgnoredCount} sipariş/müşteri kaydı bulundu; güvenlik ve kişisel veri nedeniyle içe aktarılmadı.`,
      count: parsed.wcOrdersIgnoredCount,
    });
  }
  if (parsed.wcVariationsUnsupportedCount > 0) {
    warnings.push({
      code: "WC_VARIATIONS_UNSUPPORTED",
      message: `${parsed.wcVariationsUnsupportedCount} ürün varyasyonu desteklenmiyor; yalnızca ana ürün kayıtları içe aktarılacak.`,
      count: parsed.wcVariationsUnsupportedCount,
    });
  }
  if (parsed.hasUnsupportedTags) {
    warnings.push({ code: "WP_TAGS_UNSUPPORTED", message: "Ürün etiketleri (product_tag) desteklenmiyor, yok sayılacak." });
  }

  const galleryCount = parsed.items.filter((i) => i.hasGalleryOrThumbnail).length;
  if (galleryCount > 0) {
    warnings.push({
      code: "WC_GALLERY_NOT_IMPORTED",
      message: `${galleryCount} ürün görseli kaynak siteye işaret ediyor; görseller taşınmaz. Medya klasörünü ZIP'leyip MEDIA içe aktarımıyla yükledikten sonra kapak görsellerini elle atayın.`,
      count: galleryCount,
    });
  }

  const stockNotManagedCount = parsed.items.filter((i) => i.manageStockRaw?.trim().toLowerCase() !== "yes").length;
  if (stockNotManagedCount > 0) {
    warnings.push({
      code: "WC_STOCK_NOT_MANAGED",
      message: `${stockNotManagedCount} üründe stok takibi kapalı; miktar 0/1 olarak varsayıldı, içe aktarımdan sonra gözden geçirin.`,
      count: stockNotManagedCount,
    });
  }

  if (parsed.items.length > 0) {
    warnings.push({
      code: "WC_TAX_NOT_IMPORTED",
      message: "WooCommerce vergi ORANI dosyada bulunmuyor (yalnızca sınıf bilgisi taşınır); vergi oranı boş bırakılacak.",
    });
    warnings.push({
      code: "HTML_WILL_BE_SANITIZED",
      message: "Ürün açıklamalarındaki HTML, güvenlik nedeniyle sunucu tarafında temizlenecek.",
    });
  }

  const skus = parsed.items.map((i) => i.sku).filter((s): s is string => Boolean(s));
  const slugs = parsed.items.map((i) => i.slugRaw || slugify(i.title));
  const [existingBySku, existingBySlug] = await Promise.all([
    skus.length > 0 ? app.prisma.product.count({ where: { sku: { in: skus } } }) : 0,
    slugs.length > 0 ? app.prisma.product.count({ where: { slug: { in: slugs } } }) : 0,
  ]);
  const slugCollisions = existingBySku + existingBySlug;
  if (slugCollisions > 0) {
    warnings.push({
      code: "SLUG_COLLISION",
      message: `${slugCollisions} ürün mevcut bir SKU/slug ile çakışıyor — seçilen çakışma stratejisine göre işlenecek.`,
      count: slugCollisions,
    });
  }

  const samples = parsed.items.slice(0, 5).map((item) => ({
    title: item.title,
    slug: item.slugRaw || slugify(item.title),
    sku: item.sku,
    status: item.status,
    regularPrice: item.regularPriceRaw ?? item.priceRaw,
    salePrice: item.salePriceRaw,
    categoryName: item.categoryName,
  }));

  const preview: ImportJobPreviewDto = {
    totalCount: parsed.items.length,
    canStart: parsed.items.length > 0,
    fields: [],
    targetFields: [],
    suggestedMapping: {},
    samples,
    breakdown: parsed.breakdown,
    warnings,
  };

  return { preview, totalCount: parsed.items.length };
}

async function buildMediaPreview(app: FastifyInstance, buffer: Buffer): Promise<BuildPreviewResult> {
  const { entries } = await parseMediaZip(buffer);
  assertRecordCap("MEDIA", entries.length);

  const warnings: ImportJobPreviewWarningDto[] = [];
  const svgCount = entries.filter((e) => e.isSvg).length;
  if (svgCount > 0) {
    warnings.push({
      code: "MEDIA_SVG_REJECTED",
      message: `${svgCount} SVG dosyası güvenlik nedeniyle reddedilecek (depolanmış XSS riski).`,
      count: svgCount,
    });
  }

  const filenames = entries.map((e) => e.name.split("/").pop() ?? e.name);
  const existing = filenames.length > 0 ? await app.prisma.media.count({ where: { filename: { in: filenames } } }) : 0;
  if (existing > 0) {
    warnings.push({
      code: "SLUG_COLLISION",
      message: `${existing} dosya adı mevcut medya kayıtlarıyla çakışıyor — seçilen çakışma stratejisine göre işlenecek.`,
      count: existing,
    });
  }

  const samples = entries.slice(0, 5).map((e) => ({ name: e.name, mimeType: e.mimeType, sizeBytes: e.sizeBytes }));

  const preview: ImportJobPreviewDto = {
    totalCount: entries.length,
    canStart: entries.length > 0,
    fields: [],
    targetFields: [],
    suggestedMapping: {},
    samples,
    warnings,
  };

  return { preview, totalCount: entries.length };
}

export async function buildImportPreview(
  app: FastifyInstance,
  type: ImportJobType,
  format: ImportSourceFormat,
  buffer: Buffer
): Promise<BuildPreviewResult> {
  switch (type) {
    case "PAGES":
      return buildTabularPreview(app, "PAGES", format, buffer);
    case "BLOG":
      return buildTabularPreview(app, "BLOG", format, buffer);
    case "USERS":
      return buildTabularPreview(app, "USERS", format, buffer);
    case "WORDPRESS":
      return buildWordpressPreview(app, buffer);
    case "PRODUCTS":
      return buildProductsPreview(app, buffer);
    case "MEDIA":
      return buildMediaPreview(app, buffer);
    default:
      throw new ValidationError("Desteklenmeyen içe aktarma türü.");
  }
}
