import { describe, expect, it } from "vitest";
import { parseWxr } from "../../src/modules/import/parsers/wxr.parser";
import { ValidationError } from "../../src/lib/errors";

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

describe("parseWxr", () => {
  it("rejects a DOCTYPE-carrying file (XXE defense)", () => {
    const xml = Buffer.from('<?xml version="1.0"?><!DOCTYPE foo><rss><channel></channel></rss>');
    expect(() => parseWxr(xml)).toThrow(ValidationError);
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

    const result = parseWxr(wrap(item));
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

    const result = parseWxr(wrap(post + attachment));
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
    const result = parseWxr(wrap(item));
    expect(result.items[0]!.postDateGmt).toBe("0000-00-00 00:00:00");
  });

  it("excludes trash/inherit items and unsupported post_types from `items`, counting them as skipped", () => {
    const trashed = `<item><title>Trashed</title><wp:post_id>3</wp:post_id><wp:status>trash</wp:status><wp:post_type>post</wp:post_type></item>`;
    const navMenu = `<item><title>Menu Item</title><wp:post_id>4</wp:post_id><wp:status>publish</wp:status><wp:post_type>nav_menu_item</wp:post_type></item>`;
    const page = `<item><title>A Page</title><content:encoded><![CDATA[<p>page</p>]]></content:encoded><wp:post_id>5</wp:post_id><wp:status>publish</wp:status><wp:post_type>page</wp:post_type><wp:post_name>a-page</wp:post_name></item>`;

    const result = parseWxr(wrap(trashed + navMenu + page));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.postType).toBe("page");
    expect(result.breakdown.skipped).toBe(2);
    expect(result.breakdown.pages).toBe(1);
  });

  it("maps private/future status but still includes the item (mapped to DRAFT by the writer, not the parser)", () => {
    const priv = `<item><title>Private</title><wp:post_id>6</wp:post_id><wp:status>private</wp:status><wp:post_type>post</wp:post_type></item>`;
    const future = `<item><title>Future</title><wp:post_id>7</wp:post_id><wp:status>future</wp:status><wp:post_type>post</wp:post_type></item>`;
    const result = parseWxr(wrap(priv + future));
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
    const result = parseWxr(wrap(item));
    expect(result.items[0]!.seoTitle).toBe("RankMath Title");
    expect(result.items[0]!.noIndex).toBe(true);
  });

  it("rejects a WXR with more than the WORDPRESS record cap (10,000 items)", () => {
    const items = Array.from(
      { length: 10001 },
      (_, i) => `<item><title>Post ${i}</title><wp:post_id>${i}</wp:post_id><wp:status>publish</wp:status><wp:post_type>post</wp:post_type></item>`
    ).join("");
    expect(() => parseWxr(wrap(items))).toThrow(ValidationError);
  });
});
