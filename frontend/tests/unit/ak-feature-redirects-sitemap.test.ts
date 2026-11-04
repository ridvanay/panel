import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Locale, SitePage, Specialty } from "@/lib/api/types";
import { featureRedirectPath, matchFeatureGatedPath } from "@/lib/i18n/feature-gated-path";
import { buildSection, type SitemapData } from "@/lib/sitemap/build";
import { buildLlmsTxt } from "@/lib/seo/llms";

/**
 * Paket AK (K4) — kapatılan özelliklerin adresleri: proxy'de 302 (`/find-your-treatment` → `/specialties`;
 * `/book-consultation` → `/request`, `manage` HARİÇ, sorgu korunur, ayar okunamazsa yönlendirme yok); sitemap/llms.
 */
const LOCALES = [
  { code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "de", label: "German", nativeLabel: "Deutsch", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
  { code: "ar", label: "Arabic", nativeLabel: "Arabic", isDefault: false, enabled: true, sortOrder: 2, hreflang: null },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(settings: unknown | "error" | "network") {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/locales")) return Promise.resolve(json({ data: LOCALES }));
    if (url.includes("/appearance")) return Promise.resolve(json({ data: { maintenanceModeEnabled: false } }));
    if (url.includes("/settings")) {
      if (settings === "network") return Promise.reject(new Error("down"));
      if (settings === "error") return Promise.resolve(json({ error: "x" }, 503));
      return Promise.resolve(json({ data: settings }));
    }
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));
const FIND_OFF = { findTreatmentEnabled: false, bookConsultationCtaEnabled: true };
const BOOK_OFF = { findTreatmentEnabled: true, bookConsultationCtaEnabled: false };
const ON = { findTreatmentEnabled: true, bookConsultationCtaEnabled: true };

describe("feature-gated-path (saf yardımcı)", () => {
  const codes = new Set(["en", "de", "ar"]);

  it("eşleşme: find-your-treatment ve book-consultation (alt yollarıyla); manage hariç; bilinmeyen dil öneki hariç", () => {
    expect(matchFeatureGatedPath("/find-your-treatment", codes)).toEqual({ kind: "find-treatment", locale: null });
    expect(matchFeatureGatedPath("/de/find-your-treatment/", codes)).toEqual({ kind: "find-treatment", locale: "de" });
    expect(matchFeatureGatedPath("/de/book-consultation", codes)).toEqual({ kind: "book-consultation", locale: "de" });
    expect(matchFeatureGatedPath("/book-consultation/anything", codes)?.kind).toBe("book-consultation");
    expect(matchFeatureGatedPath("/book-consultation/manage", codes)).toBeNull();
    expect(matchFeatureGatedPath("/de/book-consultation/manage", codes)).toBeNull();
    expect(matchFeatureGatedPath("/xx/book-consultation", codes)).toBeNull();
    expect(matchFeatureGatedPath("/book", codes)).toBeNull();
    expect(matchFeatureGatedPath("/about", codes)).toBeNull();
  });

  it("hedef: varsayılan dilin öneki düşer; açıkken null", () => {
    const find = matchFeatureGatedPath("/en/find-your-treatment", codes)!;
    expect(featureRedirectPath(find, FIND_OFF, "en")).toBe("/specialties");
    expect(featureRedirectPath(find, ON, "en")).toBeNull();
    const book = matchFeatureGatedPath("/ar/book-consultation", codes)!;
    expect(featureRedirectPath(book, BOOK_OFF, "en")).toBe("/ar/request");
    expect(featureRedirectPath(book, FIND_OFF, "en")).toBeNull();
  });
});

describe("proxy — kapatılan özellik adresleri 302", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["/find-your-treatment", "/specialties"],
    ["/de/find-your-treatment", "/de/specialties"],
    ["/ar/find-your-treatment", "/ar/specialties"],
  ])("findTreatmentEnabled=false: %s -> %s", async (from, to) => {
    stubFetch(FIND_OFF);
    const { proxy } = await import("@/proxy");
    const res = await proxy(req(from));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).pathname).toBe(to);
  });

  it.each([
    ["/book-consultation", "/request"],
    ["/de/book-consultation", "/de/request"],
    ["/ar/book-consultation", "/ar/request"],
  ])("bookConsultationCtaEnabled=false: %s -> %s", async (from, to) => {
    stubFetch(BOOK_OFF);
    const { proxy } = await import("@/proxy");
    const res = await proxy(req(from));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).pathname).toBe(to);
  });

  it("sorgu dizesi korunur (service / package)", async () => {
    stubFetch(BOOK_OFF);
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/de/book-consultation?service=dental&package=smile"));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/de/request");
    expect(location.searchParams.get("service")).toBe("dental");
    expect(location.searchParams.get("package")).toBe("smile");
  });

  it("manage HARİÇ: /book-consultation/manage yönlendirilmez (mevcut randevu bağlantısı çalışır)", async () => {
    stubFetch({ ...BOOK_OFF, findTreatmentEnabled: false });
    const { proxy } = await import("@/proxy");
    for (const path of ["/book-consultation/manage", "/de/book-consultation/manage"]) {
      const res = await proxy(req(path));
      expect(res.status).not.toBe(302);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("açıkken yönlendirme yok", async () => {
    stubFetch(ON);
    const { proxy } = await import("@/proxy");
    for (const path of ["/find-your-treatment", "/de/book-consultation"]) {
      const res = await proxy(req(path));
      expect(res.status).not.toBe(302);
    }
  });

  it("ayar okunamazsa (5xx / ağ hatası / alan yok) yönlendirme YOK", async () => {
    for (const settings of ["error", "network", {}] as const) {
      vi.resetModules();
      stubFetch(settings);
      const { proxy } = await import("@/proxy");
      for (const path of ["/find-your-treatment", "/book-consultation"]) {
        const res = await proxy(req(path));
        expect(res.status, `${settings} ${path}`).not.toBe(302);
      }
    }
  });

  it("ilgisiz yollarda /settings okunmaz (ek istek yok)", async () => {
    const fetchMock = stubFetch(FIND_OFF);
    const { proxy } = await import("@/proxy");
    await proxy(req("/about"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings"))).toBe(false);
  });
});

describe("sitemap ve llms.txt", () => {
  const SITE = "https://wmhealthistanbul.com";
  const locales: Locale[] = [{ code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: "en-US" }];
  const data = (features?: SitemapData["features"]): SitemapData & { siteName: string } => ({
    siteUrl: SITE,
    siteName: "WM Health",
    locales,
    homePageId: null,
    pages: [] as SitePage[],
    doctors: [],
    specialties: [{ slug: "dental", name: "Dental Care", description: "Dental treatments.", isActive: true, order: 1 } as unknown as Specialty],
    posts: [],
    products: [],
    portfolio: [],
    ...(features ? { features } : {}),
  });

  it("açık (ya da alan yok): /find-your-treatment sitemap'te ve llms.txt'te", () => {
    for (const d of [data(), data(ON)]) {
      expect(buildSection("specialties", d).map((e) => e.loc)).toContain(`${SITE}/find-your-treatment`);
      expect(buildLlmsTxt(d)).toContain("[Find your treatment]");
    }
  });

  it("findTreatmentEnabled=false: sitemap'ten ve llms.txt'ten (iki yerden) çıkar; /specialties kalır", () => {
    const d = data(FIND_OFF);
    const locs = buildSection("specialties", d).map((e) => e.loc);
    expect(locs).not.toContain(`${SITE}/find-your-treatment`);
    expect(locs).toContain(`${SITE}/specialties`);
    const llms = buildLlmsTxt(d);
    expect(llms).not.toContain("find-your-treatment");
    expect(llms).not.toContain("Find your treatment");
    expect(llms).toContain("1. Choose a service: [Health Tourism Services]");
  });

  it("/book-consultation sitemap'te hiç yok (noindex sayfa); Book anahtarı sitemap'i etkilemez", () => {
    const locs = buildSection("pages", data(BOOK_OFF)).map((e) => e.loc);
    expect(locs.some((l) => l.includes("book-consultation"))).toBe(false);
    expect(locs).toContain(`${SITE}/request`);
  });
});
