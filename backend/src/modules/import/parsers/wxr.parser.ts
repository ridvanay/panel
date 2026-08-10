import { SaxesParser, type SaxesAttributeNS } from "saxes";
import { ValidationError } from "../../../lib/errors";
import { WXR_MAX_DEPTH } from "../import.constants";
import { assertNoDoctypeOrEntity } from "../lib/xml-guard";

/**
 * §10.8.6 WXR eşleştirmesi — ad alanı URI'leriyle eşleştirilir, `wp:`/`content:` ÖN EKLERİYLE
 * DEĞİL (ön ek dosyadan dosyaya değişebilir). 1.0/1.1/1.2 export URI'lerinin ÜÇÜ de kabul edilir.
 */
const WP_NS = new Set(["http://wordpress.org/export/1.0/", "http://wordpress.org/export/1.1/", "http://wordpress.org/export/1.2/"]);
const EXCERPT_NS = "http://wordpress.org/export/1.2/excerpt/";
const CONTENT_NS = "http://purl.org/rss/1.0/modules/content/";
const DC_NS = "http://purl.org/dc/elements/1.1/";

export interface WxrAuthor {
  login: string;
  email: string | null;
  displayName: string | null;
}

export interface WxrItem {
  postId: string | null;
  postType: string;
  status: string | null;
  title: string;
  slugRaw: string | null;
  contentHtml: string;
  excerpt: string | null;
  postDateGmt: string | null;
  postDate: string | null;
  creatorLogin: string | null;
  categoryNicename: string | null;
  categoryName: string | null;
  tagsFound: boolean;
  link: string | null;
  guid: string | null;
  thumbnailId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  noIndex: boolean;
  /** İki geçişli çözümleme (bkz. modül üstü not) sonrası doldurulur — attachment yazılardan SONRA gelebilir. */
  resolvedThumbnailUrl: string | null;

  // ---- §10.8.9 WooCommerce (yalnızca postType === "product" iken anlamlıdır) ----
  /** `_sku` postmeta'sı — trim edilmiş; boş string `null`'a düşer. */
  sku: string | null;
  /** `_regular_price` postmeta ham METİN değeri (kuruşa çevrim `lib/price-parse.ts`'te yapılır). */
  regularPriceRaw: string | null;
  /** `_sale_price` postmeta ham METİN değeri. */
  salePriceRaw: string | null;
  /** `_price` postmeta ham METİN değeri — YALNIZCA `_regular_price` yoksa yedek kaynak. */
  priceRaw: string | null;
  /** `_manage_stock` postmeta ham değeri (`"yes"`/`"no"`). */
  manageStockRaw: string | null;
  /** `_stock` postmeta ham METİN değeri. */
  stockRaw: string | null;
  /** `_stock_status` postmeta ham değeri (`instock`/`outofstock`/`onbackorder`). */
  stockStatusRaw: string | null;
  /**
   * `_thumbnail_id` veya `_product_image_gallery` postmeta'sı DOLU mu — yalnızca aggregate
   * `WC_GALLERY_NOT_IMPORTED` önizleme uyarısının sayacı için (bkz. §10.8.9 görsel kuralı).
   * Değerlerin KENDİSİ saklanmaz (SSRF kararı — dosya asla indirilmez).
   */
  hasGalleryOrThumbnail: boolean;
}

export interface WxrBreakdown {
  pages: number;
  posts: number;
  products: number;
  attachments: number;
  categories: number;
  /**
   * Materyalize EDİLMEYEN (yazılmayan) her şey: mevcut çalıştırma modunda hedeflenmeyen
   * post/page/product item'ları (ör. `WORDPRESS` modunda `product`), gerçekten desteklenmeyen
   * `wp:post_type` değerleri (`nav_menu_item`, `revision`, `wp_block`, `product_variation`,
   * `shop_order` …) VE `trash`/`inherit` durumundaki item'lar.
   */
  skipped: number;
}

export interface WxrParseResult {
  authors: Map<string, WxrAuthor>;
  /** nicename -> görünen ad. */
  categories: Map<string, string>;
  /** Yalnızca YAZILABİLİR adaylar: `postType ∈ allowedPostTypes` VE `status ∉ {trash, inherit}`. */
  items: WxrItem[];
  /** Etiketli (post_tag/product_tag) en az bir item bulunduysa true — `WP_TAGS_UNSUPPORTED` uyarısı için. */
  hasUnsupportedTags: boolean;
  breakdown: WxrBreakdown;
  /**
   * §10.8.9.1 compliance-agent kararı (2026-08-10) — `shop_order`/`shop_order_refund`/
   * `shop_subscription`/`customer`/`shop_coupon` item'larının SAYISI (PII/ödeme verisi taşıyan
   * item'lar, hiçbir alanı OKUNMAZ/SAKLANMAZ — `applyPostmeta`'ya bile ULAŞMAZLAR). Yalnızca
   * `PRODUCTS` önizlemesinde `WC_ORDERS_IGNORED` agregat uyarısını beslemek için sayılır.
   */
  wcOrdersIgnoredCount: number;
  /** `product_variation` item sayısı — yalnızca `WC_VARIATIONS_UNSUPPORTED` uyarısı için. */
  wcVariationsUnsupportedCount: number;
}

/** Bu ayrıştırıcının item DÜZEYİNDE tanıdığı, gerçek bir hedefi olan post type'lar. */
export type WxrTargetPostType = "post" | "page" | "product";

/**
 * §10.8.9.1 compliance-agent kararı — PII/ödeme verisi taşıyan post type'lar. Bu tipteki
 * item'lar `applyPostmeta`'ya HİÇ ulaşmaz (parse anında, item belleğe tam alınmadan düşürülür,
 * bkz. closetag handler'ındaki erken `return`) — `_billing_*`/`_shipping_*`/`_payment_method`
 * gibi postmeta'lar YAPISAL OLARAK okunmaz.
 */
const PII_POST_TYPES = new Set(["shop_order", "shop_order_refund", "shop_subscription", "customer", "shop_customer", "shop_coupon"]);

const SKIPPED_STATUSES = new Set(["trash", "inherit"]);

interface Frame {
  uri: string;
  local: string;
  attributes: Record<string, SaxesAttributeNS>;
  text: string;
}

function attrValue(attributes: Record<string, SaxesAttributeNS>, name: string): string | null {
  return attributes[name]?.value ?? null;
}

/**
 * `wp:postmeta` içindeki Yoast/RankMath/WooCommerce anahtarlarını alanlara eşler (bkz.
 * ARCHITECTURE.md §10.8.6/§10.8.9 eşleştirme tabloları). **ALLOW-LIST switch deseni** — bu
 * fonksiyon BİLEREK genel bir `key -> value` Map'ine REFAKTÖR EDİLMEZ (compliance-agent kararı,
 * §10.8.9.1): tanınmayan HER meta anahtarı sessizce yok sayılır, hiçbir zaman materyalize
 * edilmez. İLK eşleşen kazanır (bir postta hem Yoast hem RankMath meta'sı olağan değildir ama
 * olursa öngörülebilir olsun diye).
 */
function applyPostmeta(item: WxrItem, key: string | null, value: string | null): void {
  if (!key) return;
  switch (key) {
    case "_thumbnail_id":
      item.thumbnailId = value;
      if (value) item.hasGalleryOrThumbnail = true;
      break;
    case "_product_image_gallery":
      if (value && value.trim()) item.hasGalleryOrThumbnail = true;
      break;
    case "_yoast_wpseo_title":
    case "rank_math_title":
      if (!item.seoTitle) item.seoTitle = value;
      break;
    case "_yoast_wpseo_metadesc":
    case "rank_math_description":
      if (!item.seoDescription) item.seoDescription = value;
      break;
    case "_yoast_wpseo_canonical":
    case "rank_math_canonical_url":
      if (!item.canonicalUrl) item.canonicalUrl = value;
      break;
    case "_yoast_wpseo_meta-robots-noindex":
      if (value === "1") item.noIndex = true;
      break;
    case "rank_math_robots":
      if (value && value.includes("noindex")) item.noIndex = true;
      break;
    case "_yoast_wpseo_opengraph-title":
    case "rank_math_facebook_title":
      if (!item.ogTitle) item.ogTitle = value;
      break;
    case "_yoast_wpseo_opengraph-image":
    case "rank_math_facebook_image":
      if (!item.ogImageUrl) item.ogImageUrl = value;
      break;
    // ---- §10.8.9 WooCommerce (yalnızca postType === "product" item'larında anlamlıdır) ----
    case "_sku":
      item.sku = value && value.trim() ? value.trim() : null;
      break;
    case "_regular_price":
      item.regularPriceRaw = value;
      break;
    case "_sale_price":
      item.salePriceRaw = value;
      break;
    case "_price":
      item.priceRaw = value;
      break;
    case "_manage_stock":
      item.manageStockRaw = value;
      break;
    case "_stock":
      item.stockRaw = value;
      break;
    case "_stock_status":
      item.stockStatusRaw = value;
      break;
    default:
      break;
  }
}

function emptyItem(): WxrItem {
  return {
    postId: null,
    postType: "",
    status: null,
    title: "",
    slugRaw: null,
    contentHtml: "",
    excerpt: null,
    postDateGmt: null,
    postDate: null,
    creatorLogin: null,
    categoryNicename: null,
    categoryName: null,
    tagsFound: false,
    link: null,
    guid: null,
    thumbnailId: null,
    seoTitle: null,
    seoDescription: null,
    canonicalUrl: null,
    ogTitle: null,
    ogImageUrl: null,
    noIndex: false,
    resolvedThumbnailUrl: null,
    sku: null,
    regularPriceRaw: null,
    salePriceRaw: null,
    priceRaw: null,
    manageStockRaw: null,
    stockRaw: null,
    stockStatusRaw: null,
    hasGalleryOrThumbnail: false,
  };
}

export interface ParseWxrOptions {
  /** Bu çalıştırmada `items`'e MATERYALİZE edilecek post type'lar (ör. `WORDPRESS` → `["post","page"]`, `PRODUCTS` → `["product"]`). */
  allowedPostTypes: WxrTargetPostType[];
  /** `IMPORT_RECORD_CAPS[type]` — yalnızca `items.length` (yazılabilir adaylar) üzerinden kontrol edilir. */
  recordCap: number;
}

/**
 * WXR (WordPress eXtended RSS) dosyasını `saxes` ile STREAMING ayrıştırır (bkz.
 * ARCHITECTURE.md §10.8.3/§10.8.6 — DOM'a alınmaz, XXE yapısal olarak imkânsız). Her `<item>`
 * kapanışında yalnızca o item'ın çıkarılmış alanları belleğe eklenir (tüm ham XML DEĞİL).
 *
 * §10.8.9 ile birlikte bu fonksiyon `WORDPRESS` VE `PRODUCTS` tiplerinin TEK ortak giriş
 * noktasıdır (mimar kararı 2A güvenlik maddesi — XXE/derinlik koruması İKİ KEZ YAZILMAZ).
 * `options.allowedPostTypes` hangi post type'ların `items`'e YAZILACAĞINI belirler; `breakdown`
 * ise MOD'DAN BAĞIMSIZ olarak dosyada GERÇEKTEN NE OLDUĞUNU raporlar (bkz. openapi.yaml
 * `ImportJobPreview.breakdown` açıklaması — "type neyi YAZACAĞINI belirler, breakdown dosyada
 * NE OLDUĞUNU anlatır").
 *
 * "İki geçişli" `_thumbnail_id` çözümlemesi (bkz. §10.8.6) burada TEK bir SAX taramasıyla
 * elde edilir: tarama sırasında hem item'lar hem attachment URL sözlüğü toplanır, tarama
 * BİTTİKTEN SONRA (ikinci mantıksal "geçiş") `resolvedThumbnailUrl` her item için doldurulur —
 * dosyayı fiziksel olarak iki kez okumaktan daha verimli, aynı sonucu verir (attachment'ların
 * item'lardan önce mi sonra mı geldiği ÖNEMSİZDİR). Bu çözümleme mod'dan BAĞIMSIZDIR (attachment
 * item'ları her zaman toplanır) — `PRODUCTS` modunda da `_thumbnail_id` → `ogImageUrl` yedek
 * kaynağı için kullanılır (bkz. import.worker.ts::runProductsJob).
 */
export function parseWxr(buffer: Buffer, options: ParseWxrOptions): WxrParseResult {
  assertNoDoctypeOrEntity(buffer);

  const allowedPostTypes = new Set<string>(options.allowedPostTypes);

  const parser = new SaxesParser({ xmlns: true });
  const stack: Frame[] = [];

  const authors = new Map<string, WxrAuthor>();
  const categories = new Map<string, string>();
  const items: WxrItem[] = [];
  const attachmentUrlByPostId = new Map<string, string>();

  const breakdown: WxrBreakdown = { pages: 0, posts: 0, products: 0, attachments: 0, categories: 0, skipped: 0 };
  let hasUnsupportedTags = false;
  let wcOrdersIgnoredCount = 0;
  let wcVariationsUnsupportedCount = 0;

  let currentAuthor: Partial<WxrAuthor> | null = null;
  let currentCategory: { nicename: string | null; name: string | null } | null = null;
  let currentItem: WxrItem | null = null;
  let currentItemCategory: { domain: string | null; nicename: string | null } | null = null;
  let currentPostmetaKey: string | null = null;
  let currentPostmetaValue: string | null = null;
  /**
   * §10.8.9.1 PII kapısı — `true` iken bu `<item>` `shop_order`/`customer`/… türündendir ve
   * postmeta OKUNMAZ (`applyPostmeta` hiç çağrılmaz). `wp:post_type` metin içeriği item'ın
   * İÇİNDE, genelde EN BAŞTA gelir; bu bayrak `post_type` kapanışında set edilir ve item'ın
   * KENDİSİ kapanana kadar postmeta okumayı bloklar. `post_type` geç gelirse (nadir/bozuk
   * export), o ana kadar okunmuş postmeta zaten allow-list'te olduğundan PII TAŞIMAZ — yine de
   * item kapanışında `PII_POST_TYPES` kontrolüyle satır tamamen DÜŞÜRÜLÜR ve hiçbir alanı
   * `items`'e YAZILMAZ.
   */
  let currentItemIsPii = false;

  parser.on("error", (err) => {
    throw err;
  });

  parser.on("opentag", (tag) => {
    stack.push({ uri: tag.uri, local: tag.local, attributes: tag.attributes, text: "" });
    if (stack.length > WXR_MAX_DEPTH) {
      throw new ValidationError("XML iç içe geçme derinliği güvenlik sınırını aşıyor.", {
        file: [`En fazla ${WXR_MAX_DEPTH} seviye iç içe geçmeye izin verilir.`],
      });
    }

    if (tag.uri === "" && tag.local === "item") {
      currentItem = emptyItem();
      currentItemIsPii = false;
    } else if (WP_NS.has(tag.uri) && tag.local === "author") {
      currentAuthor = {};
    } else if (WP_NS.has(tag.uri) && tag.local === "category") {
      currentCategory = { nicename: null, name: null };
    } else if (tag.uri === "" && tag.local === "category" && currentItem) {
      currentItemCategory = { domain: attrValue(tag.attributes, "domain"), nicename: attrValue(tag.attributes, "nicename") };
    }
  });

  parser.on("text", (text) => {
    const top = stack[stack.length - 1];
    if (top) top.text += text;
  });
  parser.on("cdata", (text) => {
    const top = stack[stack.length - 1];
    if (top) top.text += text;
  });

  parser.on("closetag", () => {
    const frame = stack.pop();
    if (!frame) return;
    const parent = stack[stack.length - 1];
    const text = frame.text.trim();
    const inItem = currentItem !== null && parent?.uri === "" && parent?.local === "item";

    // ---- Kanal düzeyi: wp:author sözlüğü ----
    if (WP_NS.has(frame.uri) && frame.local === "author_login" && currentAuthor) {
      currentAuthor.login = text;
      return;
    }
    if (WP_NS.has(frame.uri) && frame.local === "author_email" && currentAuthor) {
      currentAuthor.email = text || null;
      return;
    }
    if (WP_NS.has(frame.uri) && frame.local === "author_display_name" && currentAuthor) {
      currentAuthor.displayName = text || null;
      return;
    }
    if (WP_NS.has(frame.uri) && frame.local === "author" && currentAuthor) {
      if (currentAuthor.login) {
        authors.set(currentAuthor.login, {
          login: currentAuthor.login,
          email: currentAuthor.email ?? null,
          displayName: currentAuthor.displayName ?? null,
        });
      }
      currentAuthor = null;
      return;
    }

    // ---- Kanal düzeyi: wp:category → BlogCategory sözlüğü (wp:category_parent YOK SAYILIR) ----
    if (WP_NS.has(frame.uri) && frame.local === "cat_name" && currentCategory) {
      currentCategory.name = text;
      return;
    }
    if (WP_NS.has(frame.uri) && frame.local === "category_nicename" && currentCategory) {
      currentCategory.nicename = text;
      return;
    }
    if (WP_NS.has(frame.uri) && frame.local === "category" && currentCategory) {
      if (currentCategory.nicename) {
        categories.set(currentCategory.nicename, currentCategory.name ?? currentCategory.nicename);
      }
      currentCategory = null;
      return;
    }

    // ---- Item düzeyi: wp:post_type erken tespiti — PII item'ları için postmeta OKUMAYI durdurur ----
    if (inItem && currentItem && WP_NS.has(frame.uri) && frame.local === "post_type") {
      currentItem.postType = text || "";
      if (PII_POST_TYPES.has(currentItem.postType)) currentItemIsPii = true;
      return;
    }

    // ---- Item düzeyi: wp:postmeta (meta_key/meta_value'nun ebeveyni item DEĞİL, postmeta'dır — `inItem` BURADA KULLANILMAZ) ----
    const inPostmeta = currentItem !== null && parent && WP_NS.has(parent.uri) && parent.local === "postmeta";
    if (WP_NS.has(frame.uri) && frame.local === "meta_key" && inPostmeta) {
      currentPostmetaKey = text;
      return;
    }
    if (WP_NS.has(frame.uri) && frame.local === "meta_value" && inPostmeta) {
      currentPostmetaValue = text;
      return;
    }
    if (WP_NS.has(frame.uri) && frame.local === "postmeta" && currentItem) {
      // §10.8.9.1 PII kapısı — `shop_order` vb. item'larda postmeta ASLA `applyPostmeta`'ya
      // ulaşmaz (`_billing_*`/`_shipping_*`/`_payment_method` yapısal olarak okunmaz).
      if (!currentItemIsPii) applyPostmeta(currentItem, currentPostmetaKey, currentPostmetaValue);
      currentPostmetaKey = null;
      currentPostmetaValue = null;
      return;
    }

    // ---- Item düzeyi: RSS <category domain="category|post_tag|product_cat|product_tag"> — İLK eşleşen kategori kullanılır ----
    // §10.8.9.1 PII kapısı — PII item'larında kategori de OKUNMAZ (savunma derinliği).
    if (frame.uri === "" && frame.local === "category" && currentItem && currentItemCategory) {
      if (currentItemIsPii) {
        currentItemCategory = null;
        return;
      }
      if (currentItemCategory.domain === "category" || currentItemCategory.domain === "product_cat") {
        if (!currentItem.categoryNicename) {
          currentItem.categoryNicename = currentItemCategory.nicename ?? text;
          currentItem.categoryName = text;
        }
      } else if (currentItemCategory.domain === "post_tag" || currentItemCategory.domain === "product_tag") {
        currentItem.tagsFound = true;
        hasUnsupportedTags = true;
      }
      currentItemCategory = null;
      return;
    }

    // ---- Item düzeyi: basit alanlar ----
    // §10.8.9.1 PII kapısı (savunma derinliği) — PII item'larında (`shop_order` vb.) hiçbir
    // basit alan (title/link/guid/tarih …) DA okunmaz; item zaten kapanışta tamamen düşürülür,
    // bu yalnızca "belleğe HİÇ alınmadan düşür" ilkesini harfiyen uygular.
    if (inItem && currentItem && !currentItemIsPii) {
      if (frame.uri === "" && frame.local === "title") currentItem.title = text;
      else if (frame.uri === "" && frame.local === "link") currentItem.link = text || null;
      else if (frame.uri === "" && frame.local === "guid") currentItem.guid = text || null;
      else if (frame.uri === DC_NS && frame.local === "creator") currentItem.creatorLogin = text || null;
      else if (frame.uri === CONTENT_NS && frame.local === "encoded") currentItem.contentHtml = frame.text;
      else if (frame.uri === EXCERPT_NS && frame.local === "encoded") currentItem.excerpt = text || null;
      else if (WP_NS.has(frame.uri) && frame.local === "post_id") currentItem.postId = text || null;
      else if (WP_NS.has(frame.uri) && frame.local === "post_date_gmt") currentItem.postDateGmt = text || null;
      else if (WP_NS.has(frame.uri) && frame.local === "post_date") currentItem.postDate = text || null;
      else if (WP_NS.has(frame.uri) && frame.local === "status") currentItem.status = text || null;
      else if (WP_NS.has(frame.uri) && frame.local === "post_name") currentItem.slugRaw = text || null;
      else if (WP_NS.has(frame.uri) && frame.local === "attachment_url" && currentItem.postType === "attachment") {
        // attachment_url, post_type'tan SONRA gelmeyebilir; postId aşağıda item bitişinde eşlenir.
        (currentItem as WxrItem & { attachmentUrl?: string }).attachmentUrl = text || undefined;
      }
    }

    // ---- <item> kapanışı: sınıflandır + breakdown güncelle ----
    if (frame.uri === "" && frame.local === "item" && currentItem) {
      const item = currentItem;
      const wasPii = currentItemIsPii;
      currentItem = null;
      currentItemIsPii = false;

      // §10.8.9.1 PII kapısı — `shop_order` vb. item'lar burada TAMAMEN düşürülür. `rawData`'ya
      // ASLA yazılmaz (bu fonksiyon zaten hiçbir postmeta'sını okumadı) ve `items`'e HİÇ girmez.
      if (wasPii) {
        breakdown.skipped += 1;
        wcOrdersIgnoredCount += 1;
        return;
      }

      if (item.postType === "attachment") {
        breakdown.attachments += 1;
        const url = (item as WxrItem & { attachmentUrl?: string }).attachmentUrl;
        if (item.postId && url) attachmentUrlByPostId.set(item.postId, url);
        return;
      }

      if (item.postType === "product_variation") {
        breakdown.skipped += 1;
        wcVariationsUnsupportedCount += 1;
        return;
      }

      const isKnownType = item.postType === "post" || item.postType === "page" || item.postType === "product";
      if (!isKnownType) {
        breakdown.skipped += 1;
        return;
      }
      if (item.status && SKIPPED_STATUSES.has(item.status)) {
        breakdown.skipped += 1;
        return;
      }

      if (item.postType === "page") breakdown.pages += 1;
      else if (item.postType === "post") breakdown.posts += 1;
      else breakdown.products += 1;

      if (!allowedPostTypes.has(item.postType)) {
        // Dosyada GERÇEKTEN var ama bu çalıştırma modunda hedeflenmiyor (ör. WORDPRESS modunda
        // `product`) — breakdown'daki ilgili sayaç (pages/posts/products) yine de artırılmış
        // olur (mod-bağımsız "dosyada ne var" raporu), ama `items`'e YAZILMAZ.
        breakdown.skipped += 1;
        return;
      }

      items.push(item);
    }
  });

  try {
    parser.write(buffer.toString("utf8"));
    parser.close();
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError("XML (WXR) dosyası ayrıştırılamadı veya bozuk.", { file: [(err as Error).message] });
  }

  if (items.length > options.recordCap) {
    throw new ValidationError(`Bu içe aktarma türü için en fazla ${options.recordCap} kayıt içe aktarılabilir.`, {
      file: [`${items.length} öğe bulundu.`],
    });
  }

  // İkinci "geçiş": attachment sözlüğü artık tam — _thumbnail_id'leri çöz.
  for (const item of items) {
    if (item.thumbnailId) {
      item.resolvedThumbnailUrl = attachmentUrlByPostId.get(item.thumbnailId) ?? null;
    }
  }

  breakdown.categories = categories.size;

  return { authors, categories, items, hasUnsupportedTags, breakdown, wcOrdersIgnoredCount, wcVariationsUnsupportedCount };
}
