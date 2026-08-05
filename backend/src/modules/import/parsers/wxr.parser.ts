import { SaxesParser, type SaxesAttributeNS } from "saxes";
import { ValidationError } from "../../../lib/errors";
import { IMPORT_RECORD_CAPS, WXR_MAX_DEPTH } from "../import.constants";
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
}

export interface WxrBreakdown {
  pages: number;
  posts: number;
  attachments: number;
  categories: number;
  skipped: number;
}

export interface WxrParseResult {
  authors: Map<string, WxrAuthor>;
  /** nicename -> görünen ad. */
  categories: Map<string, string>;
  /** Yalnızca YAZILABİLİR adaylar: post_type ∈ {post, page} VE status ∉ {trash, inherit}. */
  items: WxrItem[];
  /** Etiketli (post_tag) en az bir item bulunduysa true — `WP_TAGS_UNSUPPORTED` uyarısı için. */
  hasUnsupportedTags: boolean;
  breakdown: WxrBreakdown;
}

const SUPPORTED_ITEM_POST_TYPES = new Set(["post", "page"]);
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
 * `wp:postmeta` içindeki Yoast/RankMath anahtarlarını SEO alanlarına eşler (bkz.
 * ARCHITECTURE.md §10.8.6 eşleştirme tablosu — Yoast VE RankMath'in İKİSİ de desteklenir).
 * İLK eşleşen kazanır (bir postta hem Yoast hem RankMath meta'sı olağan değildir ama olursa
 * öngörülebilir olsun diye).
 */
function applyPostmeta(item: WxrItem, key: string | null, value: string | null): void {
  if (!key) return;
  switch (key) {
    case "_thumbnail_id":
      item.thumbnailId = value;
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
  };
}

/**
 * WXR (WordPress eXtended RSS) dosyasını `saxes` ile STREAMING ayrıştırır (bkz.
 * ARCHITECTURE.md §10.8.3/§10.8.6 — DOM'a alınmaz, XXE yapısal olarak imkânsız). Her `<item>`
 * kapanışında yalnızca o item'ın çıkarılmış alanları belleğe eklenir (tüm ham XML DEĞİL).
 *
 * "İki geçişli" `_thumbnail_id` çözümlemesi (bkz. §10.8.6) burada TEK bir SAX taramasıyla
 * elde edilir: tarama sırasında hem item'lar hem attachment URL sözlüğü toplanır, tarama
 * BİTTİKTEN SONRA (ikinci mantıksal "geçiş") `resolvedThumbnailUrl` her item için doldurulur —
 * dosyayı fiziksel olarak iki kez okumaktan daha verimli, aynı sonucu verir (attachment'ların
 * item'lardan önce mi sonra mı geldiği ÖNEMSİZDİR).
 */
export function parseWxr(buffer: Buffer): WxrParseResult {
  assertNoDoctypeOrEntity(buffer);

  const parser = new SaxesParser({ xmlns: true });
  const stack: Frame[] = [];

  const authors = new Map<string, WxrAuthor>();
  const categories = new Map<string, string>();
  const items: WxrItem[] = [];
  const attachmentUrlByPostId = new Map<string, string>();

  const breakdown: WxrBreakdown = { pages: 0, posts: 0, attachments: 0, categories: 0, skipped: 0 };
  let hasUnsupportedTags = false;

  let currentAuthor: Partial<WxrAuthor> | null = null;
  let currentCategory: { nicename: string | null; name: string | null } | null = null;
  let currentItem: WxrItem | null = null;
  let currentItemCategory: { domain: string | null; nicename: string | null } | null = null;
  let currentPostmetaKey: string | null = null;
  let currentPostmetaValue: string | null = null;

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
      applyPostmeta(currentItem, currentPostmetaKey, currentPostmetaValue);
      currentPostmetaKey = null;
      currentPostmetaValue = null;
      return;
    }

    // ---- Item düzeyi: RSS <category domain="category|post_tag"> — İLK eşleşen kategori kullanılır ----
    if (frame.uri === "" && frame.local === "category" && currentItem && currentItemCategory) {
      if (currentItemCategory.domain === "category") {
        if (!currentItem.categoryNicename) {
          currentItem.categoryNicename = currentItemCategory.nicename ?? text;
          currentItem.categoryName = text;
        }
      } else if (currentItemCategory.domain === "post_tag") {
        currentItem.tagsFound = true;
        hasUnsupportedTags = true;
      }
      currentItemCategory = null;
      return;
    }

    // ---- Item düzeyi: basit alanlar ----
    if (inItem && currentItem) {
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
      else if (WP_NS.has(frame.uri) && frame.local === "post_type") currentItem.postType = text || "";
      else if (WP_NS.has(frame.uri) && frame.local === "post_name") currentItem.slugRaw = text || null;
      else if (WP_NS.has(frame.uri) && frame.local === "attachment_url" && currentItem.postType === "attachment") {
        // attachment_url, post_type'tan SONRA gelmeyebilir; postId aşağıda item bitişinde eşlenir.
        (currentItem as WxrItem & { attachmentUrl?: string }).attachmentUrl = text || undefined;
      }
    }

    // ---- <item> kapanışı: sınıflandır + breakdown güncelle ----
    if (frame.uri === "" && frame.local === "item" && currentItem) {
      const item = currentItem;
      currentItem = null;

      if (item.postType === "attachment") {
        breakdown.attachments += 1;
        const url = (item as WxrItem & { attachmentUrl?: string }).attachmentUrl;
        if (item.postId && url) attachmentUrlByPostId.set(item.postId, url);
        return;
      }

      if (!SUPPORTED_ITEM_POST_TYPES.has(item.postType)) {
        breakdown.skipped += 1;
        return;
      }
      if (item.status && SKIPPED_STATUSES.has(item.status)) {
        breakdown.skipped += 1;
        return;
      }

      if (item.postType === "page") breakdown.pages += 1;
      else breakdown.posts += 1;

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

  if (items.length > IMPORT_RECORD_CAPS.WORDPRESS) {
    throw new ValidationError(`WXR dosyasında en fazla ${IMPORT_RECORD_CAPS.WORDPRESS} öğe içe aktarılabilir.`, {
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

  return { authors, categories, items, hasUnsupportedTags, breakdown };
}
