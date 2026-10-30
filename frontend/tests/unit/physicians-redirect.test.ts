import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { canonicalSitePath, isPhysiciansListHref, legacyPhysiciansPath } from "@/lib/i18n/physicians-path";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { linkAttrs } from "@/lib/page-builder/link-attrs";

/**
 * Paket V (İş 1) — `/doctors` → `/physicians`: eski adresler (9 dil, liste ve profil, sorgu dizesi
 * korunarak) 301 ile yeni adrese gider; yönlendirme aynı origin'de kalır (açık yönlendirme yok);
 * panelden girilmiş eski bağlantılar render anında yeni yola çevrilir.
 */
const CODES = ["tr", "en", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"];
const LOCALES = CODES.map((code, i) => ({ code, label: code, nativeLabel: code, isDefault: code === "tr", enabled: true, sortOrder: i, hreflang: null }));

describe("legacyPhysiciansPath / canonicalSitePath", () => {
  it("varsayılan dil öneki (/tr) doğrudan öneksiz yola; diğer diller önekini korur", () => {
    expect(legacyPhysiciansPath("/doctors", "tr")).toBe("/physicians");
    expect(legacyPhysiciansPath("/tr/doctors/hakan-sofu", "tr")).toBe("/physicians/hakan-sofu");
    expect(legacyPhysiciansPath("/sr-latn/doctors/", "tr")).toBe("/sr-latn/physicians");
  });

  it.each(["/doctor", "/doctor/earnings", "/doctors-x", "/doctors/a/b", "/physicians", "/en/doctor", "//evil.com/doctors", "/doctors//evil.com"])(
    "%s yönlendirilmez",
    (path) => {
      expect(legacyPhysiciansPath(path, "tr")).toBeNull();
    }
  );

  it("kapalı dil öneki yönlendirilmez", () => {
    expect(legacyPhysiciansPath("/it/doctors", "tr", new Set(["tr", "en"]))).toBeNull();
    expect(legacyPhysiciansPath("/en/doctors", "tr", new Set(["tr", "en"]))).toBe("/en/physicians");
  });

  it("panelden gelen eski bağlantılar yeni yola çevrilir (menü, CTA, blok bağlantısı)", () => {
    expect(canonicalSitePath("/doctors?specialty=x")).toBe("/physicians?specialty=x");
    expect(canonicalSitePath("/doctors#team")).toBe("/physicians#team");
    expect(canonicalSitePath("/doctor")).toBe("/doctor");
    expect(withLocalePrefix("/doctors/a", "en", "tr")).toBe("/en/physicians/a");
    expect(withLocalePrefix("/doctors", "tr", "tr")).toBe("/physicians");
    expect(linkAttrs("/doctors/a")).toEqual({ href: "/physicians/a" });
    expect(linkAttrs("https://example.com/doctors")).toMatchObject({ href: "https://example.com/doctors" });
    expect(isPhysiciansListHref("/doctors")).toBe(true);
    expect(isPhysiciansListHref("/physicians/")).toBe(true);
    expect(isPhysiciansListHref("/physicians?specialty=x")).toBe(false);
  });
});

describe("proxy — eski /doctors adresleri 301", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.includes("/locales")) return Promise.resolve(json({ data: LOCALES }));
        if (url.includes("/appearance")) return Promise.resolve(json({ data: { maintenanceModeEnabled: false } }));
        return Promise.reject(new Error(`beklenmeyen fetch: ${url}`));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"), { headers: { host: "localhost:3000" } });

  it.each(CODES)("%s: liste ve profil 301, sorgu dizesi korunur", async (code) => {
    const { proxy } = await import("@/proxy");
    const prefix = code === "tr" ? "" : `/${code}`;
    for (const [from, to] of [
      [`/${code}/doctors`, `${prefix}/physicians`],
      [`/${code}/doctors/hakan-sofu?ref=mail&utm_source=x`, `${prefix}/physicians/hakan-sofu?ref=mail&utm_source=x`],
    ] as const) {
      const res = await proxy(request(from));
      expect(res.status, from).toBe(301);
      const location = new URL(res.headers.get("location")!);
      expect(location.origin, from).toBe("http://localhost:3000");
      expect(`${location.pathname}${location.search}`, from).toBe(to);
    }
  });

  it("öneksiz eski adres (varsayılan dil) 301", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(request("/doctors/vahit-mutlu?x=1"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("http://localhost:3000/physicians/vahit-mutlu?x=1");
  });

  it("yeni adres yönlendirilmez; doktor portalı (/doctor) ve admin etkilenmez", async () => {
    const { proxy } = await import("@/proxy");
    expect((await proxy(request("/en/physicians/hakan-sofu"))).status).toBe(200);
    const portal = await proxy(request("/en/doctor"));
    expect(portal.headers.get("location") ?? "").not.toContain("physicians");
  });
});
