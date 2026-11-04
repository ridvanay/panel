import { describe, expect, it } from "vitest";
import { TOKEN_PAGE_PATHS, tokenPageHeaderRules } from "@/lib/seo/preview-headers";

describe("Paket AL — belirteç taşıyan sayfalarda Referrer-Policy", () => {
  const rules = tokenPageHeaderRules();

  it("her belirteçli yol için dil önekli ve önek-siz kural üretir, başlık no-referrer", () => {
    expect(rules).toHaveLength(TOKEN_PAGE_PATHS.length * 2);
    for (const rule of rules) {
      expect(rule.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
  });

  it("sıfırlama, davet, görüşme, randevu, yorum, misafir toplantı ve yönetim sayfalarını kapsar", () => {
    const sources = rules.map((r) => r.source);
    for (const path of ["/reset-password", "/invitations/:path*", "/consultation/:path*", "/patient/bookings/:path*", "/review/:path*", "/meet/:path*", "/book-consultation/manage"]) {
      expect(sources).toContain(path);
      expect(sources.some((s) => s.endsWith(path) && s.startsWith("/:lang("))).toBe(true);
    }
  });

  it("herkese açık sayfalara (blog, ürünler, ana sayfa) başlık eklemez", () => {
    const sources = rules.map((r) => r.source).join(" ");
    expect(sources).not.toMatch(/\/blog(?!\/preview)|\/products|\/about/);
  });
});

describe("Paket AL — next.config headers() kuralları bağlar", () => {
  it("belirteçli yollar için Referrer-Policy: no-referrer kuralı yapılandırmada yer alır", async () => {
    const mod = await import("../../next.config");
    const config = mod.default as { headers?: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const rules = await config.headers!();
    const noRef = rules.filter((r) => r.headers.some((h) => h.key === "Referrer-Policy" && h.value === "no-referrer")).map((r) => r.source);
    for (const path of ["/reset-password", "/invitations/:path*", "/consultation/:path*", "/patient/bookings/:path*", "/review/:path*", "/meet/:path*", "/book-consultation/manage", "/blog/preview/:postId"]) {
      expect(noRef, path).toContain(path);
    }
  });
});
