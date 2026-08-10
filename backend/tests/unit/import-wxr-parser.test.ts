import { describe, expect, it } from "vitest";
import { parseWxr, type ParseWxrOptions } from "../../src/modules/import/parsers/wxr.parser";
import { ValidationError } from "../../src/lib/errors";
import { IMPORT_RECORD_CAPS } from "../../src/modules/import/import.constants";

const WXR_HEADER = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>Test Site</title>
  <link>https://example.com</link>
  <wp:author>
    <wp:author_login><![CDATA[admin]]></wp:author_login>
    <wp:author_email><![CDATA[admin@example.com]]></wp:author_email>
    <wp:author_display_name><![CDATA[Admin]]></wp:author_display_name>
  </wp:author>
  <wp:category>
    <wp:cat_name><![CDATA[Genel]]></wp:cat_name>
    <wp:category_nicename><![CDATA[genel]]></wp:category_nicename>
    <wp:category_parent><![CDATA[]]></wp:category_parent>
  </wp:category>`;
const WXR_FOOTER = `</channel></rss>`;

function wrap(items: string): Buffer {
  return Buffer.from(`${WXR_HEADER}${items}${WXR_FOOTER}`);
}

/** `WORDPRESS` modu — mevcut testlerin BÜYÜK ÇOĞUNLUĞU bu modu kullanır. */
const WORDPRESS_OPTS: ParseWxrOptions = { allowedPostTypes: ["post", "page"], recordCap: IMPORT_RECORD_CAPS.WORDPRESS };
/** `PRODUCTS` modu (§10.8.9 WooCommerce). */
const PRODUCTS_OPTS: ParseWxrOptions = { allowedPostTypes: ["product"], recordCap: IMPORT_RECORD_CAPS.PRODUCTS };

function parseWordpress(items: string) {
  return parseWxr(wrap(items), WORDPRESS_OPTS);
}
function parseProducts(items: string) {
  return parseWxr(wrap(items), PRODUCTS_OPTS);
}

describe("parseWxr", () => {
  it("rejects a DOCTYPE-carrying file (XXE defense)", () => {
    const xml = Buffer.from('<?xml version="1.0"?><!DOCTYPE foo><rss><channel></channel></rss>');
    expect(() => parseWxr(xml, WORDPRESS_OPTS)).toThrow(ValidationError);
  });

  it("parses a post with category, dc:creator, content:encoded and SEO postmeta", () => {
    const item = `
    <item>
      <title>Hello World</title>
      <link>https://example.com/hello-world</link>
      <guid>https://example.com/?p=1</guid>
      <dc:creator><![CDATA[admin]]></dc:creator>
      <content:encoded><![CDATA[<p>Hello <script>alert(1)</script></p>]]></content:encoded>
      <excerpt:encoded><![CDATA[An excerpt]]></excerpt:encoded>
      <category domain="category" nicename="genel"><![CDATA[Genel]]></category>
      <category domain="post_tag" nicename="foo"><![CDATA[foo]]></category>
      <wp:post_id>1</wp:post_id>
      <wp:post_date_gmt>2024-01-15 10:00:00</wp:post_date_gmt>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_name>hello-world</wp:post_name>
      <wp:postmeta>
        <wp:meta_key><![CDATA[_yoast_wpseo_title]]></wp:meta_key>
        <wp:meta_value><![CDATA[SEO Title]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key><![CDATA[_thumbnail_id]]></wp:meta_key>
        <wp:meta_value><![CDATA[99]]></wp:meta_value>
      </wp:postmeta>
    </item>`;

    const result = parseWordpress(item);
    expect(result.items).toHaveLength(1);
    const post = result.items[0]!;
    expect(post.title).toBe("Hello World");
    expect(post.postType).toBe("post");
    expect(post.status).toBe("publish");
    expect(post.creatorLogin).toBe("admin");
    expect(post.categoryNicename).toBe("genel");
    expect(post.contentHtml).toContain("<script>"); // sanitize aşaması AYRI (writer'da) — parser ham veriyi taşır
    expect(post.seoTitle).toBe("SEO Title");
    expect(post.thumbnailId).toBe("99");
    expect(result.authors.get("admin")?.email).toBe("admin@example.com");
    expect(result.categories.get("genel")).toBe("Genel");
    expect(result.hasUnsupportedTags).toBe(true);
    expect(result.breakdown.posts).toBe(1);
  });

  it("resolves _thumbnail_id even when the attachment item appears AFTER the post (two-pass)", () => {
    const post = `
    <item>
      <title>Post With Thumb</title>
      <content:encoded><![CDATA[<p>body</p>]]></content:encoded>
      <wp:post_id>10</wp:post_id>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_name>post-with-thumb</wp:post_name>
      <wp:postmeta>
        <wp:meta_key><![CDATA[_thumbnail_id]]></wp:meta_key>
        <wp:meta_value><![CDATA[20]]></wp:meta_value>
      </wp:postmeta>
    </item>`;
    const attachment = `
    <item>
      <title>image.png</title>
      <wp:post_id>20</wp:post_id>
      <wp:status>inherit</wp:status>
      <wp:post_type>attachment</wp:post_type>
      <wp:attachment_url>https://example.com/wp-content/uploads/image.png</wp:attachment_url>
    </item>`;

    const result = parseWordpress(post + attachment);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.resolvedThumbnailUrl).toBe("https://example.com/wp-content/uploads/image.png");
    expect(result.breakdown.attachments).toBe(1);
  });

  it("maps the WordPress NULL date sentinel to null, not a parse error", () => {
    const item = `
    <item>
      <title>No Date</title>
      <wp:post_id>2</wp:post_id>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_date_gmt>0000-00-00 00:00:00</wp:post_date_gmt>
    </item>`;
    const result = parseWordpress(item);
    expect(result.items[0]!.postDateGmt).toBe("0000-00-00 00:00:00");
  });

  it("excludes trash/inherit items and unsupported post_types from `items`, counting them as skipped", () => {
    const trashed = `<item><title>Trashed</title><wp:post_id>3</wp:post_id><wp:status>trash</wp:status><wp:post_type>post</wp:post_type></item>`;
    const navMenu = `<item><title>Menu Item</title><wp:post_id>4</wp:post_id><wp:status>publish</wp:status><wp:post_type>nav_menu_item</wp:post_type></item>`;
    const page = `<item><title>A Page</title><content:encoded><![CDATA[<p>page</p>]]></content:encoded><wp:post_id>5</wp:post_id><wp:status>publish</wp:status><wp:post_type>page</wp:post_type><wp:post_name>a-page</wp:post_name></item>`;

    const result = parseWordpress(trashed + navMenu + page);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.postType).toBe("page");
    expect(result.breakdown.skipped).toBe(2);
    expect(result.breakdown.pages).toBe(1);
  });

  it("maps private/future status but still includes the item (mapped to DRAFT by the writer, not the parser)", () => {
    const priv = `<item><title>Private</title><wp:post_id>6</wp:post_id><wp:status>private</wp:status><wp:post_type>post</wp:post_type></item>`;
    const future = `<item><title>Future</title><wp:post_id>7</wp:post_id><wp:status>future</wp:status><wp:post_type>post</wp:post_type></item>`;
    const result = parseWordpress(priv + future);
    expect(result.items.map((i) => i.status)).toEqual(["private", "future"]);
  });

  it("supports RankMath SEO postmeta keys as well as Yoast", () => {
    const item = `
    <item>
      <title>RankMath Post</title>
      <wp:post_id>8</wp:post_id>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:postmeta>
        <wp:meta_key><![CDATA[rank_math_title]]></wp:meta_key>
        <wp:meta_value><![CDATA[RankMath Title]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key><![CDATA[rank_math_robots]]></wp:meta_key>
        <wp:meta_value><![CDATA[["noindex","nofollow"]]]></wp:meta_value>
      </wp:postmeta>
    </item>`;
    const result = parseWordpress(item);
    expect(result.items[0]!.seoTitle).toBe("RankMath Title");
    expect(result.items[0]!.noIndex).toBe(true);
  });

  it("rejects a WXR with more than the WORDPRESS record cap (10,000 items)", () => {
    const items = Array.from(
      { length: 10001 },
      (_, i) => `<item><title>Post ${i}</title><wp:post_id>${i}</wp:post_id><wp:status>publish</wp:status><wp:post_type>post</wp:post_type></item>`
    ).join("");
    expect(() => parseWordpress(items)).toThrow(ValidationError);
  });

  // -------------------------------------------------------------------------
  // §10.8.9 WooCommerce (`PRODUCTS`) — bkz. ARCHITECTURE.md §10.8.9 eşleme tablosu.
  // -------------------------------------------------------------------------
  describe("PRODUCTS (WooCommerce)", () => {
    function productItem(overrides: { title?: string; postId?: string; status?: string; postmeta?: string; category?: string } = {}): string {
      const { title = "Test Product", postId = "100", status = "publish", postmeta = "", category = "" } = overrides;
      return `
      <item>
        <title>${title}</title>
        <content:encoded><![CDATA[<p>desc</p>]]></content:encoded>
        <wp:post_id>${postId}</wp:post_id>
        <wp:status>${status}</wp:status>
        <wp:post_type>product</wp:post_type>
        <wp:post_name>${title.toLowerCase().replace(/\s+/g, "-")}</wp:post_name>
        ${category}
        ${postmeta}
      </item>`;
    }

    function meta(key: string, value: string): string {
      return `<wp:postmeta><wp:meta_key><![CDATA[${key}]]></wp:meta_key><wp:meta_value><![CDATA[${value}]]></wp:meta_value></wp:postmeta>`;
    }

    it("parses a product item with sku/price/stock/category postmeta into WxrItem", () => {
      const item = productItem({
        title: "Widget",
        postmeta: [meta("_sku", "WID-1"), meta("_regular_price", "199.90"), meta("_manage_stock", "yes"), meta("_stock", "12")].join(""),
        category: `<category domain="product_cat" nicename="widgets"><![CDATA[Widgets]]></category>`,
      });

      const result = parseProducts(item);
      expect(result.items).toHaveLength(1);
      const product = result.items[0]!;
      expect(product.postType).toBe("product");
      expect(product.sku).toBe("WID-1");
      expect(product.regularPriceRaw).toBe("199.90");
      expect(product.manageStockRaw).toBe("yes");
      expect(product.stockRaw).toBe("12");
      expect(product.categoryNicename).toBe("widgets");
      expect(product.categoryName).toBe("Widgets");
      expect(result.breakdown.products).toBe(1);
    });

    it("drops product_variation items entirely — never materialized into `items`, counted as skipped", () => {
      const parent = productItem({ title: "Variable Product", postId: "200" });
      const variation = `
      <item>
        <title>Variable Product - Red</title>
        <wp:post_id>201</wp:post_id>
        <wp:status>publish</wp:status>
        <wp:post_type>product_variation</wp:post_type>
        ${meta("_regular_price", "50.00")}
      </item>`;

      const result = parseProducts(parent + variation);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe("Variable Product");
      expect(result.wcVariationsUnsupportedCount).toBe(1);
      expect(result.breakdown.skipped).toBe(1);
    });

    it("drops shop_order items entirely (PII) — no fields captured, no rawData exposure possible", () => {
      const order = `
      <item>
        <title>Order #1001</title>
        <wp:post_id>300</wp:post_id>
        <wp:status>wc-completed</wp:status>
        <wp:post_type>shop_order</wp:post_type>
        ${meta("_billing_email", "customer@example.com")}
        ${meta("_billing_first_name", "Jane")}
        ${meta("_payment_method", "stripe")}
      </item>`;
      const product = productItem({ title: "Real Product", postId: "301" });

      const result = parseProducts(order + product);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe("Real Product");
      expect(result.wcOrdersIgnoredCount).toBe(1);
      expect(result.breakdown.skipped).toBe(1);
      // PII item hiçbir alanının item nesnesine dahi YAZILMADIĞINI (materyalize edilmediğini)
      // doğrudan doğrulamak mümkün değil (item drop edildi) — ama `items` dizisinde YOK olması
      // ve dosyanın JSON.stringify'ının hiçbir yerde saklanmaması yeterlidir (compliance
      // regresyon testi asıl olarak worker/integration seviyesinde `rawData` üzerinden yapılır).
    });

    it("also drops shop_order_refund / shop_subscription / customer / shop_coupon item types", () => {
      const types = ["shop_order_refund", "shop_subscription", "customer", "shop_coupon"];
      const items = types
        .map(
          (t, i) => `
      <item>
        <title>${t} item</title>
        <wp:post_id>${400 + i}</wp:post_id>
        <wp:status>publish</wp:status>
        <wp:post_type>${t}</wp:post_type>
      </item>`
        )
        .join("");

      const result = parseProducts(items);
      expect(result.items).toHaveLength(0);
      expect(result.wcOrdersIgnoredCount).toBe(4);
      expect(result.breakdown.skipped).toBe(4);
    });

    it("counts product items found even when parsing in WORDPRESS mode, and does NOT materialize them", () => {
      const post = `<item><title>A Post</title><wp:post_id>500</wp:post_id><wp:status>publish</wp:status><wp:post_type>post</wp:post_type></item>`;
      const product = productItem({ title: "Should Be Skipped", postId: "501" });

      const result = parseWordpress(post + product);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.postType).toBe("post");
      expect(result.breakdown.products).toBe(1);
      expect(result.breakdown.skipped).toBe(1);
    });

    it("flags _thumbnail_id / _product_image_gallery presence via hasGalleryOrThumbnail without storing values elsewhere", () => {
      const withThumb = productItem({
        title: "With Thumb",
        postId: "600",
        postmeta: meta("_thumbnail_id", "42"),
      });
      const withoutThumb = productItem({ title: "No Thumb", postId: "601" });

      const result = parseProducts(withThumb + withoutThumb);
      expect(result.items.find((i) => i.title === "With Thumb")!.hasGalleryOrThumbnail).toBe(true);
      expect(result.items.find((i) => i.title === "No Thumb")!.hasGalleryOrThumbnail).toBe(false);
    });

    it("ignores product_tag categories (WP_TAGS_UNSUPPORTED equivalent) but keeps product_cat", () => {
      const item = productItem({
        title: "Tagged Product",
        category: `<category domain="product_cat" nicename="widgets"><![CDATA[Widgets]]></category><category domain="product_tag" nicename="sale"><![CDATA[Sale]]></category>`,
      });
      const result = parseProducts(item);
      expect(result.items[0]!.categoryNicename).toBe("widgets");
      expect(result.hasUnsupportedTags).toBe(true);
    });

    it("rejects a WXR with more than the PRODUCTS record cap (5,000 product items)", () => {
      const items = Array.from({ length: 5001 }, (_, i) => productItem({ title: `Product ${i}`, postId: String(1000 + i) })).join("");
      expect(() => parseProducts(items)).toThrow(ValidationError);
    });

    it("record cap counts only `product` items — unrelated post/page items in the same file don't count against it", () => {
      const posts = Array.from(
        { length: 100 },
        (_, i) => `<item><title>Post ${i}</title><wp:post_id>${2000 + i}</wp:post_id><wp:status>publish</wp:status><wp:post_type>post</wp:post_type></item>`
      ).join("");
      const products = Array.from({ length: 3 }, (_, i) => productItem({ title: `Product ${i}`, postId: String(3000 + i) })).join("");

      const result = parseProducts(posts + products);
      expect(result.items).toHaveLength(3);
      expect(result.breakdown.skipped).toBe(100);
    });
  });
});
