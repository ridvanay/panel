import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Paket AH (Faz 1, §5) — Türkçe ziyaretçiye kapatıldı (`enabled=false`, varsayılan dil `en`):
 * `/tr` ve `/tr/*` 301 ile EN karşılığına gider (EN varsayılan = önek yok); sorgu dizesi korunur;
 * açık diller (`/de`) etkilenmez; TR yeniden açılırsa (listede `tr` varsa) kural çalışmaz.
 */

const LOCALES_TR_DISABLED = [
  { code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "de", label: "German", nativeLabel: "Deutsch", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
];
const LOCALES_TR_ENABLED = [
  { code: "tr", label: "Turkish", nativeLabel: "Turkish", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "en", label: "English", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function stubFetch(locales: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/locales")) return Promise.resolve(jsonResponse({ data: locales }));
      return Promise.resolve(jsonResponse({ data: { maintenanceModeEnabled: false } }));
    })
  );
}

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

describe("proxy — kapatılan Türkçe (/tr) yönlendirmesi", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["/tr", "/"],
    ["/tr/about", "/about"],
    ["/tr/specialties/gastroenterology", "/specialties/gastroenterology"],
    ["/tr/blog/bir-yazi", "/blog/bir-yazi"],
    ["/tr/gizlilik-politikasi", "/gizlilik-politikasi"],
  ])("%s -> %s (301)", async (from, to) => {
    stubFetch(LOCALES_TR_DISABLED);
    const { proxy } = await import("@/proxy");
    const res = await proxy(req(from));
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!).pathname).toBe(to);
  });

  it("sorgu dizesi korunur", async () => {
    stubFetch(LOCALES_TR_DISABLED);
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/tr/blog?page=2"));
    expect(res.status).toBe(301);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/blog");
    expect(location.search).toBe("?page=2");
  });

  it("açık dil (/de/...) yönlendirilmez; önek'siz yol varsayılan dile (EN) yeniden yazılır", async () => {
    stubFetch(LOCALES_TR_DISABLED);
    const { proxy } = await import("@/proxy");
    const de = await proxy(req("/de/about"));
    expect(de.status).not.toBe(301);
    const plain = await proxy(req("/about"));
    expect(plain.status).not.toBe(301);
    expect(plain.headers.get("x-middleware-rewrite")).toContain("/en/about");
  });

  it("/tr ile başlayan başka yol (/trust) etkilenmez", async () => {
    stubFetch(LOCALES_TR_DISABLED);
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/trust"));
    expect(res.status).not.toBe(301);
  });

  it("Türkçe yeniden açıksa (varsayılan tr) eski davranış: /tr/about -> /about, /en/about önekli kalır", async () => {
    stubFetch(LOCALES_TR_ENABLED);
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/tr/about"));
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/about");
    const en = await proxy(req("/en/about"));
    expect(en.status).not.toBe(301);
  });
});
