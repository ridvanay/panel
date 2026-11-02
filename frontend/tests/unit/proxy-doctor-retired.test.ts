import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Paket AJ (AJ-5) — doktor alt alan adı ve doktor portalı ziyaretçiye kapalı:
 * doktor host'u -> ana site kökü (301), ana host'ta /doctor/** -> / (301), `DOCTOR_PORTAL_ENABLED=true`
 * eski davranışı geri açar. Admin yolları proxy matcher'ının dışındadır (bu dosyada matcher denetlenir).
 */

const SITE = "http://siteadi.localhost:3100";
const DOCTOR = "http://doktor.siteadi.localhost:3100";
const LOCALES = [{ code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null }];

const saved = {
  site: process.env.NEXT_PUBLIC_SITE_URL,
  doctor: process.env.NEXT_PUBLIC_DOCTOR_URL,
  enabled: process.env.DOCTOR_PORTAL_ENABLED,
};

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function req(pathAndSearch: string, host: string) {
  const origin = host.startsWith("doktor.") ? DOCTOR : SITE;
  return new NextRequest(new URL(`${origin}${pathAndSearch}`), { headers: { host } });
}

describe("proxy — doktor alt alan adı ve portal kapalı (AJ-5)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SITE_URL = SITE;
    process.env.NEXT_PUBLIC_DOCTOR_URL = DOCTOR;
    delete process.env.DOCTOR_PORTAL_ENABLED;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(JSON.stringify({ data: url.includes("/locales") ? LOCALES : { maintenanceModeEnabled: false } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
      )
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    restore("NEXT_PUBLIC_SITE_URL", saved.site);
    restore("NEXT_PUBLIC_DOCTOR_URL", saved.doctor);
    restore("DOCTOR_PORTAL_ENABLED", saved.enabled);
    vi.resetModules();
  });

  it.each(["/", "/login", "/doctor/earnings", "/urunler?x=1"])("doktor host %s -> ana site kökü (301)", async (path) => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(req(path, "doktor.siteadi.localhost:3100"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${SITE}/`);
  });

  it("doktor host //evil.example açık yönlendirme üretmez", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("//evil.example", "doktor.siteadi.localhost:3100"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${SITE}/`);
  });

  it.each(["/doctor", "/doctor/earnings", "/en/doctor", "/de/doctor/login"])("ana host %s -> / (301)", async (path) => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(req(path, "siteadi.localhost:3100"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${SITE}/`);
  });

  it("ana host sıradan sayfalar ve /doctors-benzeri yollar etkilenmez", async () => {
    const { proxy } = await import("@/proxy");
    const about = await proxy(req("/about", "siteadi.localhost:3100"));
    expect(about.status).not.toBe(301);
    const consult = await proxy(req("/consultation/abc", "siteadi.localhost:3100"));
    expect(consult.status).not.toBe(301);
  });

  it("DOCTOR_PORTAL_ENABLED=true eski davranışı geri açar (doktor host / -> rewrite)", async () => {
    process.env.DOCTOR_PORTAL_ENABLED = "true";
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/", "doktor.siteadi.localhost:3100"));
    expect(res.status).not.toBe(301);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/doctor");
  });

  it("matcher admin / dashboard / api yollarını hariç tutur (yönetici paneli kırılmaz)", async () => {
    const { config } = await import("@/proxy");
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/admin/crm")).toBe(false);
    expect(re.test("/dashboard")).toBe(false);
    expect(re.test("/api/x")).toBe(false);
    expect(re.test("/doctor")).toBe(true);
  });
});
