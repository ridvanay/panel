import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { legacyFindTreatmentPath } from "@/lib/i18n/legacy-matcher-path";

/**
 * Paket AI (FE2) — eski sihirbaz adresi `/find-a-physician` 301 ile `/find-your-treatment`'a gider
 * (dil öneki korunur, varsayılan dilin öneki düşer, sorgu dizesi korunur).
 */
const LOCALES = [
  { code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "de", label: "German", nativeLabel: "Deutsch", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", isDefault: false, enabled: true, sortOrder: 2, hreflang: null },
  { code: "sr-latn", label: "Serbian", nativeLabel: "Srpski", isDefault: false, enabled: true, sortOrder: 3, hreflang: null },
];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = url.includes("/locales") ? { data: LOCALES } : { data: { maintenanceModeEnabled: false } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    })
  );
}
const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

describe("legacyFindTreatmentPath", () => {
  const codes = new Set(["en", "de", "ar", "sr-latn"]);
  it.each([
    ["/find-a-physician", "/find-your-treatment"],
    ["/find-a-physician/", "/find-your-treatment"],
    ["/en/find-a-physician", "/find-your-treatment"],
    ["/de/find-a-physician", "/de/find-your-treatment"],
    ["/ar/find-a-physician", "/ar/find-your-treatment"],
    ["/sr-latn/find-a-physician", "/sr-latn/find-your-treatment"],
  ])("%s -> %s", (from, to) => {
    expect(legacyFindTreatmentPath(from, "en", codes)).toBe(to);
  });

  it("ilgisiz ve kapalı dil yolları yönlendirilmez", () => {
    for (const p of ["/find-your-treatment", "/find-a-physician/x", "/de/find-a-physicians", "//evil.com/find-a-physician", "/specialties"]) {
      expect(legacyFindTreatmentPath(p, "en", codes), p).toBeNull();
    }
    expect(legacyFindTreatmentPath("/fr/find-a-physician", "en", codes)).toBeNull();
  });
});

describe("proxy — /find-a-physician 301", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["/find-a-physician", "/find-your-treatment"],
    ["/de/find-a-physician", "/de/find-your-treatment"],
    ["/ar/find-a-physician", "/ar/find-your-treatment"],
    ["/en/find-a-physician", "/find-your-treatment"],
  ])("%s -> %s (301)", async (from, to) => {
    stubFetch();
    const { proxy } = await import("@/proxy");
    const res = await proxy(req(from));
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!).pathname).toBe(to);
  });

  it("sorgu dizesi korunur; yeni adres yönlendirilmez", async () => {
    stubFetch();
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/de/find-a-physician?step=2&topic=x"));
    expect(res.status).toBe(301);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/de/find-your-treatment");
    expect(location.search).toBe("?step=2&topic=x");
    const fresh = await proxy(req("/de/find-your-treatment"));
    expect(fresh.status).not.toBe(301);
  });
});
